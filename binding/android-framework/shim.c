/*
 * libnssqlite_framework.so: the sqlite3_* functions the nssqlite core needs, implemented on top of
 * android.database.sqlite (the SQLite of the platform) through com.akylas.sqlite.framework.FrameworkEngine.
 *
 * The core resolves them with dlopen / dlsym like any other SQLite library (engine: 'libnssqlite_framework.so'), so
 * nothing in the core knows about this. To avoid a JNI call per row or per cell, the Java side runs a statement and
 * returns blocks of rows in the core's own wire format; this file parses them with the core's reader and answers the
 * column_* calls from memory. Calls come from the core's database threads, which are attached to the VM on demand.
 *
 * Deviations from a real SQLite, because the framework hides it: no extension loading, a fixed busy timeout, errors
 * of a statement (syntax too) surface at the first step, the statement tail is found by a small scanner, and
 * changes() / last_insert_rowid() are those of the last INSERT / UPDATE / DELETE run through here.
 */
#include <jni.h>
#include <pthread.h>
#include <stdatomic.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "nssqlite_wire.h"

#define API __attribute__((visibility("default")))

#define SQLITE_OK 0
#define SQLITE_ERROR 1
#define SQLITE_NOMEM 7
#define SQLITE_MISUSE 21
#define SQLITE_RANGE 25
#define SQLITE_ROW 100
#define SQLITE_DONE 101

#define ERR_BASE (-(1LL << 40))
#define MORE_BIT (1LL << 31)
#define BLOCK_ROWS 512
#define BUF_INITIAL (256 * 1024)

typedef struct Bind {
    uint8_t type; /* NS_T_* ; 0 = NULL / unbound */
    int64_t i;
    double d;
    uint8_t* data;
    size_t len;
} Bind;

typedef struct sqlite3 {
    int conn;
    int64_t changes;
    int64_t rowid;
    int err_code;
    char* err_msg;
    uint8_t* buf; /* rows blocks from Java */
    size_t cap;
    jobject bufobj; /* global ref to the direct ByteBuffer over buf */
} sqlite3;

typedef struct sqlite3_stmt {
    sqlite3* db;
    char* sql;
    size_t len;
    int key;
    int nparams;
    Bind* binds;
    int started;
    int failed; /* the extended code of the failure of the execution, 0 when none */
    int more;
    int done;
    NSRows rows;
    NSValue* cur;
    uint32_t ncols;
    char** names;
} sqlite3_stmt;

static JavaVM* g_vm;
static jclass g_class;
static jmethodID m_version, m_last_message, m_open, m_close, m_begin, m_more, m_release;
static pthread_key_t g_detach_key;
static atomic_int g_next_key = 1;

static void detach_thread(void* arg) {
    (void)arg;
    if (g_vm) (*g_vm)->DetachCurrentThread(g_vm);
}

static JNIEnv* env_for_thread(void) {
    JNIEnv* env = NULL;
    if ((*g_vm)->GetEnv(g_vm, (void**)&env, JNI_VERSION_1_6) == JNI_OK) return env;
    if ((*g_vm)->AttachCurrentThread(g_vm, &env, NULL) != JNI_OK) return NULL;
    pthread_setspecific(g_detach_key, (void*)1);
    return env;
}

JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM* vm, void* reserved) {
    (void)reserved;
    g_vm = vm;
    JNIEnv* env;
    if ((*vm)->GetEnv(vm, (void**)&env, JNI_VERSION_1_6) != JNI_OK) return JNI_ERR;
    jclass c = (*env)->FindClass(env, "com/akylas/sqlite/framework/FrameworkEngine");
    if (!c) return JNI_ERR;
    g_class = (jclass)(*env)->NewGlobalRef(env, c);
    m_version = (*env)->GetStaticMethodID(env, g_class, "version", "()Ljava/lang/String;");
    m_last_message = (*env)->GetStaticMethodID(env, g_class, "lastMessage", "()Ljava/lang/String;");
    m_open = (*env)->GetStaticMethodID(env, g_class, "open", "(Ljava/lang/String;I)J");
    m_close = (*env)->GetStaticMethodID(env, g_class, "close", "(I)J");
    m_begin = (*env)->GetStaticMethodID(env, g_class, "begin", "(IILjava/nio/ByteBuffer;ILjava/nio/ByteBuffer;ILjava/nio/ByteBuffer;I)J");
    m_more = (*env)->GetStaticMethodID(env, g_class, "more", "(ILjava/nio/ByteBuffer;I)J");
    m_release = (*env)->GetStaticMethodID(env, g_class, "release", "(I)V");
    if (!m_version || !m_last_message || !m_open || !m_close || !m_begin || !m_more || !m_release) return JNI_ERR;
    pthread_key_create(&g_detach_key, detach_thread);
    return JNI_VERSION_1_6;
}

/* ---- helpers ---- */

static char* dup_n(const char* s, size_t n) {
    char* d = (char*)malloc(n + 1);
    if (d) {
        memcpy(d, s, n);
        d[n] = 0;
    }
    return d;
}

static void set_error(sqlite3* db, int code, const char* msg) {
    db->err_code = code;
    free(db->err_msg);
    db->err_msg = dup_n(msg ? msg : "unknown error", msg ? strlen(msg) : 13);
}

/* the message of the last Java failure on this thread */
static void take_java_error(JNIEnv* env, sqlite3* db, int code) {
    if ((*env)->ExceptionCheck(env)) {
        (*env)->ExceptionClear(env);
        set_error(db, SQLITE_ERROR, "JNI exception in the framework engine");
        return;
    }
    jstring js = (jstring)(*env)->CallStaticObjectMethod(env, g_class, m_last_message);
    const char* c = js ? (*env)->GetStringUTFChars(env, js, NULL) : NULL;
    set_error(db, code, c);
    if (c) (*env)->ReleaseStringUTFChars(env, js, c);
    if (js) (*env)->DeleteLocalRef(env, js);
}

static int buf_ensure(JNIEnv* env, sqlite3* db, size_t need) {
    if (db->buf && db->cap >= need) return 0;
    size_t cap = db->cap ? db->cap : BUF_INITIAL;
    while (cap < need) cap *= 2;
    uint8_t* nb = (uint8_t*)malloc(cap);
    if (!nb) return -1;
    jobject local = (*env)->NewDirectByteBuffer(env, nb, (jlong)cap);
    if (!local) {
        free(nb);
        return -1;
    }
    jobject global = (*env)->NewGlobalRef(env, local);
    (*env)->DeleteLocalRef(env, local);
    if (db->bufobj) (*env)->DeleteGlobalRef(env, db->bufobj);
    free(db->buf);
    db->buf = nb;
    db->cap = cap;
    db->bufobj = global;
    return 0;
}

static void free_binds(sqlite3_stmt* st) {
    for (int i = 0; i < st->nparams; i++) {
        free(st->binds[i].data);
        memset(&st->binds[i], 0, sizeof(Bind));
    }
}

static void free_result(sqlite3_stmt* st) {
    if (st->names) {
        for (uint32_t i = 0; i < st->ncols; i++) free(st->names[i]);
        free(st->names);
        st->names = NULL;
    }
    free(st->cur);
    st->cur = NULL;
    st->ncols = 0;
}

static void stmt_reset(sqlite3_stmt* st) {
    if (st->started) {
        JNIEnv* env = env_for_thread();
        if (env) (*env)->CallStaticVoidMethod(env, g_class, m_release, (jint)st->key);
        if (env && (*env)->ExceptionCheck(env)) (*env)->ExceptionClear(env);
    }
    free_result(st);
    st->started = st->failed = st->more = st->done = 0;
}

/* ---- statement scanner: end of the first statement and number of parameters ---- */

static int is_word(unsigned char c) { return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_' || c >= 0x80; }

static int word_eq(const char* p, size_t n, const char* w) {
    size_t l = strlen(w);
    if (n != l) return 0;
    for (size_t i = 0; i < n; i++) {
        char c = p[i];
        if (c >= 'A' && c <= 'Z') c += 32;
        if (c != w[i]) return 0;
    }
    return 1;
}

/* Returns the offset just after the first statement (after its ';'), start = first significant byte (len when the
 * input holds only whitespace, comments and ';'). */
static size_t scan_statement(const char* s, size_t len, size_t* start, int* nparams) {
    size_t i = 0;
    /* skip leading blanks, comments and empty statements */
    for (;;) {
        while (i < len && (s[i] == ' ' || s[i] == '\t' || s[i] == '\n' || s[i] == '\r' || s[i] == ';')) i++;
        if (i + 1 < len && s[i] == '-' && s[i + 1] == '-') {
            while (i < len && s[i] != '\n') i++;
        } else if (i + 1 < len && s[i] == '/' && s[i + 1] == '*') {
            i += 2;
            while (i + 1 < len && !(s[i] == '*' && s[i + 1] == '/')) i++;
            i = i + 2 < len ? i + 2 : len;
        } else {
            break;
        }
    }
    *start = i;
    *nparams = 0;
    if (i >= len) return len;
    int maxidx = 0;
    char names[32][48];
    int nnames = 0;
    int trigger = 0, words = 0;
    int in_trigger_body = 0;
    const char* last_word = NULL;
    size_t last_len = 0;
    size_t j = i;
    while (j < len) {
        char c = s[j];
        if (c == '\'' || c == '"' || c == '`') {
            char q = c;
            j++;
            while (j < len) {
                if (s[j] == q) {
                    if (j + 1 < len && s[j + 1] == q) {
                        j += 2;
                        continue;
                    }
                    break;
                }
                j++;
            }
            j++;
            last_word = NULL;
        } else if (c == '[') {
            while (j < len && s[j] != ']') j++;
            j++;
        } else if (c == '-' && j + 1 < len && s[j + 1] == '-') {
            while (j < len && s[j] != '\n') j++;
        } else if (c == '/' && j + 1 < len && s[j + 1] == '*') {
            j += 2;
            while (j + 1 < len && !(s[j] == '*' && s[j + 1] == '/')) j++;
            j += 2;
        } else if (c == '?') {
            j++;
            int num = 0, has = 0;
            while (j < len && s[j] >= '0' && s[j] <= '9') {
                num = num * 10 + (s[j] - '0');
                has = 1;
                j++;
            }
            if (has) {
                if (num > maxidx) maxidx = num;
            } else {
                maxidx++;
            }
        } else if (c == ':' || c == '@' || c == '$') {
            size_t b = j;
            j++;
            while (j < len && is_word((unsigned char)s[j])) j++;
            size_t n = j - b;
            int found = -1;
            for (int k = 0; k < nnames; k++) {
                if (strlen(names[k]) == n && memcmp(names[k], s + b, n) == 0) found = k;
            }
            if (found < 0 && n < sizeof(names[0]) && nnames < 32) {
                memcpy(names[nnames], s + b, n);
                names[nnames][n] = 0;
                nnames++;
                maxidx++;
            }
        } else if (is_word((unsigned char)c)) {
            size_t b = j;
            while (j < len && is_word((unsigned char)s[j])) j++;
            last_word = s + b;
            last_len = j - b;
            words++;
            if (words <= 3 && word_eq(last_word, last_len, "trigger")) trigger = 1;
            if (trigger && word_eq(last_word, last_len, "begin")) in_trigger_body = 1;
        } else if (c == ';') {
            if (!in_trigger_body || (last_word && word_eq(last_word, last_len, "end"))) {
                *nparams = maxidx;
                return j + 1;
            }
            j++;
            last_word = NULL;
        } else {
            j++;
        }
    }
    *nparams = maxidx;
    return len;
}

/* ---- version, open, close ---- */

API const char* sqlite3_libversion(void) {
    static char version[64];
    if (!version[0]) {
        JNIEnv* env = env_for_thread();
        if (!env) return "3.0.0";
        jstring js = (jstring)(*env)->CallStaticObjectMethod(env, g_class, m_version);
        if ((*env)->ExceptionCheck(env)) (*env)->ExceptionClear(env);
        const char* c = js ? (*env)->GetStringUTFChars(env, js, NULL) : NULL;
        snprintf(version, sizeof(version), "%s", c ? c : "3.0.0");
        if (c) (*env)->ReleaseStringUTFChars(env, js, c);
        if (js) (*env)->DeleteLocalRef(env, js);
    }
    return version;
}

API int sqlite3_threadsafe(void) { return 2; }

API int sqlite3_open_v2(const char* path, sqlite3** out, int flags, const char* vfs) {
    (void)vfs;
    sqlite3* db = (sqlite3*)calloc(1, sizeof(*db));
    *out = db;
    if (!db) return SQLITE_NOMEM;
    JNIEnv* env = env_for_thread();
    if (!env || buf_ensure(env, db, BUF_INITIAL)) {
        set_error(db, SQLITE_NOMEM, "out of memory");
        return SQLITE_NOMEM;
    }
    jstring jp = (*env)->NewStringUTF(env, path);
    jlong r = (*env)->CallStaticLongMethod(env, g_class, m_open, jp, (jint)flags);
    (*env)->DeleteLocalRef(env, jp);
    if ((*env)->ExceptionCheck(env) || r <= 0) {
        take_java_error(env, db, r <= ERR_BASE ? (int)(ERR_BASE - r) : SQLITE_ERROR);
        return db->err_code ? (db->err_code & 0xff) : SQLITE_ERROR;
    }
    db->conn = (int)r;
    return SQLITE_OK;
}

API int sqlite3_close_v2(sqlite3* db) {
    if (!db) return SQLITE_OK;
    JNIEnv* env = env_for_thread();
    if (env && db->conn) {
        (*env)->CallStaticLongMethod(env, g_class, m_close, (jint)db->conn);
        if ((*env)->ExceptionCheck(env)) (*env)->ExceptionClear(env);
    }
    if (env && db->bufobj) (*env)->DeleteGlobalRef(env, db->bufobj);
    free(db->buf);
    free(db->err_msg);
    free(db);
    return SQLITE_OK;
}

API int sqlite3_busy_timeout(sqlite3* db, int ms) {
    (void)db;
    (void)ms; /* the framework sets its own busy timeout */
    return SQLITE_OK;
}

API int sqlite3_extended_errcode(sqlite3* db) { return db ? db->err_code : 0; }
API const char* sqlite3_errmsg(sqlite3* db) { return db && db->err_msg ? db->err_msg : "not an error"; }
API int sqlite3_changes(sqlite3* db) { return (int)db->changes; }
API int64_t sqlite3_last_insert_rowid(sqlite3* db) { return db->rowid; }
API void sqlite3_free(void* p) { free(p); }

/* ---- statements ---- */

API int sqlite3_prepare_v3(sqlite3* db, const char* sql, int nbytes, unsigned int flags, sqlite3_stmt** out, const char** tail) {
    (void)flags;
    size_t len = nbytes < 0 ? strlen(sql) : (size_t)nbytes;
    size_t start;
    int nparams;
    size_t end = scan_statement(sql, len, &start, &nparams);
    *out = NULL;
    if (tail) *tail = sql + end;
    if (start >= len) return SQLITE_OK; /* nothing to run */
    sqlite3_stmt* st = (sqlite3_stmt*)calloc(1, sizeof(*st));
    if (!st) return SQLITE_NOMEM;
    st->db = db;
    st->len = end - start;
    st->sql = dup_n(sql + start, st->len);
    st->nparams = nparams;
    st->binds = nparams ? (Bind*)calloc((size_t)nparams, sizeof(Bind)) : NULL;
    st->key = atomic_fetch_add(&g_next_key, 1);
    if (!st->sql || (nparams && !st->binds)) {
        free(st->sql);
        free(st->binds);
        free(st);
        return SQLITE_NOMEM;
    }
    *out = st;
    return SQLITE_OK;
}

API int sqlite3_reset(sqlite3_stmt* st) {
    stmt_reset(st);
    return SQLITE_OK;
}

API int sqlite3_clear_bindings(sqlite3_stmt* st) {
    free_binds(st);
    return SQLITE_OK;
}

API int sqlite3_finalize(sqlite3_stmt* st) {
    if (!st) return SQLITE_OK;
    stmt_reset(st);
    free_binds(st);
    free(st->binds);
    free(st->sql);
    free(st);
    return SQLITE_OK;
}

API int sqlite3_bind_parameter_count(sqlite3_stmt* st) { return st->nparams; }

static Bind* bind_slot(sqlite3_stmt* st, int idx) {
    if (idx < 1 || idx > st->nparams) return NULL;
    Bind* b = &st->binds[idx - 1];
    free(b->data);
    memset(b, 0, sizeof(*b));
    return b;
}

API int sqlite3_bind_null(sqlite3_stmt* st, int idx) { return bind_slot(st, idx) ? SQLITE_OK : SQLITE_RANGE; }

API int sqlite3_bind_int64(sqlite3_stmt* st, int idx, int64_t v) {
    Bind* b = bind_slot(st, idx);
    if (!b) return SQLITE_RANGE;
    b->type = NS_T_INT64;
    b->i = v;
    return SQLITE_OK;
}

API int sqlite3_bind_double(sqlite3_stmt* st, int idx, double v) {
    Bind* b = bind_slot(st, idx);
    if (!b) return SQLITE_RANGE;
    b->type = NS_T_DOUBLE;
    b->d = v;
    return SQLITE_OK;
}

static int bind_bytes(sqlite3_stmt* st, int idx, uint8_t type, const void* p, int n) {
    Bind* b = bind_slot(st, idx);
    if (!b) return SQLITE_RANGE;
    size_t len = n < 0 ? strlen((const char*)p) : (size_t)n;
    b->data = (uint8_t*)malloc(len ? len : 1);
    if (!b->data) return SQLITE_NOMEM;
    if (len) memcpy(b->data, p, len);
    b->len = len;
    b->type = type;
    return SQLITE_OK;
}

API int sqlite3_bind_text(sqlite3_stmt* st, int idx, const char* p, int n, void (*d)(void*)) {
    (void)d;
    return bind_bytes(st, idx, NS_T_TEXT, p, n);
}

API int sqlite3_bind_blob(sqlite3_stmt* st, int idx, const void* p, int n, void (*d)(void*)) {
    (void)d;
    return bind_bytes(st, idx, NS_T_BLOB, p, n);
}

/* Parses the block in db->buf (n bytes) and makes it the current rows. Returns 0 on success. */
static int load_block(sqlite3_stmt* st, size_t n, int keep_names) {
    sqlite3* db = st->db;
    if (nssqlite_rows_init(&st->rows, db->buf, n)) return -1;
    if (!keep_names) {
        st->ncols = st->rows.ncols;
        st->names = st->ncols ? (char**)calloc(st->ncols, sizeof(char*)) : NULL;
        st->cur = st->ncols ? (NSValue*)calloc(st->ncols, sizeof(NSValue)) : NULL;
        for (uint32_t i = 0; i < st->ncols; i++) {
            const uint8_t* name;
            uint32_t l;
            if (nssqlite_rows_name(&st->rows, i, &name, &l)) return -1;
            st->names[i] = dup_n((const char*)name, l);
        }
        if (st->rows.changes >= 0) db->changes = st->rows.changes;
        if (st->rows.last_insert_rowid >= 0) db->rowid = st->rows.last_insert_rowid;
    }
    return 0;
}

static void fail_statement(JNIEnv* env, sqlite3_stmt* st, jlong r) {
    take_java_error(env, st->db, (int)(ERR_BASE - r));
    st->failed = st->db->err_code ? st->db->err_code : SQLITE_ERROR;
    st->done = 1;
}

/* Runs the statement on first use: the Java side needs the parameters, which are complete once the core steps. */
static void ensure_started(sqlite3_stmt* st, int max_rows) {
    if (st->started) return;
    st->started = 1;
    sqlite3* db = st->db;
    JNIEnv* env = env_for_thread();
    if (!env) {
        set_error(db, SQLITE_ERROR, "cannot attach to the Java VM");
        st->failed = SQLITE_ERROR;
        st->done = 1;
        return;
    }
    NSBuf params;
    nssqlite_buf_init(&params);
    nssqlite_buf_u32(&params, (uint32_t)st->nparams);
    for (int i = 0; i < st->nparams; i++) {
        Bind* b = &st->binds[i];
        switch (b->type) {
            case NS_T_INT64: nssqlite_buf_value_int(&params, b->i); break;
            case NS_T_DOUBLE: nssqlite_buf_value_double(&params, b->d); break;
            case NS_T_TEXT: nssqlite_buf_value_text(&params, (const char*)b->data, b->len); break;
            case NS_T_BLOB: nssqlite_buf_value_blob(&params, b->data, b->len); break;
            default: nssqlite_buf_value_null(&params);
        }
    }
    jobject sqlbuf = (*env)->NewDirectByteBuffer(env, st->sql, (jlong)st->len);
    jobject pbuf = st->nparams ? (*env)->NewDirectByteBuffer(env, params.data, (jlong)params.len) : NULL;
    jlong r = (*env)->CallStaticLongMethod(env, g_class, m_begin, (jint)db->conn, (jint)st->key, sqlbuf, (jint)st->len, pbuf, (jint)params.len, db->bufobj,
                                          (jint)max_rows);
    int exc = (*env)->ExceptionCheck(env);
    (*env)->DeleteLocalRef(env, sqlbuf);
    if (pbuf) (*env)->DeleteLocalRef(env, pbuf);
    nssqlite_buf_free(&params);
    if (exc) {
        r = ERR_BASE - SQLITE_ERROR;
    }
    if (r <= ERR_BASE || exc) {
        fail_statement(env, st, r);
        return;
    }
    if (r < 0) {
        /* the first row does not fit: grow and fetch the block again (the statement already ran) */
        if (buf_ensure(env, db, (size_t)(-r) + 4096)) {
            set_error(db, SQLITE_NOMEM, "out of memory");
            st->failed = SQLITE_NOMEM;
            st->done = 1;
            return;
        }
        r = (*env)->CallStaticLongMethod(env, g_class, m_more, (jint)st->key, db->bufobj, (jint)max_rows);
        if ((*env)->ExceptionCheck(env) || r <= ERR_BASE || r < 0) {
            if ((*env)->ExceptionCheck(env)) (*env)->ExceptionClear(env);
            fail_statement(env, st, r < 0 && r > ERR_BASE ? ERR_BASE - SQLITE_ERROR : r);
            return;
        }
    }
    st->more = (r & MORE_BIT) != 0;
    if (load_block(st, (size_t)(r & 0x7fffffff), 0)) {
        set_error(db, SQLITE_ERROR, "malformed block from the framework engine");
        st->failed = SQLITE_ERROR;
        st->done = 1;
    }
}

static void fetch_more(sqlite3_stmt* st) {
    sqlite3* db = st->db;
    JNIEnv* env = env_for_thread();
    jlong r = (*env)->CallStaticLongMethod(env, g_class, m_more, (jint)st->key, db->bufobj, (jint)BLOCK_ROWS);
    if ((*env)->ExceptionCheck(env)) {
        r = ERR_BASE - SQLITE_ERROR;
    }
    if (r > ERR_BASE && r < 0) {
        if (buf_ensure(env, db, (size_t)(-r) + 4096) == 0) {
            r = (*env)->CallStaticLongMethod(env, g_class, m_more, (jint)st->key, db->bufobj, (jint)BLOCK_ROWS);
        } else {
            r = ERR_BASE - SQLITE_NOMEM;
        }
    }
    if (r <= ERR_BASE || r < 0) {
        fail_statement(env, st, r < 0 && r > ERR_BASE ? ERR_BASE - SQLITE_ERROR : r);
        return;
    }
    st->more = (r & MORE_BIT) != 0;
    if (load_block(st, (size_t)(r & 0x7fffffff), 1)) {
        set_error(db, SQLITE_ERROR, "malformed block from the framework engine");
        st->failed = SQLITE_ERROR;
        st->done = 1;
    }
}

API int sqlite3_step(sqlite3_stmt* st) {
    ensure_started(st, BLOCK_ROWS);
    if (st->failed) return SQLITE_ERROR;
    for (;;) {
        if (st->done) return SQLITE_DONE;
        int rc = nssqlite_rows_next(&st->rows, st->cur);
        if (rc > 0) return SQLITE_ROW;
        if (rc < 0) {
            set_error(st->db, SQLITE_ERROR, "malformed rows from the framework engine");
            st->failed = SQLITE_ERROR;
            return SQLITE_ERROR;
        }
        if (!st->more) {
            st->done = 1;
            return SQLITE_DONE;
        }
        fetch_more(st);
        if (st->failed) return SQLITE_ERROR;
    }
}

API int sqlite3_column_count(sqlite3_stmt* st) {
    ensure_started(st, BLOCK_ROWS);
    return (int)st->ncols;
}

API const char* sqlite3_column_name(sqlite3_stmt* st, int i) { return i >= 0 && (uint32_t)i < st->ncols && st->names ? st->names[i] : NULL; }

API int sqlite3_column_type(sqlite3_stmt* st, int i) {
    switch (st->cur[i].type) {
        case NS_T_INT32:
        case NS_T_INT64: return 1;
        case NS_T_DOUBLE: return 2;
        case NS_T_TEXT: return 3;
        case NS_T_BLOB: return 4;
        default: return 5;
    }
}

API int64_t sqlite3_column_int64(sqlite3_stmt* st, int i) { return st->cur[i].i; }
API double sqlite3_column_double(sqlite3_stmt* st, int i) { return st->cur[i].d; }
API const unsigned char* sqlite3_column_text(sqlite3_stmt* st, int i) { return st->cur[i].ptr; }
API const void* sqlite3_column_blob(sqlite3_stmt* st, int i) { return st->cur[i].ptr; }
API int sqlite3_column_bytes(sqlite3_stmt* st, int i) { return (int)st->cur[i].len; }

/* Runs every statement of `sql`; rows are ignored. */
API int sqlite3_exec(sqlite3* db, const char* sql, void* cb, void* arg, char** err) {
    (void)cb;
    (void)arg;
    if (err) *err = NULL;
    size_t len = strlen(sql);
    size_t pos = 0;
    while (pos < len) {
        sqlite3_stmt* st = NULL;
        const char* tail = NULL;
        int rc = sqlite3_prepare_v3(db, sql + pos, (int)(len - pos), 0, &st, &tail);
        if (rc) return rc;
        size_t next = (size_t)(tail - sql);
        if (!st) break;
        ensure_started(st, 1);
        int failed = st->failed;
        sqlite3_finalize(st);
        if (failed) {
            if (err) *err = dup_n(db->err_msg, strlen(db->err_msg));
            return failed & 0xff;
        }
        pos = next;
    }
    return SQLITE_OK;
}

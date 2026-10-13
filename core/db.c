#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "internal.h"

/* sqlite3 constants, copied so the core needs no sqlite3.h */
#define SQLITE_OK 0
#define SQLITE_ROW 100
#define SQLITE_DONE 101
#define SQLITE_OPEN_READWRITE 0x00000002
#define SQLITE_OPEN_CREATE 0x00000004
#define SQLITE_INTEGER 1
#define SQLITE_FLOAT 2
#define SQLITE_TEXT 3
#define SQLITE_BLOB 4
#define SQLITE_NULL 5
#define SQLITE_PREPARE_PERSISTENT 1
#define SQLITE_TRANSIENT ((void (*)(void*)) - 1)

#define STMT_CACHE_SIZE 32
#define DEFAULT_BUSY_TIMEOUT_MS 5000

enum { REQ_OPEN, REQ_EXEC, REQ_BATCH, REQ_TX_BEGIN, REQ_TX_END, REQ_LOAD_EXT };

typedef struct Req {
    struct Req* next;
    int type;
    uint32_t tx;
    uint32_t flags;
    uint32_t chunk_rows;
    int mode;   /* TX_BEGIN mode */
    int commit; /* TX_END */
    uint8_t* sql;
    size_t sql_len;
    uint8_t* params;
    size_t params_len;
    char* s2; /* extension entry */
    NSCallback cb;
    void* user;
} Req;

typedef struct CachedStmt {
    char* sql;
    size_t len;
    sqlite3_stmt* st;
    uint64_t used;
} CachedStmt;

struct NSDb {
    NSEngine* eng;
    atomic_int refs;
    pthread_mutex_t mu;
    pthread_cond_t cv;
    Req *head, *tail;
    Req* close_req;
    int closing;
    uint32_t next_tx;
    /* open request, consumed by the worker */
    char* path;
    NSOpenOptions opts;
    char* init_sql;
    /* worker state (touched only by the worker thread after start) */
    sqlite3* h;
    int open_status;
    char* open_message;
    uint32_t active_tx;
    int tx_status;
    char* tx_message;
    uint64_t tick;
    CachedStmt cache[STMT_CACHE_SIZE];
};

/* ---- helpers ---- */

static char* dup_cstr(const char* s) {
    if (!s) return NULL;
    size_t n = strlen(s);
    char* d = (char*)malloc(n + 1);
    if (d) memcpy(d, s, n + 1);
    return d;
}

static void* dup_bytes(const void* p, size_t n) {
    if (!p || !n) return NULL;
    void* d = malloc(n);
    if (d) memcpy(d, p, n);
    return d;
}

static void req_free(Req* r) {
    free(r->sql);
    free(r->params);
    free(r->s2);
    free(r);
}

static void deliver(Req* r, int status, int done, uint8_t* data, size_t len, char* message, int64_t changes, int64_t rowid) {
    NSResult res;
    res.status = status;
    res.done = done;
    res.data = data;
    res.len = len;
    res.message = message;
    res.changes = changes;
    res.last_insert_rowid = rowid;
    if (r->cb) {
        r->cb(r->user, res);
    } else {
        free(data);
        free(message);
    }
}

static void deliver_error(Req* r, int status, const char* msg) { deliver(r, status, 1, NULL, 0, dup_cstr(msg), 0, 0); }

/* ---- lifetime ---- */

void nssqlite_db_release(NSDb* db) {
    if (!db) return;
    if (atomic_fetch_sub(&db->refs, 1) == 1) {
        pthread_mutex_destroy(&db->mu);
        pthread_cond_destroy(&db->cv);
        free(db->path);
        free(db->init_sql);
        free(db->open_message);
        free(db->tx_message);
        free(db);
    }
}

/* ---- statement cache ---- */

static void cache_clear(NSDb* db) {
    for (int i = 0; i < STMT_CACHE_SIZE; i++) {
        if (db->cache[i].st) db->eng->p.finalize(db->cache[i].st);
        free(db->cache[i].sql);
        memset(&db->cache[i], 0, sizeof(db->cache[i]));
    }
}

/* Returns a ready-to-bind statement (reset, bindings cleared) or NULL with *status set. */
static sqlite3_stmt* stmt_get(NSDb* db, const uint8_t* sql, size_t len, int* status, char** message) {
    NSSqliteProvider* p = &db->eng->p;
    CachedStmt* victim = &db->cache[0];
    for (int i = 0; i < STMT_CACHE_SIZE; i++) {
        CachedStmt* c = &db->cache[i];
        if (c->st && c->len == len && memcmp(c->sql, sql, len) == 0) {
            c->used = ++db->tick;
            p->reset(c->st);
            p->clear_bindings(c->st);
            return c->st;
        }
        if (!c->st) {
            victim = c;
        } else if (victim->st && c->used < victim->used) {
            victim = c;
        }
    }
    if (len > INT32_MAX) {
        *status = NS_ERR_INVALID;
        *message = dup_cstr("sql too long");
        return NULL;
    }
    sqlite3_stmt* st = NULL;
    const char* tail = NULL;
    /* sql is NUL terminated by the caller (Req copies add a terminator) */
    int rc = p->prepare_v3(db->h, (const char*)sql, (int)len, SQLITE_PREPARE_PERSISTENT, &st, &tail);
    if (rc != SQLITE_OK) {
        *status = p->extended_errcode(db->h);
        *message = dup_cstr(p->errmsg(db->h));
        return NULL;
    }
    if (!st) { /* empty statement or only a comment */
        *status = NS_ERR_INVALID;
        *message = dup_cstr("empty statement");
        return NULL;
    }
    for (const char* t = tail; t && t < (const char*)sql + len; t++) {
        if (*t != ' ' && *t != '\t' && *t != '\n' && *t != '\r' && *t != ';') {
            p->finalize(st);
            *status = NS_ERR_INVALID;
            *message = dup_cstr("multiple statements: use a script or a batch");
            return NULL;
        }
    }
    if (victim->st) p->finalize(victim->st);
    free(victim->sql);
    victim->sql = (char*)dup_bytes(sql, len);
    if (!victim->sql) { /* uncached but usable: park it as the single entry would leak, so drop cache slot */
        memset(victim, 0, sizeof(*victim));
        p->finalize(st);
        *status = NS_ERR_NOMEM;
        *message = dup_cstr("out of memory");
        return NULL;
    }
    victim->len = len;
    victim->st = st;
    victim->used = ++db->tick;
    return st;
}

/* ---- statement execution ---- */

static int bind_params(NSDb* db, sqlite3_stmt* st, const uint8_t* params, size_t params_len, int* status, char** message) {
    NSSqliteProvider* p = &db->eng->p;
    uint32_t count = 0;
    NSReader r;
    nssqlite_reader_init(&r, params, params_len);
    if (params && params_len && nssqlite_reader_u32(&r, &count)) {
        *status = NS_ERR_INVALID;
        *message = dup_cstr("malformed parameters");
        return -1;
    }
    int expected = p->bind_parameter_count(st);
    if ((int)count != expected) {
        char buf[96];
        snprintf(buf, sizeof(buf), "expected %d parameters, got %u", expected, count);
        *status = NS_ERR_INVALID;
        *message = dup_cstr(buf);
        return -1;
    }
    for (uint32_t i = 0; i < count; i++) {
        NSValue v;
        if (nssqlite_reader_value(&r, &v)) {
            *status = NS_ERR_INVALID;
            *message = dup_cstr("malformed parameters");
            return -1;
        }
        int rc = SQLITE_OK;
        int idx = (int)i + 1;
        switch (v.type) {
            case NS_T_NULL: rc = p->bind_null(st, idx); break;
            case NS_T_INT32:
            case NS_T_INT64: rc = p->bind_int64(st, idx, v.i); break;
            case NS_T_DOUBLE: rc = p->bind_double(st, idx, v.d); break;
            case NS_T_TEXT: rc = p->bind_text(st, idx, (const char*)v.ptr, (int)v.len, SQLITE_TRANSIENT); break;
            case NS_T_BLOB: rc = p->bind_blob(st, idx, v.ptr ? v.ptr : (const void*)"", (int)v.len, SQLITE_TRANSIENT); break;
        }
        if (rc != SQLITE_OK) {
            *status = p->extended_errcode(db->h);
            *message = dup_cstr(p->errmsg(db->h));
            return -1;
        }
    }
    return 0;
}

static void block_begin(NSBuf* b, sqlite3_stmt* st, NSSqliteProvider* p) {
    int ncols = p->column_count(st);
    nssqlite_buf_u32(b, NS_ROWS_MAGIC);
    nssqlite_buf_u32(b, (uint32_t)ncols);
    nssqlite_buf_u32(b, 0); /* nrows, patched */
    nssqlite_buf_i64(b, 0); /* changes, patched */
    nssqlite_buf_i64(b, 0); /* last insert rowid, patched */
    for (int i = 0; i < ncols; i++) {
        const char* n = p->column_name(st, i);
        nssqlite_buf_u32(b, n ? (uint32_t)strlen(n) : 0);
        if (n) nssqlite_buf_bytes(b, n, strlen(n));
    }
}

static void block_end(NSBuf* b, uint32_t nrows, int64_t changes, int64_t rowid) {
    nssqlite_buf_patch_u32(b, 8, nrows);
    if (!b->oom && b->len >= 28) {
        memcpy(b->data + 12, &changes, 8);
        memcpy(b->data + 20, &rowid, 8);
    }
}

static void encode_row(NSBuf* b, sqlite3_stmt* st, NSSqliteProvider* p, int ncols) {
    for (int c = 0; c < ncols; c++) {
        switch (p->column_type(st, c)) {
            case SQLITE_INTEGER: nssqlite_buf_value_int(b, p->column_int64(st, c)); break;
            case SQLITE_FLOAT: nssqlite_buf_value_double(b, p->column_double(st, c)); break;
            case SQLITE_TEXT: {
                const unsigned char* t = p->column_text(st, c);
                int n = p->column_bytes(st, c);
                nssqlite_buf_value_text(b, (const char*)t, t ? (size_t)n : 0);
                break;
            }
            case SQLITE_BLOB: {
                const void* t = p->column_blob(st, c);
                int n = p->column_bytes(st, c);
                nssqlite_buf_value_blob(b, t, t ? (size_t)n : 0);
                break;
            }
            default: nssqlite_buf_value_null(b); break;
        }
    }
}

/* Runs one statement. Appends the rows block to out. When req != NULL and chunk_rows > 0, full
 * chunks are delivered through req->cb with done = 0 and out is reset after each. Returns the
 * sqlite status (0 on success) and fills message on failure. */
static int run_stmt(NSDb* db, const uint8_t* sql, size_t sql_len, const uint8_t* params, size_t params_len, Req* chunk_req, uint32_t chunk_rows,
                    NSBuf* out, int64_t* changes, int64_t* rowid, char** message) {
    NSSqliteProvider* p = &db->eng->p;
    int status = 0;
    sqlite3_stmt* st = stmt_get(db, sql, sql_len, &status, message);
    if (!st) return status;
    if (bind_params(db, st, params, params_len, &status, message)) {
        p->reset(st);
        return status;
    }
    int ncols = p->column_count(st);
    uint32_t nrows = 0;
    block_begin(out, st, p);
    for (;;) {
        int rc = p->step(st);
        if (rc == SQLITE_ROW) {
            encode_row(out, st, p, ncols);
            nrows++;
            if (chunk_req && chunk_rows && nrows >= chunk_rows) {
                block_end(out, nrows, 0, 0);
                size_t len;
                uint8_t* data = nssqlite_buf_take(out, &len);
                if (!data) {
                    p->reset(st);
                    *message = dup_cstr("out of memory");
                    return NS_ERR_NOMEM;
                }
                deliver(chunk_req, 0, 0, data, len, NULL, 0, 0);
                nrows = 0;
                block_begin(out, st, p);
            }
        } else if (rc == SQLITE_DONE) {
            break;
        } else {
            status = p->extended_errcode(db->h);
            *message = dup_cstr(p->errmsg(db->h));
            p->reset(st);
            return status;
        }
    }
    *changes = p->changes(db->h);
    *rowid = p->last_insert_rowid(db->h);
    block_end(out, nrows, *changes, *rowid);
    p->reset(st);
    return 0;
}

static int exec_simple(NSDb* db, const char* sql, char** message) {
    NSSqliteProvider* p = &db->eng->p;
    char* err = NULL;
    int rc = p->exec(db->h, sql, NULL, NULL, &err);
    if (rc != SQLITE_OK) {
        if (message) *message = dup_cstr(err ? err : p->errmsg(db->h));
        p->free(err);
        return p->extended_errcode(db->h) ? p->extended_errcode(db->h) : rc;
    }
    return 0;
}

/* ---- request handlers ---- */

static void do_open(NSDb* db, Req* r) {
    NSSqliteProvider* p = &db->eng->p;
    int flags = db->opts.flags ? db->opts.flags : (SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE);
    int rc = p->open_v2(db->path, &db->h, flags, NULL);
    if (rc != SQLITE_OK) {
        db->open_status = db->h ? p->extended_errcode(db->h) : rc;
        db->open_message = dup_cstr(db->h ? p->errmsg(db->h) : "unable to open database");
        if (db->h) {
            p->close_v2(db->h);
            db->h = NULL;
        }
        deliver(r, db->open_status, 1, NULL, 0, dup_cstr(db->open_message), 0, 0);
        return;
    }
    int bt = db->opts.busy_timeout_ms == 0 ? DEFAULT_BUSY_TIMEOUT_MS : db->opts.busy_timeout_ms;
    if (bt > 0) p->busy_timeout(db->h, bt);
    char* msg = NULL;
    int status = 0;
    if (db->opts.wal && strcmp(db->path, ":memory:") != 0) status = exec_simple(db, "PRAGMA journal_mode=WAL", &msg);
    if (!status && db->init_sql) status = exec_simple(db, db->init_sql, &msg);
    if (status) {
        db->open_status = status;
        db->open_message = dup_cstr(msg);
        p->close_v2(db->h);
        db->h = NULL;
        deliver(r, status, 1, NULL, 0, msg, 0, 0);
        return;
    }
    deliver(r, 0, 1, NULL, 0, NULL, 0, 0);
}

static void do_exec(NSDb* db, Req* r) {
    char* message = NULL;
    if (r->flags & NS_EXEC_SCRIPT) {
        char* sql = (char*)r->sql;
        int rc = exec_simple(db, sql, &message);
        deliver(r, rc, 1, NULL, 0, message, rc ? 0 : db->eng->p.changes(db->h), 0);
        return;
    }
    NSBuf out;
    nssqlite_buf_init(&out);
    int64_t changes = 0, rowid = 0;
    int status = run_stmt(db, r->sql, r->sql_len, r->params, r->params_len, r, r->chunk_rows, &out, &changes, &rowid, &message);
    if (status) {
        nssqlite_buf_free(&out);
        deliver(r, status, 1, NULL, 0, message, 0, 0);
        return;
    }
    size_t len;
    uint8_t* data = nssqlite_buf_take(&out, &len);
    if (!data) {
        deliver_error(r, NS_ERR_NOMEM, "out of memory");
        return;
    }
    deliver(r, 0, 1, data, len, NULL, changes, rowid);
}

static void do_batch(NSDb* db, Req* r) {
    NSReader rd;
    uint32_t n = 0;
    nssqlite_reader_init(&rd, r->params, r->params_len);
    if (nssqlite_reader_u32(&rd, &n)) {
        deliver_error(r, NS_ERR_INVALID, "malformed batch");
        return;
    }
    int atomic = (r->flags & NS_BATCH_ATOMIC) != 0;
    int in_tx = r->tx != 0;
    char* message = NULL;
    int status = 0;
    if (atomic) status = exec_simple(db, in_tx ? "SAVEPOINT nssqlite_batch" : "BEGIN IMMEDIATE", &message);
    NSBuf out;
    nssqlite_buf_init(&out);
    nssqlite_buf_u32(&out, 0); /* patched with the number of completed statements */
    uint32_t done = 0;
    int64_t last_changes = 0, last_rowid = 0;
    for (uint32_t i = 0; !status && i < n; i++) {
        uint32_t sql_len, params_len;
        const uint8_t *sql, *params;
        if (nssqlite_reader_u32(&rd, &sql_len) || nssqlite_reader_bytes(&rd, sql_len, &sql) || nssqlite_reader_u32(&rd, &params_len) ||
            nssqlite_reader_bytes(&rd, params_len, &params)) {
            status = NS_ERR_INVALID;
            message = dup_cstr("malformed batch");
            break;
        }
        /* sql inside the batch buffer is not NUL terminated: copy */
        uint8_t* sql_copy = (uint8_t*)malloc((size_t)sql_len + 1);
        if (!sql_copy) {
            status = NS_ERR_NOMEM;
            message = dup_cstr("out of memory");
            break;
        }
        memcpy(sql_copy, sql, sql_len);
        sql_copy[sql_len] = 0;
        NSBuf block;
        nssqlite_buf_init(&block);
        status = run_stmt(db, sql_copy, sql_len, params, params_len, NULL, 0, &block, &last_changes, &last_rowid, &message);
        free(sql_copy);
        if (!status) {
            nssqlite_buf_u32(&out, (uint32_t)block.len);
            nssqlite_buf_bytes(&out, block.data, block.len);
            done++;
        }
        nssqlite_buf_free(&block);
    }
    if (atomic) {
        if (status) {
            exec_simple(db, in_tx ? "ROLLBACK TO nssqlite_batch; RELEASE nssqlite_batch" : "ROLLBACK", NULL);
        } else {
            char* m2 = NULL;
            int rc = exec_simple(db, in_tx ? "RELEASE nssqlite_batch" : "COMMIT", &m2);
            if (rc) {
                status = rc;
                message = m2;
                if (!in_tx) exec_simple(db, "ROLLBACK", NULL);
            }
        }
    }
    nssqlite_buf_patch_u32(&out, 0, atomic && status ? 0 : done);
    size_t len;
    uint8_t* data = nssqlite_buf_take(&out, &len);
    if (!data && !status) {
        status = NS_ERR_NOMEM;
        message = dup_cstr("out of memory");
    }
    deliver(r, status, 1, data, len, message, last_changes, last_rowid);
}

static void do_tx_begin(NSDb* db, Req* r) {
    static const char* modes[] = {"BEGIN DEFERRED", "BEGIN IMMEDIATE", "BEGIN EXCLUSIVE"};
    char* message = NULL;
    db->active_tx = r->tx;
    db->tx_status = 0;
    free(db->tx_message);
    db->tx_message = NULL;
    int status = exec_simple(db, modes[r->mode >= 0 && r->mode <= 2 ? r->mode : 0], &message);
    if (status) {
        db->tx_status = status;
        db->tx_message = dup_cstr(message);
    }
    deliver(r, status, 1, NULL, 0, message, 0, 0);
}

static void do_tx_end(NSDb* db, Req* r) {
    char* message = NULL;
    int status = 0;
    if (db->tx_status) {
        status = NS_ERR_TX;
        message = dup_cstr(db->tx_message);
    } else if (r->commit) {
        status = exec_simple(db, "COMMIT", &message);
        if (status) exec_simple(db, "ROLLBACK", NULL); /* never leave the connection inside a transaction */
    } else {
        status = exec_simple(db, "ROLLBACK", &message);
    }
    db->active_tx = 0;
    db->tx_status = 0;
    free(db->tx_message);
    db->tx_message = NULL;
    deliver(r, status, 1, NULL, 0, message, 0, 0);
}

static void do_load_ext(NSDb* db, Req* r) {
    NSSqliteProvider* p = &db->eng->p;
    if (!p->enable_load_extension || !p->load_extension) {
        deliver_error(r, NS_ERR_UNSUPPORTED, "this SQLite engine cannot load extensions");
        return;
    }
    char* err = NULL;
    p->enable_load_extension(db->h, 1);
    int rc = p->load_extension(db->h, (const char*)r->sql, r->s2, &err);
    p->enable_load_extension(db->h, 0);
    char* message = rc ? dup_cstr(err ? err : p->errmsg(db->h)) : NULL;
    p->free(err);
    deliver(r, rc ? (p->extended_errcode(db->h) ? p->extended_errcode(db->h) : rc) : 0, 1, NULL, 0, message, 0, 0);
}

static void handle(NSDb* db, Req* r) {
    if (r->type == REQ_OPEN) {
        do_open(db, r);
        return;
    }
    if (!db->h) {
        deliver_error(r, NS_ERR_CLOSED, db->open_message ? db->open_message : "database is not open");
        return;
    }
    if (r->tx && db->tx_status && r->type != REQ_TX_END) {
        deliver_error(r, NS_ERR_TX, db->tx_message ? db->tx_message : "transaction failed to start");
        return;
    }
    switch (r->type) {
        case REQ_EXEC: do_exec(db, r); break;
        case REQ_BATCH: do_batch(db, r); break;
        case REQ_TX_BEGIN: do_tx_begin(db, r); break;
        case REQ_TX_END: do_tx_end(db, r); break;
        case REQ_LOAD_EXT: do_load_ext(db, r); break;
    }
}

/* ---- scheduler / worker thread ---- */

/* A request may run when it does not break the transaction pin. Called with db->mu held. */
static int eligible(NSDb* db, const Req* r) {
    if (r->type == REQ_OPEN) return 1;
    if (r->type == REQ_TX_BEGIN) return db->active_tx == 0;
    if (r->tx == 0) return db->active_tx == 0;
    return db->active_tx == r->tx;
}

static Req* pick(NSDb* db) {
    Req* prev = NULL;
    for (Req* r = db->head; r; prev = r, r = r->next) {
        if (eligible(db, r)) {
            if (prev) prev->next = r->next; else db->head = r->next;
            if (db->tail == r) db->tail = prev;
            r->next = NULL;
            return r;
        }
    }
    return NULL;
}

static void* worker(void* arg) {
    NSDb* db = (NSDb*)arg;
    for (;;) {
        pthread_mutex_lock(&db->mu);
        Req* r;
        while (!(r = pick(db)) && !db->close_req) pthread_cond_wait(&db->cv, &db->mu);
        if (!r) { /* closing and nothing eligible is left */
            Req* pending = db->head;
            db->head = db->tail = NULL;
            Req* c = db->close_req;
            db->close_req = NULL;
            pthread_mutex_unlock(&db->mu);
            while (pending) {
                Req* next = pending->next;
                deliver_error(pending, NS_ERR_CLOSED, "database closed");
                req_free(pending);
                pending = next;
            }
            char* message = NULL;
            int status = 0;
            if (db->h) {
                if (db->active_tx) exec_simple(db, "ROLLBACK", NULL);
                cache_clear(db);
                int rc = db->eng->p.close_v2(db->h);
                if (rc != SQLITE_OK) {
                    status = rc;
                    message = dup_cstr("sqlite3_close_v2 failed");
                }
                db->h = NULL;
            }
            deliver(c, status, 1, NULL, 0, message, 0, 0);
            req_free(c);
            nssqlite_db_release(db); /* the worker's reference */
            return NULL;
        }
        pthread_mutex_unlock(&db->mu);
        handle(db, r);
        req_free(r);
    }
}

/* ---- submission ---- */

static int submit(NSDb* db, Req* r) {
    pthread_mutex_lock(&db->mu);
    if (db->closing) {
        pthread_mutex_unlock(&db->mu);
        req_free(r);
        return NS_ERR_CLOSED;
    }
    if (db->tail) db->tail->next = r; else db->head = r;
    db->tail = r;
    pthread_cond_signal(&db->cv);
    pthread_mutex_unlock(&db->mu);
    return 0;
}

static Req* req_new(int type, uint32_t tx, NSCallback cb, void* user) {
    Req* r = (Req*)calloc(1, sizeof(*r));
    if (r) {
        r->type = type;
        r->tx = tx;
        r->cb = cb;
        r->user = user;
    }
    return r;
}

NSDb* nssqlite_open(NSEngine* e, const char* path, const NSOpenOptions* opts, NSCallback cb, void* user) {
    if (!e || !path) return NULL;
    NSDb* db = (NSDb*)calloc(1, sizeof(*db));
    if (!db) return NULL;
    db->eng = e;
    atomic_init(&db->refs, 2); /* caller + worker */
    pthread_mutex_init(&db->mu, NULL);
    pthread_cond_init(&db->cv, NULL);
    db->path = dup_cstr(path);
    if (opts) db->opts = *opts;
    db->init_sql = dup_cstr(db->opts.init_sql);
    db->opts.init_sql = NULL;
    db->next_tx = 1;
    Req* r = req_new(REQ_OPEN, 0, cb, user);
    if (!db->path || !r) {
        free(r);
        atomic_store(&db->refs, 1);
        nssqlite_db_release(db);
        return NULL;
    }
    db->head = db->tail = r;
    pthread_attr_t attr;
    pthread_attr_init(&attr);
    pthread_attr_setdetachstate(&attr, PTHREAD_CREATE_DETACHED);
    pthread_attr_setstacksize(&attr, 512 * 1024);
    pthread_t th;
    int rc = pthread_create(&th, &attr, worker, db);
    pthread_attr_destroy(&attr);
    if (rc != 0) {
        free(r);
        db->head = db->tail = NULL;
        atomic_store(&db->refs, 1);
        nssqlite_db_release(db);
        return NULL;
    }
    return db;
}

int nssqlite_exec(NSDb* db, uint32_t tx, const char* sql, size_t sql_len, const uint8_t* params, size_t params_len, uint32_t flags, uint32_t chunk_rows,
                  NSCallback cb, void* user) {
    if (!db || !sql) return NS_ERR_INVALID;
    Req* r = req_new(REQ_EXEC, tx, cb, user);
    if (!r) return NS_ERR_NOMEM;
    r->flags = flags;
    r->chunk_rows = chunk_rows;
    r->sql = (uint8_t*)malloc(sql_len + 1);
    r->sql_len = sql_len;
    r->params = (uint8_t*)dup_bytes(params, params_len);
    r->params_len = params ? params_len : 0;
    if (!r->sql || (params_len && params && !r->params)) {
        req_free(r);
        return NS_ERR_NOMEM;
    }
    memcpy(r->sql, sql, sql_len);
    r->sql[sql_len] = 0;
    return submit(db, r);
}

int nssqlite_batch(NSDb* db, uint32_t tx, const uint8_t* req, size_t req_len, uint32_t flags, NSCallback cb, void* user) {
    if (!db || !req) return NS_ERR_INVALID;
    Req* r = req_new(REQ_BATCH, tx, cb, user);
    if (!r) return NS_ERR_NOMEM;
    r->flags = flags;
    r->params = (uint8_t*)dup_bytes(req, req_len);
    r->params_len = req_len;
    if (req_len && !r->params) {
        req_free(r);
        return NS_ERR_NOMEM;
    }
    return submit(db, r);
}

uint32_t nssqlite_tx_begin(NSDb* db, int mode, NSCallback cb, void* user) {
    if (!db) return 0;
    pthread_mutex_lock(&db->mu);
    uint32_t id = db->next_tx++;
    if (db->next_tx == 0) db->next_tx = 1;
    pthread_mutex_unlock(&db->mu);
    Req* r = req_new(REQ_TX_BEGIN, id, cb, user);
    if (!r) return 0;
    r->mode = mode;
    return submit(db, r) == 0 ? id : 0;
}

int nssqlite_tx_end(NSDb* db, uint32_t tx, int commit, NSCallback cb, void* user) {
    if (!db || !tx) return NS_ERR_INVALID;
    Req* r = req_new(REQ_TX_END, tx, cb, user);
    if (!r) return NS_ERR_NOMEM;
    r->commit = commit;
    return submit(db, r);
}

int nssqlite_load_extension(NSDb* db, const char* path, const char* entry, NSCallback cb, void* user) {
    if (!db || !path) return NS_ERR_INVALID;
    Req* r = req_new(REQ_LOAD_EXT, 0, cb, user);
    if (!r) return NS_ERR_NOMEM;
    r->sql = (uint8_t*)dup_cstr(path);
    r->s2 = dup_cstr(entry);
    if (!r->sql || (entry && !r->s2)) {
        req_free(r);
        return NS_ERR_NOMEM;
    }
    return submit(db, r);
}

int nssqlite_close(NSDb* db, NSCallback cb, void* user) {
    if (!db) return NS_ERR_INVALID;
    Req* r = req_new(REQ_OPEN /* unused */, 0, cb, user);
    if (!r) return NS_ERR_NOMEM;
    pthread_mutex_lock(&db->mu);
    if (db->closing) {
        pthread_mutex_unlock(&db->mu);
        req_free(r);
        return NS_ERR_CLOSED;
    }
    db->closing = 1;
    db->close_req = r;
    pthread_cond_signal(&db->cv);
    pthread_mutex_unlock(&db->mu);
    return 0;
}

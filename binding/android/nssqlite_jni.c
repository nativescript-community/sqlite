/*
 * JNI bridge for runtimes without Node-API (NativeScript <= 8). Thin by design: every method maps
 * one-to-one to the core API and moves bytes in and out. Parameters and results are direct
 * ByteBuffers, which the NativeScript Android runtime converts to and from ArrayBuffer.
 *
 * Results are delivered to the Java class NativeSqlite.dispatch, which posts to the Looper of the
 * thread that made the call. The result ByteBuffer wraps native memory owned by the core: Java must
 * call NativeSqlite.freeNative(ptr) once the data was decoded.
 */
#include <jni.h>
#include <pthread.h>
#include <stdlib.h>
#include <string.h>

#include "../../core/nssqlite.h"

#define JNI_FN(name) Java_com_akylas_sqlite_NativeSqlite_##name

static JavaVM* g_vm;
static jclass g_class;          /* com.akylas.sqlite.NativeSqlite (global ref) */
static jmethodID g_dispatch;    /* static void dispatch(Object ctx, int status, boolean done, ByteBuffer data, long dataPtr, String message, long changes, long rowid) */
static pthread_key_t g_detach_key;

typedef struct CallCtx {
    jobject target; /* global ref to the Java dispatch object */
} CallCtx;

static void detach_thread(void* arg) {
    (void)arg;
    if (g_vm) (*g_vm)->DetachCurrentThread(g_vm);
}

static JNIEnv* env_for_thread(void) {
    JNIEnv* env = NULL;
    if ((*g_vm)->GetEnv(g_vm, (void**)&env, JNI_VERSION_1_6) == JNI_OK) return env;
    if ((*g_vm)->AttachCurrentThread(g_vm, &env, NULL) != JNI_OK) return NULL;
    pthread_setspecific(g_detach_key, (void*)1); /* run detach_thread when the worker exits */
    return env;
}

static void on_result(void* user, NSResult r) {
    CallCtx* ctx = (CallCtx*)user;
    JNIEnv* env = env_for_thread();
    if (!env) {
        free(r.data);
        free(r.message);
        if (r.done) free(ctx);
        return;
    }
    jobject buf = NULL;
    if (r.data) buf = (*env)->NewDirectByteBuffer(env, r.data, (jlong)r.len);
    jstring msg = r.message ? (*env)->NewStringUTF(env, r.message) : NULL;
    free(r.message);
    (*env)->CallStaticVoidMethod(env, g_class, g_dispatch, ctx->target, (jint)r.status, (jboolean)(r.done != 0), buf, (jlong)(intptr_t)r.data,
                                 msg, (jlong)r.changes, (jlong)r.last_insert_rowid);
    if ((*env)->ExceptionCheck(env)) (*env)->ExceptionClear(env);
    if (buf) (*env)->DeleteLocalRef(env, buf);
    if (msg) (*env)->DeleteLocalRef(env, msg);
    if (r.done) {
        (*env)->DeleteGlobalRef(env, ctx->target);
        free(ctx);
    }
}

static CallCtx* ctx_new(JNIEnv* env, jobject target) {
    CallCtx* c = (CallCtx*)malloc(sizeof(*c));
    if (!c) return NULL;
    c->target = (*env)->NewGlobalRef(env, target);
    return c;
}

/* Called when a submit function refused the request (the callback will not run). */
static void ctx_drop(JNIEnv* env, CallCtx* c) {
    if (!c) return;
    (*env)->DeleteGlobalRef(env, c->target);
    free(c);
}

static void throw_runtime(JNIEnv* env, const char* msg) {
    jclass cls = (*env)->FindClass(env, "java/lang/RuntimeException");
    if (cls) (*env)->ThrowNew(env, cls, msg);
}

static const uint8_t* direct_bytes(JNIEnv* env, jobject buf, size_t* len) {
    if (!buf) {
        *len = 0;
        return NULL;
    }
    void* p = (*env)->GetDirectBufferAddress(env, buf);
    jlong cap = (*env)->GetDirectBufferCapacity(env, buf);
    *len = cap < 0 ? 0 : (size_t)cap;
    return (const uint8_t*)p;
}

JNIEXPORT jlong JNICALL JNI_FN(engine)(JNIEnv* env, jclass cls, jstring library) {
    char err[256] = {0};
    const char* lib = library ? (*env)->GetStringUTFChars(env, library, NULL) : NULL;
    NSEngine* e = nssqlite_engine(lib, err, sizeof(err));
    if (library) (*env)->ReleaseStringUTFChars(env, library, lib);
    if (!e) {
        throw_runtime(env, err);
        return 0;
    }
    return (jlong)(intptr_t)e;
}

JNIEXPORT jstring JNICALL JNI_FN(engineVersion)(JNIEnv* env, jclass cls, jlong engine) {
    return (*env)->NewStringUTF(env, nssqlite_engine_version((NSEngine*)(intptr_t)engine));
}

JNIEXPORT jboolean JNICALL JNI_FN(engineCanLoadExtensions)(JNIEnv* env, jclass cls, jlong engine) {
    return nssqlite_engine_can_load_extensions((NSEngine*)(intptr_t)engine) ? JNI_TRUE : JNI_FALSE;
}

JNIEXPORT jint JNICALL JNI_FN(engineAutoExtension)(JNIEnv* env, jclass cls, jlong engine, jlong initFn) {
    return nssqlite_engine_auto_extension((NSEngine*)(intptr_t)engine, (void (*)(void))(intptr_t)initFn);
}

JNIEXPORT jlong JNICALL JNI_FN(nOpen)(JNIEnv* env, jclass cls, jlong engine, jstring path, jint flags, jint busyMs, jboolean wal, jstring initSql,
                                     jobject target) {
    const char* p = (*env)->GetStringUTFChars(env, path, NULL);
    const char* init = initSql ? (*env)->GetStringUTFChars(env, initSql, NULL) : NULL;
    NSOpenOptions o;
    memset(&o, 0, sizeof(o));
    o.flags = flags;
    o.busy_timeout_ms = busyMs;
    o.wal = wal ? 1 : 0;
    o.init_sql = init;
    CallCtx* ctx = ctx_new(env, target);
    NSDb* db = nssqlite_open((NSEngine*)(intptr_t)engine, p, &o, on_result, ctx);
    (*env)->ReleaseStringUTFChars(env, path, p);
    if (initSql) (*env)->ReleaseStringUTFChars(env, initSql, init);
    if (!db) {
        ctx_drop(env, ctx);
        throw_runtime(env, "nssqlite_open failed");
        return 0;
    }
    return (jlong)(intptr_t)db;
}

JNIEXPORT void JNICALL JNI_FN(release)(JNIEnv* env, jclass cls, jlong db) { nssqlite_db_release((NSDb*)(intptr_t)db); }

JNIEXPORT jint JNICALL JNI_FN(nExec)(JNIEnv* env, jclass cls, jlong db, jint tx, jstring sql, jobject params, jint flags, jint chunkRows, jobject target) {
    jsize sql_len = (*env)->GetStringUTFLength(env, sql);
    const char* s = (*env)->GetStringUTFChars(env, sql, NULL);
    size_t plen;
    const uint8_t* pdata = direct_bytes(env, params, &plen);
    CallCtx* ctx = ctx_new(env, target);
    int rc = nssqlite_exec((NSDb*)(intptr_t)db, (uint32_t)tx, s, (size_t)sql_len, pdata, plen, (uint32_t)flags, (uint32_t)chunkRows, on_result, ctx);
    (*env)->ReleaseStringUTFChars(env, sql, s);
    if (rc) ctx_drop(env, ctx);
    return rc;
}

JNIEXPORT jint JNICALL JNI_FN(nBatch)(JNIEnv* env, jclass cls, jlong db, jint tx, jobject req, jint flags, jobject target) {
    size_t len;
    const uint8_t* data = direct_bytes(env, req, &len);
    CallCtx* ctx = ctx_new(env, target);
    int rc = nssqlite_batch((NSDb*)(intptr_t)db, (uint32_t)tx, data, len, (uint32_t)flags, on_result, ctx);
    if (rc) ctx_drop(env, ctx);
    return rc;
}

JNIEXPORT jint JNICALL JNI_FN(nTxBegin)(JNIEnv* env, jclass cls, jlong db, jint mode, jobject target) {
    CallCtx* ctx = ctx_new(env, target);
    uint32_t id = nssqlite_tx_begin((NSDb*)(intptr_t)db, mode, on_result, ctx);
    if (!id) ctx_drop(env, ctx);
    return (jint)id;
}

JNIEXPORT jint JNICALL JNI_FN(nTxEnd)(JNIEnv* env, jclass cls, jlong db, jint tx, jboolean commit, jobject target) {
    CallCtx* ctx = ctx_new(env, target);
    int rc = nssqlite_tx_end((NSDb*)(intptr_t)db, (uint32_t)tx, commit ? 1 : 0, on_result, ctx);
    if (rc) ctx_drop(env, ctx);
    return rc;
}

JNIEXPORT jint JNICALL JNI_FN(nLoadExtension)(JNIEnv* env, jclass cls, jlong db, jstring path, jstring entry, jobject target) {
    const char* p = (*env)->GetStringUTFChars(env, path, NULL);
    const char* e = entry ? (*env)->GetStringUTFChars(env, entry, NULL) : NULL;
    CallCtx* ctx = ctx_new(env, target);
    int rc = nssqlite_load_extension((NSDb*)(intptr_t)db, p, e, on_result, ctx);
    (*env)->ReleaseStringUTFChars(env, path, p);
    if (entry) (*env)->ReleaseStringUTFChars(env, entry, e);
    if (rc) ctx_drop(env, ctx);
    return rc;
}

JNIEXPORT jint JNICALL JNI_FN(nClose)(JNIEnv* env, jclass cls, jlong db, jobject target) {
    CallCtx* ctx = ctx_new(env, target);
    int rc = nssqlite_close((NSDb*)(intptr_t)db, on_result, ctx);
    if (rc) ctx_drop(env, ctx);
    return rc;
}

JNIEXPORT void JNICALL JNI_FN(freeNative)(JNIEnv* env, jclass cls, jlong ptr) { nssqlite_free((void*)(intptr_t)ptr); }

JNIEXPORT jint JNI_OnLoad(JavaVM* vm, void* reserved) {
    (void)reserved;
    JNIEnv* env;
    if ((*vm)->GetEnv(vm, (void**)&env, JNI_VERSION_1_6) != JNI_OK) return JNI_ERR;
    g_vm = vm;
    pthread_key_create(&g_detach_key, detach_thread);
    jclass cls = (*env)->FindClass(env, "com/akylas/sqlite/NativeSqlite");
    if (!cls) return JNI_ERR;
    g_class = (jclass)(*env)->NewGlobalRef(env, cls);
    g_dispatch = (*env)->GetStaticMethodID(env, cls, "dispatch", "(Ljava/lang/Object;IZLjava/nio/ByteBuffer;JLjava/lang/String;JJ)V");
    if (!g_dispatch) return JNI_ERR;
    return JNI_VERSION_1_6;
}

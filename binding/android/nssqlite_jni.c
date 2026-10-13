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
static jmethodID g_dispatch;    /* static void dispatch(long id, int status, boolean done, ByteBuffer data, long dataPtr, String message, long changes, long rowid) */
static pthread_key_t g_detach_key;

/* A request is identified by an integer chosen by the Java side: nothing is allocated or pinned per request
 * (the NativeScript runtime aborts the process when a lot of JNI global references are alive at once). */
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
    jlong id = (jlong)(intptr_t)user;
    JNIEnv* env = env_for_thread();
    if (!env) {
        free(r.data);
        free(r.message);
        return;
    }
    jobject buf = NULL;
    if (r.data) buf = (*env)->NewDirectByteBuffer(env, r.data, (jlong)r.len);
    jstring msg = r.message ? (*env)->NewStringUTF(env, r.message) : NULL;
    free(r.message);
    (*env)->CallStaticVoidMethod(env, g_class, g_dispatch, id, (jint)r.status, (jboolean)(r.done != 0), buf, (jlong)(intptr_t)r.data, msg,
                                 (jdouble)r.changes, (jdouble)r.last_insert_rowid);
    if ((*env)->ExceptionCheck(env)) (*env)->ExceptionClear(env);
    if (buf) (*env)->DeleteLocalRef(env, buf);
    if (msg) (*env)->DeleteLocalRef(env, msg);
}

#define CTX(id) ((void*)(intptr_t)(id))

static void throw_runtime(JNIEnv* env, const char* msg) {
    jclass cls = (*env)->FindClass(env, "java/lang/RuntimeException");
    if (cls) (*env)->ThrowNew(env, cls, msg);
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
                                     jlong id) {
    const char* p = (*env)->GetStringUTFChars(env, path, NULL);
    const char* init = initSql ? (*env)->GetStringUTFChars(env, initSql, NULL) : NULL;
    NSOpenOptions o;
    memset(&o, 0, sizeof(o));
    o.flags = flags;
    o.busy_timeout_ms = busyMs;
    o.wal = wal ? 1 : 0;
    o.init_sql = init;
    NSDb* db = nssqlite_open((NSEngine*)(intptr_t)engine, p, &o, on_result, CTX(id));
    (*env)->ReleaseStringUTFChars(env, path, p);
    if (initSql) (*env)->ReleaseStringUTFChars(env, initSql, init);
    if (!db) {
        throw_runtime(env, "nssqlite_open failed");
        return 0;
    }
    return (jlong)(intptr_t)db;
}

JNIEXPORT void JNICALL JNI_FN(release)(JNIEnv* env, jclass cls, jlong db) { nssqlite_db_release((NSDb*)(intptr_t)db); }

JNIEXPORT jint JNICALL JNI_FN(nExec)(JNIEnv* env, jclass cls, jlong db, jint tx, jobject arena, jint sqlLen, jint paramsLen, jint flags, jint chunkRows,
                                     jlong id) {
    const uint8_t* p = (const uint8_t*)(*env)->GetDirectBufferAddress(env, arena);
    jlong cap = (*env)->GetDirectBufferCapacity(env, arena);
    if (!p || sqlLen < 0 || paramsLen < 0 || (jlong)sqlLen + paramsLen > cap) return NS_ERR_INVALID;
    return nssqlite_exec((NSDb*)(intptr_t)db, (uint32_t)tx, (const char*)p, (size_t)sqlLen, paramsLen ? p + sqlLen : NULL, (size_t)paramsLen, (uint32_t)flags,
                         (uint32_t)chunkRows, on_result, CTX(id));
}

JNIEXPORT jint JNICALL JNI_FN(nBatch)(JNIEnv* env, jclass cls, jlong db, jint tx, jobject arena, jint len, jint flags, jlong id) {
    const uint8_t* p = (const uint8_t*)(*env)->GetDirectBufferAddress(env, arena);
    jlong cap = (*env)->GetDirectBufferCapacity(env, arena);
    if (!p || len < 0 || len > cap) return NS_ERR_INVALID;
    return nssqlite_batch((NSDb*)(intptr_t)db, (uint32_t)tx, p, (size_t)len, (uint32_t)flags, on_result, CTX(id));
}

JNIEXPORT jint JNICALL JNI_FN(nTxBegin)(JNIEnv* env, jclass cls, jlong db, jint mode, jlong id) {
    return (jint)nssqlite_tx_begin((NSDb*)(intptr_t)db, mode, on_result, CTX(id));
}

JNIEXPORT jint JNICALL JNI_FN(nTxEnd)(JNIEnv* env, jclass cls, jlong db, jint tx, jboolean commit, jlong id) {
    return nssqlite_tx_end((NSDb*)(intptr_t)db, (uint32_t)tx, commit ? 1 : 0, on_result, CTX(id));
}

JNIEXPORT jint JNICALL JNI_FN(nLoadExtension)(JNIEnv* env, jclass cls, jlong db, jstring path, jstring entry, jlong id) {
    const char* p = (*env)->GetStringUTFChars(env, path, NULL);
    const char* e = entry ? (*env)->GetStringUTFChars(env, entry, NULL) : NULL;
    int rc = nssqlite_load_extension((NSDb*)(intptr_t)db, p, e, on_result, CTX(id));
    (*env)->ReleaseStringUTFChars(env, path, p);
    if (entry) (*env)->ReleaseStringUTFChars(env, entry, e);
    return rc;
}

JNIEXPORT jint JNICALL JNI_FN(nClose)(JNIEnv* env, jclass cls, jlong db, jlong id) {
    return nssqlite_close((NSDb*)(intptr_t)db, on_result, CTX(id));
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
    g_dispatch = (*env)->GetStaticMethodID(env, cls, "dispatch", "(JIZLjava/nio/ByteBuffer;JLjava/lang/String;DD)V");
    if (!g_dispatch) return JNI_ERR;
    return JNI_VERSION_1_6;
}

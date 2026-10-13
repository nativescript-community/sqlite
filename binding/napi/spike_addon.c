/* Spike addon: proves Node-API loading, cross-thread delivery, external ArrayBuffers
 * and the SQLite provider loader inside NativeScript runtimes. Not the final binding. */
#include <node_api.h>

#include <pthread.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#ifdef __ANDROID__
#include <sys/syscall.h>
#endif

#include "../../core/provider.h"

#define NS_CALL(env, call)                                                   \
    do {                                                                     \
        napi_status s_ = (call);                                             \
        if (s_ != napi_ok) {                                                 \
            napi_throw_error((env), NULL, "napi call failed: " #call);       \
            return NULL;                                                     \
        }                                                                    \
    } while (0)

static napi_value Hello(napi_env env, napi_callback_info info) {
    (void)info;
    napi_value r;
    NS_CALL(env, napi_create_string_utf8(env, "nssqlite spike addon", NAPI_AUTO_LENGTH, &r));
    return r;
}

/* ---- ping: native thread -> threadsafe function -> JS callback with external ArrayBuffer ---- */

typedef struct {
    char* data;
    size_t len;
    long tid;
    long caller_tid;
} PingResult;

typedef struct {
    napi_threadsafe_function tsfn;
    long caller_tid;
} PingCtx;

static long current_tid(void) {
#ifdef __ANDROID__
    return (long)syscall(SYS_gettid);
#else
    return (long)(uintptr_t)pthread_self();
#endif
}

static void free_buf(napi_env env, void* data, void* hint) {
    (void)env;
    (void)hint;
    free(data);
}

static void PingCallJs(napi_env env, napi_value js_cb, void* context, void* data) {
    (void)context;
    PingResult* r = (PingResult*)data;
    if (env && js_cb) {
        napi_value ab, tid, caller, undef;
        void* out = NULL;
        napi_get_undefined(env, &undef);
        /* external arraybuffer: zero-copy, finalizer runs on env thread */
        if (napi_create_external_arraybuffer(env, r->data, r->len, free_buf, NULL, &ab) == napi_ok) {
            r->data = NULL;
        }
        (void)out;
        napi_create_int64(env, r->tid, &tid);
        napi_create_int64(env, r->caller_tid, &caller);
        napi_value argv[3] = {ab, tid, caller};
        napi_call_function(env, undef, js_cb, 3, argv, NULL);
    }
    free(r->data);
    free(r);
}

static void* PingThread(void* arg) {
    PingCtx* ctx = (PingCtx*)arg;
    usleep(50 * 1000);
    PingResult* r = (PingResult*)calloc(1, sizeof(*r));
    r->len = 16;
    r->data = (char*)malloc(r->len);
    memcpy(r->data, "hello from native", 16);
    r->tid = current_tid();
    r->caller_tid = ctx->caller_tid;
    napi_call_threadsafe_function(ctx->tsfn, r, napi_tsfn_blocking);
    napi_release_threadsafe_function(ctx->tsfn, napi_tsfn_release);
    free(ctx);
    return NULL;
}

static napi_value Ping(napi_env env, napi_callback_info info) {
    size_t argc = 1;
    napi_value argv[1];
    NS_CALL(env, napi_get_cb_info(env, info, &argc, argv, NULL, NULL));
    if (argc < 1) {
        napi_throw_type_error(env, NULL, "ping(cb)");
        return NULL;
    }
    napi_value name;
    NS_CALL(env, napi_create_string_utf8(env, "nssqlite-ping", NAPI_AUTO_LENGTH, &name));
    PingCtx* ctx = (PingCtx*)calloc(1, sizeof(*ctx));
    ctx->caller_tid = current_tid();
    NS_CALL(env, napi_create_threadsafe_function(env, argv[0], NULL, name, 0, 1, NULL, NULL, NULL, PingCallJs, &ctx->tsfn));
    pthread_t th;
    pthread_attr_t attr;
    pthread_attr_init(&attr);
    pthread_attr_setdetachstate(&attr, PTHREAD_CREATE_DETACHED);
    if (pthread_create(&th, &attr, PingThread, ctx) != 0) {
        napi_throw_error(env, NULL, "pthread_create failed");
    }
    pthread_attr_destroy(&attr);
    return NULL;
}

/* ---- sqliteTest(path|undefined): load provider, bind/step with typed values ---- */

static napi_value SqliteTest(napi_env env, napi_callback_info info) {
    size_t argc = 1;
    napi_value argv[1];
    NS_CALL(env, napi_get_cb_info(env, info, &argc, argv, NULL, NULL));
    char path[512];
    const char* ppath = NULL;
    napi_valuetype t = napi_undefined;
    if (argc >= 1) {
        napi_typeof(env, argv[0], &t);
    }
    if (t == napi_string) {
        size_t n = 0;
        napi_get_value_string_utf8(env, argv[0], path, sizeof(path), &n);
        ppath = path;
    }

    char out[512];
    char err[256] = {0};
    NSSqliteProvider p;
    int rc = nssqlite_provider_load(&p, ppath, err, sizeof(err));
    if (rc) {
        snprintf(out, sizeof(out), "ERR load rc=%d: %s", rc, err);
    } else {
        sqlite3* db = NULL;
        sqlite3_stmt* st = NULL;
        long long big = 0;
        int ok = p.open_v2(":memory:", &db, 0x2 | 0x4, NULL) == 0 &&
                 p.exec(db, "CREATE TABLE t(a INTEGER); INSERT INTO t VALUES (9007199254740993);", NULL, NULL, NULL) == 0 &&
                 p.prepare_v3(db, "SELECT a FROM t", -1, 0, &st, NULL) == 0 && p.step(st) == 100;
        if (ok) {
            big = p.column_int64(st, 0);
        }
        snprintf(out, sizeof(out), "sqlite=%s threadsafe=%d autoExt=%d loadExt=%d selectOk=%d int64=%lld", p.libversion(), p.threadsafe(),
                 p.auto_extension != NULL, p.enable_load_extension != NULL, ok, big);
        if (st) p.finalize(st);
        if (db) p.close_v2(db);
        nssqlite_provider_unload(&p);
    }
    napi_value r;
    NS_CALL(env, napi_create_string_utf8(env, out, NAPI_AUTO_LENGTH, &r));
    return r;
}

static napi_value Init(napi_env env, napi_value exports) {
    napi_property_descriptor props[] = {
        {"hello", NULL, Hello, NULL, NULL, NULL, napi_default, NULL},
        {"ping", NULL, Ping, NULL, NULL, NULL, napi_default, NULL},
        {"sqliteTest", NULL, SqliteTest, NULL, NULL, NULL, napi_default, NULL},
    };
    napi_define_properties(env, exports, 3, props);
    return exports;
}

static napi_module sModule = {
    NAPI_MODULE_VERSION, 0, __FILE__, Init, "nssqlite_spike", NULL, {0},
};

/* Idempotent. Called from a constructor (Android, dlopen) and from +load on iOS, where the
 * static library object would otherwise be dead-stripped (nothing references it). */
void nssqlite_napi_register(void);
__attribute__((visibility("default"))) void nssqlite_napi_register(void) {
    static int done = 0;
    if (!done) {
        done = 1;
        napi_module_register(&sModule);
    }
}

__attribute__((constructor)) static void RegisterNssqliteSpike(void) {
    nssqlite_napi_register();
}

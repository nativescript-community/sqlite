/*
 * Node-API binding for runtimes that expose Node-API (NativeScript >= 9.1). Used directly from JS:
 * every export maps to one core function. The buffers keep the core's wire format (nssqlite_wire.h).
 *
 * - Requests run on the core's database threads. Results are queued to the env that made the call
 *   with one napi_threadsafe_function per env, so it works on the main thread and in Workers.
 * - Result buffers are external ArrayBuffers over the core's memory (no copy).
 * - decodeRows builds the JS rows natively from a rows block, on the JS thread.
 * - napi_* functions are resolved at runtime (napi_dyn.h): nothing is linked against the runtime.
 *
 * JS callback: (status, done, data: ArrayBuffer | null, message: string | null, changes, lastInsertRowId)
 */
#include <node_api.h>

#include <pthread.h>
#include <stdatomic.h>
#include <stdlib.h>
#include <string.h>

#include "napi_dyn.h"
#include "nssqlite.h"
#include "nssqlite_wire.h"

/* ---- per env dispatcher ---- */

typedef struct Dispatcher {
    napi_threadsafe_function tsfn;
    pthread_mutex_t mu;
    int closed;          /* env is gone: results are dropped */
    atomic_int pending;  /* requests in flight */
    atomic_int refs;     /* env instance data + one per request */
} Dispatcher;

typedef struct Call {
    Dispatcher* d;
    napi_ref cb;
} Call;

typedef struct Delivery {
    Call* call;
    NSResult r;
} Delivery;

static void dispatcher_unref(Dispatcher* d) {
    if (atomic_fetch_sub(&d->refs, 1) == 1) {
        pthread_mutex_destroy(&d->mu);
        free(d);
    }
}

static void free_external_buffer(napi_env env, void* data, void* hint) {
    (void)env;
    (void)hint;
    nssqlite_free(data);
}

static void call_js(napi_env env, napi_value unused, void* context, void* data) {
    (void)unused;
    (void)context;
    Delivery* dv = (Delivery*)data;
    Call* call = dv->call;
    NSResult r = dv->r;
    free(dv);
    int done = r.done != 0;
    if (env) {
        napi_handle_scope scope;
        if (napi_open_handle_scope(env, &scope) == napi_ok) {
            napi_value cb, argv[6], undef, global;
            napi_value* argp = argv;
            napi_get_undefined(env, &undef);
            napi_get_global(env, &global);
            napi_create_int32(env, r.status, &argp[0]);
            napi_get_boolean(env, done, &argp[1]);
            if (r.data) {
                if (napi_create_external_arraybuffer(env, r.data, r.len, free_external_buffer, NULL, &argp[2]) != napi_ok) {
                    nssqlite_free(r.data);
                    napi_get_null(env, &argp[2]);
                }
            } else {
                napi_get_null(env, &argp[2]);
            }
            if (r.message) {
                napi_create_string_utf8(env, r.message, NAPI_AUTO_LENGTH, &argp[3]);
            } else {
                napi_get_null(env, &argp[3]);
            }
            napi_create_int64(env, r.changes, &argp[4]);
            napi_create_int64(env, r.last_insert_rowid, &argp[5]);
            if (napi_get_reference_value(env, call->cb, &cb) == napi_ok && cb) {
                napi_call_function(env, global, cb, 6, argv, NULL);
            }
            napi_close_handle_scope(env, scope);
            if (done) napi_delete_reference(env, call->cb);
        }
    } else {
        nssqlite_free(r.data);
    }
    nssqlite_free(r.message);
    if (done) {
        atomic_fetch_sub(&call->d->pending, 1);
        dispatcher_unref(call->d);
        free(call);
    }
}

/* Runs on a database thread. */
static void on_result(void* user, NSResult r) {
    Call* call = (Call*)user;
    Dispatcher* d = call->d;
    Delivery* dv = (Delivery*)malloc(sizeof(*dv));
    int sent = 0;
    if (dv) {
        dv->call = call;
        dv->r = r;
        pthread_mutex_lock(&d->mu);
        if (!d->closed) sent = napi_call_threadsafe_function(d->tsfn, dv, napi_tsfn_nonblocking) == napi_ok;
        pthread_mutex_unlock(&d->mu);
    }
    if (!sent) { /* env gone or out of memory: drop the result */
        nssqlite_free(r.data);
        nssqlite_free(r.message);
        free(dv);
        if (r.done) {
            atomic_fetch_sub(&d->pending, 1);
            dispatcher_unref(d);
            free(call); /* its napi_ref died with the env */
        }
    }
}

static void dispatcher_finalize(napi_env env, void* data, void* hint) {
    (void)env;
    (void)hint;
    Dispatcher* d = (Dispatcher*)data;
    pthread_mutex_lock(&d->mu);
    d->closed = 1;
    pthread_mutex_unlock(&d->mu);
    dispatcher_unref(d);
}

static napi_value noop(napi_env env, napi_callback_info info) {
    (void)env;
    (void)info;
    return NULL;
}

static Dispatcher* dispatcher_get(napi_env env) {
    Dispatcher* d = NULL;
    if (napi_get_instance_data(env, (void**)&d) == napi_ok && d) return d;
    d = (Dispatcher*)calloc(1, sizeof(*d));
    if (!d) return NULL;
    pthread_mutex_init(&d->mu, NULL);
    atomic_init(&d->pending, 0);
    atomic_init(&d->refs, 1);
    napi_value fn, name;
    napi_create_function(env, "nssqliteNoop", NAPI_AUTO_LENGTH, noop, NULL, &fn);
    napi_create_string_utf8(env, "nssqlite", NAPI_AUTO_LENGTH, &name);
    if (napi_create_threadsafe_function(env, fn, NULL, name, 0, 1, NULL, NULL, NULL, call_js, &d->tsfn) != napi_ok) {
        pthread_mutex_destroy(&d->mu);
        free(d);
        return NULL;
    }
    napi_set_instance_data(env, d, dispatcher_finalize, NULL);
    return d;
}

/* ---- helpers ---- */

static napi_value throw_error(napi_env env, const char* msg) {
    napi_throw_error(env, NULL, msg);
    return NULL;
}

#define ARGS(n)                                                                     \
    size_t argc = (n);                                                              \
    napi_value argv[(n) > 0 ? (n) : 1];                                             \
    if (napi_get_cb_info(env, info, &argc, argv, NULL, NULL) != napi_ok) return NULL; \
    if (argc < (n)) return throw_error(env, "missing arguments")

static char* get_utf8(napi_env env, napi_value v, size_t* out_len) {
    napi_valuetype t;
    if (napi_typeof(env, v, &t) != napi_ok || t != napi_string) return NULL;
    size_t len = 0;
    if (napi_get_value_string_utf8(env, v, NULL, 0, &len) != napi_ok) return NULL;
    char* s = (char*)malloc(len + 1);
    if (!s) return NULL;
    napi_get_value_string_utf8(env, v, s, len + 1, &len);
    if (out_len) *out_len = len;
    return s;
}

/* ArrayBuffer, TypedArray or DataView -> pointer + length (valid during this synchronous call). */
static int get_bytes(napi_env env, napi_value v, const uint8_t** data, size_t* len) {
    napi_valuetype t;
    *data = NULL;
    *len = 0;
    if (napi_typeof(env, v, &t) != napi_ok) return -1;
    if (t == napi_undefined || t == napi_null) return 0;
    bool b;
    if (napi_is_arraybuffer(env, v, &b) == napi_ok && b) {
        void* p;
        return napi_get_arraybuffer_info(env, v, &p, len) == napi_ok ? (*data = (const uint8_t*)p, 0) : -1;
    }
    if (napi_is_typedarray(env, v, &b) == napi_ok && b) {
        napi_typedarray_type tt;
        size_t n, off;
        void* p;
        napi_value ab;
        if (napi_get_typedarray_info(env, v, &tt, &n, &p, &ab, &off) != napi_ok) return -1;
        size_t elem = 1;
        switch (tt) {
            case napi_int16_array: case napi_uint16_array: elem = 2; break;
            case napi_int32_array: case napi_uint32_array: case napi_float32_array: elem = 4; break;
            case napi_float64_array: case napi_bigint64_array: case napi_biguint64_array: elem = 8; break;
            default: break;
        }
        *data = (const uint8_t*)p;
        *len = n * elem;
        return 0;
    }
    if (napi_is_dataview(env, v, &b) == napi_ok && b) {
        size_t n, off;
        void* p;
        napi_value ab;
        if (napi_get_dataview_info(env, v, &n, &p, &ab, &off) != napi_ok) return -1;
        *data = (const uint8_t*)p;
        *len = n;
        return 0;
    }
    return -1;
}

static Call* call_new(napi_env env, napi_value cb) {
    Dispatcher* d = dispatcher_get(env);
    if (!d) return NULL;
    napi_valuetype t;
    if (napi_typeof(env, cb, &t) != napi_ok || t != napi_function) return NULL;
    Call* c = (Call*)calloc(1, sizeof(*c));
    if (!c) return NULL;
    if (napi_create_reference(env, cb, 1, &c->cb) != napi_ok) {
        free(c);
        return NULL;
    }
    c->d = d;
    atomic_fetch_add(&d->pending, 1);
    atomic_fetch_add(&d->refs, 1);
    return c;
}

/* The core refused the request: its callback will not run. */
static void call_drop(napi_env env, Call* c) {
    if (!c) return;
    napi_delete_reference(env, c->cb);
    atomic_fetch_sub(&c->d->pending, 1);
    dispatcher_unref(c->d);
    free(c);
}

static void db_finalize(napi_env env, void* data, void* hint) {
    (void)env;
    (void)hint;
    nssqlite_db_release((NSDb*)data);
}

static NSDb* get_db(napi_env env, napi_value v) {
    void* p = NULL;
    if (napi_get_value_external(env, v, &p) != napi_ok) return NULL;
    return (NSDb*)p;
}

static napi_value int_result(napi_env env, int v) {
    napi_value r;
    napi_create_int32(env, v, &r);
    return r;
}

/* ---- exports ---- */

static napi_value Engine(napi_env env, napi_callback_info info) {
    ARGS(1);
    size_t n;
    char* lib = get_utf8(env, argv[0], &n);
    char err[256] = {0};
    NSEngine* e = nssqlite_engine(lib, err, sizeof(err));
    free(lib);
    if (!e) return throw_error(env, err);
    napi_value r;
    napi_create_external(env, e, NULL, NULL, &r);
    return r;
}

static NSEngine* get_engine(napi_env env, napi_value v) {
    void* p = NULL;
    if (napi_get_value_external(env, v, &p) != napi_ok) return NULL;
    return (NSEngine*)p;
}

static napi_value EngineVersion(napi_env env, napi_callback_info info) {
    ARGS(1);
    NSEngine* e = get_engine(env, argv[0]);
    if (!e) return throw_error(env, "invalid engine");
    napi_value r;
    napi_create_string_utf8(env, nssqlite_engine_version(e), NAPI_AUTO_LENGTH, &r);
    return r;
}

static napi_value EngineCanLoadExtensions(napi_env env, napi_callback_info info) {
    ARGS(1);
    NSEngine* e = get_engine(env, argv[0]);
    if (!e) return throw_error(env, "invalid engine");
    napi_value r;
    napi_get_boolean(env, nssqlite_engine_can_load_extensions(e) != 0, &r);
    return r;
}

/* open(engine, path, flags, busyMs, wal, initSql | null, cb) -> db */
static napi_value Open(napi_env env, napi_callback_info info) {
    ARGS(7);
    NSEngine* e = get_engine(env, argv[0]);
    if (!e) return throw_error(env, "invalid engine");
    char* path = get_utf8(env, argv[1], NULL);
    if (!path) return throw_error(env, "path must be a string");
    int32_t flags = 0, busy = 0;
    bool wal = false;
    napi_get_value_int32(env, argv[2], &flags);
    napi_get_value_int32(env, argv[3], &busy);
    napi_get_value_bool(env, argv[4], &wal);
    char* init = get_utf8(env, argv[5], NULL);
    NSOpenOptions o;
    memset(&o, 0, sizeof(o));
    o.flags = flags;
    o.busy_timeout_ms = busy;
    o.wal = wal ? 1 : 0;
    o.init_sql = init;
    Call* c = call_new(env, argv[6]);
    napi_value result = NULL;
    if (!c) {
        throw_error(env, "callback must be a function");
    } else {
        NSDb* db = nssqlite_open(e, path, &o, on_result, c);
        if (!db) {
            call_drop(env, c);
            throw_error(env, "nssqlite_open failed");
        } else if (napi_create_external(env, db, db_finalize, NULL, &result) != napi_ok) {
            nssqlite_db_release(db); /* the open request still runs and its callback fires */
            throw_error(env, "cannot create the database handle");
            result = NULL;
        }
    }
    free(path);
    free(init);
    return result;
}

/* exec(db, tx, sql, params | null, flags, chunkRows, cb) -> int */
static napi_value Exec(napi_env env, napi_callback_info info) {
    ARGS(7);
    NSDb* db = get_db(env, argv[0]);
    if (!db) return throw_error(env, "invalid database");
    int32_t tx = 0, flags = 0, chunk = 0;
    napi_get_value_int32(env, argv[1], &tx);
    napi_get_value_int32(env, argv[4], &flags);
    napi_get_value_int32(env, argv[5], &chunk);
    size_t sql_len = 0;
    char* sql = get_utf8(env, argv[2], &sql_len);
    if (!sql) return throw_error(env, "sql must be a string");
    const uint8_t* params;
    size_t params_len;
    napi_value result = NULL;
    if (get_bytes(env, argv[3], &params, &params_len)) {
        free(sql);
        return throw_error(env, "params must be an ArrayBuffer or a typed array");
    }
    Call* c = call_new(env, argv[6]);
    if (!c) {
        free(sql);
        return throw_error(env, "callback must be a function");
    }
    int rc = nssqlite_exec(db, (uint32_t)tx, sql, sql_len, params, params_len, (uint32_t)flags, (uint32_t)chunk, on_result, c);
    free(sql);
    if (rc) call_drop(env, c);
    result = int_result(env, rc);
    return result;
}

/* batch(db, tx, request, flags, cb) -> int */
static napi_value Batch(napi_env env, napi_callback_info info) {
    ARGS(5);
    NSDb* db = get_db(env, argv[0]);
    if (!db) return throw_error(env, "invalid database");
    int32_t tx = 0, flags = 0;
    napi_get_value_int32(env, argv[1], &tx);
    napi_get_value_int32(env, argv[3], &flags);
    const uint8_t* req;
    size_t req_len;
    if (get_bytes(env, argv[2], &req, &req_len) || !req) return throw_error(env, "request must be an ArrayBuffer or a typed array");
    Call* c = call_new(env, argv[4]);
    if (!c) return throw_error(env, "callback must be a function");
    int rc = nssqlite_batch(db, (uint32_t)tx, req, req_len, (uint32_t)flags, on_result, c);
    if (rc) call_drop(env, c);
    return int_result(env, rc);
}

/* txBegin(db, mode, cb) -> id (0 on error) */
static napi_value TxBegin(napi_env env, napi_callback_info info) {
    ARGS(3);
    NSDb* db = get_db(env, argv[0]);
    if (!db) return throw_error(env, "invalid database");
    int32_t mode = 0;
    napi_get_value_int32(env, argv[1], &mode);
    Call* c = call_new(env, argv[2]);
    if (!c) return throw_error(env, "callback must be a function");
    uint32_t id = nssqlite_tx_begin(db, mode, on_result, c);
    if (!id) call_drop(env, c);
    return int_result(env, (int)id);
}

/* txEnd(db, tx, commit, cb) -> int */
static napi_value TxEnd(napi_env env, napi_callback_info info) {
    ARGS(4);
    NSDb* db = get_db(env, argv[0]);
    if (!db) return throw_error(env, "invalid database");
    int32_t tx = 0;
    bool commit = false;
    napi_get_value_int32(env, argv[1], &tx);
    napi_get_value_bool(env, argv[2], &commit);
    Call* c = call_new(env, argv[3]);
    if (!c) return throw_error(env, "callback must be a function");
    int rc = nssqlite_tx_end(db, (uint32_t)tx, commit ? 1 : 0, on_result, c);
    if (rc) call_drop(env, c);
    return int_result(env, rc);
}

/* loadExtension(db, path, entry | null, cb) -> int */
static napi_value LoadExtension(napi_env env, napi_callback_info info) {
    ARGS(4);
    NSDb* db = get_db(env, argv[0]);
    if (!db) return throw_error(env, "invalid database");
    char* path = get_utf8(env, argv[1], NULL);
    char* entry = get_utf8(env, argv[2], NULL);
    Call* c = path ? call_new(env, argv[3]) : NULL;
    if (!c) {
        free(path);
        free(entry);
        return throw_error(env, "loadExtension(db, path, entry, callback)");
    }
    int rc = nssqlite_load_extension(db, path, entry, on_result, c);
    free(path);
    free(entry);
    if (rc) call_drop(env, c);
    return int_result(env, rc);
}

/* close(db, cb) -> int */
static napi_value Close(napi_env env, napi_callback_info info) {
    ARGS(2);
    NSDb* db = get_db(env, argv[0]);
    if (!db) return throw_error(env, "invalid database");
    Call* c = call_new(env, argv[1]);
    if (!c) return throw_error(env, "callback must be a function");
    int rc = nssqlite_close(db, on_result, c);
    if (rc) call_drop(env, c);
    return int_result(env, rc);
}

/* ---- native row decoding ---- */

#define DECODE_OBJECTS 1  /* rows as {column: value}, otherwise arrays */
#define DECODE_BIGINT 2   /* INT64 values as BigInt, otherwise numbers */

static int cell_to_js(napi_env env, const NSValue* v, uint32_t flags, napi_value* out) {
    switch (v->type) {
        case NS_T_NULL: return napi_get_null(env, out);
        case NS_T_INT32: return napi_create_int32(env, (int32_t)v->i, out);
        case NS_T_INT64: return (flags & DECODE_BIGINT) ? napi_create_bigint_int64(env, v->i, out) : napi_create_int64(env, v->i, out);
        case NS_T_DOUBLE: return napi_create_double(env, v->d, out);
        case NS_T_TEXT:
            return v->ascii ? napi_create_string_latin1(env, (const char*)v->ptr, v->len, out) : napi_create_string_utf8(env, (const char*)v->ptr, v->len, out);
        case NS_T_BLOB: {
            void* p;
            napi_value ab;
            if (napi_create_arraybuffer(env, v->len, &p, &ab) != napi_ok) return napi_generic_failure;
            if (v->len) memcpy(p, v->ptr, v->len);
            return napi_create_typedarray(env, napi_uint8_array, v->len, ab, 0, out);
        }
    }
    return napi_generic_failure;
}

/* decodeRows(buffer, byteOffset, byteLength, flags) -> { columns, rows, changes, lastInsertRowId } */
static napi_value DecodeRows(napi_env env, napi_callback_info info) {
    ARGS(4);
    const uint8_t* data;
    size_t len;
    if (get_bytes(env, argv[0], &data, &len) || !data) return throw_error(env, "buffer must be an ArrayBuffer or a typed array");
    uint32_t off = 0, n = 0, flags = 0;
    napi_get_value_uint32(env, argv[1], &off);
    napi_get_value_uint32(env, argv[2], &n);
    napi_get_value_uint32(env, argv[3], &flags);
    if (off > len || n > len - off) return throw_error(env, "range outside of the buffer");
    NSRows rows;
    if (nssqlite_rows_init(&rows, data + off, n)) return throw_error(env, "malformed rows block");

    napi_value columns, rowsArr, result;
    napi_create_array_with_length(env, rows.ncols, &columns);
    for (uint32_t c = 0; c < rows.ncols; c++) {
        const uint8_t* name;
        uint32_t nl;
        if (nssqlite_rows_name(&rows, c, &name, &nl)) return throw_error(env, "malformed rows block");
        napi_value s;
        napi_create_string_utf8(env, (const char*)name, nl, &s);
        napi_set_element(env, columns, c, s);
    }
    napi_create_array_with_length(env, rows.nrows, &rowsArr);
    NSValue* vals = (NSValue*)malloc(sizeof(NSValue) * (rows.ncols ? rows.ncols : 1));
    if (!vals) return throw_error(env, "out of memory");
    for (uint32_t r = 0; r < rows.nrows; r++) {
        int rc = nssqlite_rows_next(&rows, vals);
        if (rc <= 0) {
            free(vals);
            return throw_error(env, "malformed rows block");
        }
        napi_value row, cellv;
        if (flags & DECODE_OBJECTS) napi_create_object(env, &row); else napi_create_array_with_length(env, rows.ncols, &row);
        for (uint32_t c = 0; c < rows.ncols; c++) {
            if (cell_to_js(env, &vals[c], flags, &cellv) != napi_ok) {
                free(vals);
                return throw_error(env, "cannot decode a value");
            }
            if (flags & DECODE_OBJECTS) {
                napi_value key;
                napi_get_element(env, columns, c, &key);
                napi_set_property(env, row, key, cellv);
            } else {
                napi_set_element(env, row, c, cellv);
            }
        }
        napi_set_element(env, rowsArr, r, row);
    }
    free(vals);
    napi_create_object(env, &result);
    napi_value ch, id;
    napi_create_int64(env, rows.changes, &ch);
    napi_create_int64(env, rows.last_insert_rowid, &id);
    napi_set_named_property(env, result, "columns", columns);
    napi_set_named_property(env, result, "rows", rowsArr);
    napi_set_named_property(env, result, "changes", ch);
    napi_set_named_property(env, result, "lastInsertRowId", id);
    return result;
}

static napi_value Init(napi_env env, napi_value exports) {
    napi_property_descriptor props[] = {
        {"engine", NULL, Engine, NULL, NULL, NULL, napi_enumerable, NULL},
        {"engineVersion", NULL, EngineVersion, NULL, NULL, NULL, napi_enumerable, NULL},
        {"engineCanLoadExtensions", NULL, EngineCanLoadExtensions, NULL, NULL, NULL, napi_enumerable, NULL},
        {"open", NULL, Open, NULL, NULL, NULL, napi_enumerable, NULL},
        {"exec", NULL, Exec, NULL, NULL, NULL, napi_enumerable, NULL},
        {"batch", NULL, Batch, NULL, NULL, NULL, napi_enumerable, NULL},
        {"txBegin", NULL, TxBegin, NULL, NULL, NULL, napi_enumerable, NULL},
        {"txEnd", NULL, TxEnd, NULL, NULL, NULL, napi_enumerable, NULL},
        {"loadExtension", NULL, LoadExtension, NULL, NULL, NULL, napi_enumerable, NULL},
        {"close", NULL, Close, NULL, NULL, NULL, napi_enumerable, NULL},
        {"decodeRows", NULL, DecodeRows, NULL, NULL, NULL, napi_enumerable, NULL},
    };
    napi_define_properties(env, exports, sizeof(props) / sizeof(props[0]), props);
    napi_value v;
    napi_create_int32(env, NSSQLITE_API_VERSION, &v);
    napi_set_named_property(env, exports, "apiVersion", v);
    dispatcher_get(env);
    return exports;
}

static napi_module sModule = {
    NAPI_MODULE_VERSION, 0, __FILE__, Init, "nssqlite", NULL, {0},
};

/* Idempotent. Constructor for dlopen'ed libraries (Android), explicit call from +load on iOS where the
 * static library object would otherwise be dead-stripped. */
__attribute__((visibility("default"))) void nssqlite_napi_register(void) {
    static atomic_int done;
    if (atomic_exchange(&done, 1) != 0) return;
    /* Runtimes without Node-API (NativeScript <= 8): stay inactive, the bridge binding is used instead. */
    if (napi_dyn_load() != 0) return;
    napi_module_register(&sModule);
}

__attribute__((constructor)) static void nssqlite_napi_ctor(void) { nssqlite_napi_register(); }

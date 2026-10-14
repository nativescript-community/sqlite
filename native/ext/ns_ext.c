/* Sample SQLite extension used to test custom engines. Built three ways from this one file:
 *   - loadable (libns_ext.so / .dylib), entry point sqlite3_nsext_init: db.loadExtension('libns_ext.so')
 *   - compiled into a custom SQLite (-DSQLITE_CORE, registered through sqlite3_auto_extension / SQLITE_EXTRA_INIT)
 *   - registered by the host tests
 * Functions: ns_double(int), ns_hello(text), ns_ext_version(), aggregate ns_sumsq(int). */
#ifdef SQLITE_CORE
#include "sqlite3.h"
#else
#include "sqlite3ext.h"
SQLITE_EXTENSION_INIT1
#endif

#include <stdio.h>
#include <string.h>

static void ns_double(sqlite3_context* ctx, int argc, sqlite3_value** argv) {
    (void)argc;
    sqlite3_result_int64(ctx, sqlite3_value_int64(argv[0]) * 2);
}

static void ns_hello(sqlite3_context* ctx, int argc, sqlite3_value** argv) {
    (void)argc;
    const unsigned char* name = sqlite3_value_text(argv[0]);
    char buf[256];
    snprintf(buf, sizeof(buf), "hello %s", name ? (const char*)name : "?");
    sqlite3_result_text(ctx, buf, -1, SQLITE_TRANSIENT);
}

static void ns_ext_version(sqlite3_context* ctx, int argc, sqlite3_value** argv) {
    (void)argc;
    (void)argv;
    sqlite3_result_text(ctx, "ns_ext 1.0", -1, SQLITE_STATIC);
}

static void sumsq_step(sqlite3_context* ctx, int argc, sqlite3_value** argv) {
    (void)argc;
    sqlite3_int64* acc = (sqlite3_int64*)sqlite3_aggregate_context(ctx, sizeof(sqlite3_int64));
    if (acc) {
        sqlite3_int64 v = sqlite3_value_int64(argv[0]);
        *acc += v * v;
    }
}

static void sumsq_final(sqlite3_context* ctx) {
    sqlite3_int64* acc = (sqlite3_int64*)sqlite3_aggregate_context(ctx, 0);
    sqlite3_result_int64(ctx, acc ? *acc : 0);
}

#ifdef _WIN32
__declspec(dllexport)
#else
__attribute__((visibility("default")))
#endif
int sqlite3_nsext_init(sqlite3* db, char** err, const sqlite3_api_routines* api) {
    (void)err;
#ifndef SQLITE_CORE
    SQLITE_EXTENSION_INIT2(api);
#else
    (void)api;
#endif
    int rc = sqlite3_create_function(db, "ns_double", 1, SQLITE_UTF8 | SQLITE_DETERMINISTIC, NULL, ns_double, NULL, NULL);
    if (rc == SQLITE_OK) rc = sqlite3_create_function(db, "ns_hello", 1, SQLITE_UTF8 | SQLITE_DETERMINISTIC, NULL, ns_hello, NULL, NULL);
    if (rc == SQLITE_OK) rc = sqlite3_create_function(db, "ns_ext_version", 0, SQLITE_UTF8 | SQLITE_DETERMINISTIC, NULL, ns_ext_version, NULL, NULL);
    if (rc == SQLITE_OK) rc = sqlite3_create_function(db, "ns_sumsq", 1, SQLITE_UTF8, NULL, NULL, sumsq_step, sumsq_final);
    return rc;
}

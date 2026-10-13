/*
 * nssqlite core: threaded SQLite access with a compact binary wire format.
 *
 * - The core never links SQLite. It resolves sqlite3_* from a library the app picks (an "engine").
 * - Every database owns one worker thread and one connection. Requests are queued and executed in
 *   order, except that an open transaction pins the connection (see nssqlite_tx_begin).
 * - Requests and results are plain byte buffers (see nssqlite_wire.h) so a binding crosses the
 *   JS/native bridge once per call.
 * - Callbacks run on the database's worker thread. A binding must forward the result to its own JS
 *   thread, and take ownership of NSResult.data / NSResult.message (nssqlite_free).
 *
 * All functions are thread safe unless noted. All integers in buffers are little endian.
 */
#ifndef NSSQLITE_H
#define NSSQLITE_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define NSSQLITE_API_VERSION 1

#if defined(__GNUC__)
#define NSSQLITE_API __attribute__((visibility("default")))
#else
#define NSSQLITE_API
#endif

/* NSResult.status: 0 = ok, > 0 = SQLite (extended) result code, < 0 = core error. */
#define NS_ERR_CLOSED (-1)   /* database closed, closing or failed to open */
#define NS_ERR_INVALID (-2)  /* malformed request, bad parameters, wrong parameter count */
#define NS_ERR_NOMEM (-3)
#define NS_ERR_TX (-4)       /* transaction could not start; requests inside it are refused */
#define NS_ERR_UNSUPPORTED (-5)

typedef struct NSEngine NSEngine;
typedef struct NSDb NSDb;

/* ---- engines (the SQLite library) ---- */

/* library == NULL: use sqlite3_* symbols already present in the process.
 * Otherwise dlopen(library). Engines are cached by name and never unloaded.
 * Returns NULL and fills err (if given) on failure. */
NSSQLITE_API NSEngine* nssqlite_engine(const char* library, char* err, size_t errlen);
NSSQLITE_API const char* nssqlite_engine_version(const NSEngine* e);
NSSQLITE_API int nssqlite_engine_can_load_extensions(const NSEngine* e);
/* Register a statically linked extension init function (sqlite3_auto_extension) so it is applied to
 * every connection opened afterwards by any engine sharing this library. Returns 0 on success. */
NSSQLITE_API int nssqlite_engine_auto_extension(NSEngine* e, void (*init)(void));

/* ---- results ---- */

typedef struct NSResult {
    int status;
    int done;                   /* 1 on the final (or only) callback of a request */
    uint8_t* data;              /* rows block / batch block, see nssqlite_wire.h. Owned by callee. */
    size_t len;
    char* message;              /* UTF-8 error text or NULL. Owned by callee. */
    int64_t changes;            /* sqlite3_changes after the statement */
    int64_t last_insert_rowid;
} NSResult;

typedef void (*NSCallback)(void* user, NSResult result);

NSSQLITE_API void nssqlite_free(void* p);

/* ---- database ---- */

typedef struct NSOpenOptions {
    int flags;               /* sqlite3_open_v2 flags, 0 = READWRITE | CREATE */
    int busy_timeout_ms;     /* 0 = default (5000), < 0 = none */
    int wal;                 /* 1 = PRAGMA journal_mode=WAL after open (and after init_sql) */
    const char* init_sql;    /* executed right after open, before `wal`: PRAGMA key for SQLCipher. May be NULL. */
} NSOpenOptions;

/* Returns a handle immediately (reference count 1, owned by the caller) or NULL on allocation
 * failure. Opening happens on the worker thread; cb reports the open result (done = 1). Requests
 * queued before the open completes run after it, or fail with NS_ERR_CLOSED if it failed. */
NSSQLITE_API NSDb* nssqlite_open(NSEngine* e, const char* path, const NSOpenOptions* opts, NSCallback cb, void* user);
/* Drop the caller's reference. The handle stays valid for in-flight requests. Call after close. */
NSSQLITE_API void nssqlite_db_release(NSDb* db);

/* Submit functions return 0 when queued (the callback will be called) or a negative core error
 * (the callback will NOT be called). */

#define NS_EXEC_SCRIPT 1u /* sqlite3_exec: many statements, no parameters, no rows */


/* Run one statement. sql is UTF-8. params is a params block (nssqlite_wire.h) or NULL.
 * chunk_rows > 0 streams rows: the callback is called with done = 0 for every chunk of
 * chunk_rows rows and once more with done = 1 for the rest. tx = 0 for no transaction. */
NSSQLITE_API int nssqlite_exec(NSDb* db, uint32_t tx, const char* sql, size_t sql_len, const uint8_t* params, size_t params_len,
                               uint32_t flags, uint32_t chunk_rows, NSCallback cb, void* user);

#define NS_BATCH_ATOMIC 1u /* all statements or none (BEGIN IMMEDIATE, or a SAVEPOINT inside a transaction) */

/* req is a batch request block (nssqlite_wire.h). Stops at the first failing statement; the result
 * data then holds the blocks of the statements that completed. */
NSSQLITE_API int nssqlite_batch(NSDb* db, uint32_t tx, const uint8_t* req, size_t req_len, uint32_t flags, NSCallback cb, void* user);

/* Transactions pin the connection. tx_begin returns a non-zero id immediately (0 = error, no
 * callback). The BEGIN runs when the queue reaches it and no other transaction is active. Requests
 * with tx = id run inside it; requests with another tx or tx = 0 wait until nssqlite_tx_end. */
#define NS_TX_DEFERRED 0
#define NS_TX_IMMEDIATE 1
#define NS_TX_EXCLUSIVE 2
NSSQLITE_API uint32_t nssqlite_tx_begin(NSDb* db, int mode, NSCallback cb, void* user);
NSSQLITE_API int nssqlite_tx_end(NSDb* db, uint32_t tx, int commit, NSCallback cb, void* user);

NSSQLITE_API int nssqlite_load_extension(NSDb* db, const char* path, const char* entry, NSCallback cb, void* user);

/* Rolls back an open transaction, fails queued requests with NS_ERR_CLOSED, finalizes statements,
 * closes the connection and stops the worker thread. */
NSSQLITE_API int nssqlite_close(NSDb* db, NSCallback cb, void* user);

#ifdef __cplusplus
}
#endif
#endif

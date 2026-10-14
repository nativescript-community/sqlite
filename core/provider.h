#ifndef NSSQLITE_PROVIDER_H
#define NSSQLITE_PROVIDER_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/* Opaque SQLite types: the core never includes sqlite3.h. */
typedef struct sqlite3 sqlite3;
typedef struct sqlite3_stmt sqlite3_stmt;

/* Function table resolved at runtime from whatever SQLite the app chooses. */
typedef struct NSSqliteProvider {
    void* handle;
    const char* (*libversion)(void);
    int (*threadsafe)(void);
    int (*open_v2)(const char*, sqlite3**, int, const char*);
    int (*close_v2)(sqlite3*);
    int (*prepare_v3)(sqlite3*, const char*, int, unsigned int, sqlite3_stmt**, const char**);
    int (*step)(sqlite3_stmt*);
    int (*reset)(sqlite3_stmt*);
    int (*finalize)(sqlite3_stmt*);
    int (*clear_bindings)(sqlite3_stmt*);
    int (*bind_null)(sqlite3_stmt*, int);
    int (*bind_int64)(sqlite3_stmt*, int, int64_t);
    int (*bind_double)(sqlite3_stmt*, int, double);
    int (*bind_text)(sqlite3_stmt*, int, const char*, int, void (*)(void*));
    int (*bind_blob)(sqlite3_stmt*, int, const void*, int, void (*)(void*));
    int (*bind_parameter_count)(sqlite3_stmt*);
    int (*column_count)(sqlite3_stmt*);
    const char* (*column_name)(sqlite3_stmt*, int);
    int (*column_type)(sqlite3_stmt*, int);
    int64_t (*column_int64)(sqlite3_stmt*, int);
    double (*column_double)(sqlite3_stmt*, int);
    const unsigned char* (*column_text)(sqlite3_stmt*, int);
    const void* (*column_blob)(sqlite3_stmt*, int);
    int (*column_bytes)(sqlite3_stmt*, int);
    int (*changes)(sqlite3*);
    int64_t (*last_insert_rowid)(sqlite3*);
    int (*busy_timeout)(sqlite3*, int);
    int (*extended_errcode)(sqlite3*);
    const char* (*errmsg)(sqlite3*);
    int (*exec)(sqlite3*, const char*, void*, void*, char**);
    void (*free)(void*);
    /* optional: NULL when the provider was built without them */
    int (*auto_extension)(void (*)(void));
    int (*load_extension)(sqlite3*, const char*, const char*, char**);
    int (*enable_load_extension)(sqlite3*, int);
} NSSqliteProvider;

/* path == NULL: resolve from the symbols already in the process (RTLD_DEFAULT).
 * Returns 0 on success, otherwise fills err (NUL terminated, truncated) and returns non-zero. */
int nssqlite_provider_load(NSSqliteProvider* p, const char* path, char* err, size_t errlen);
void nssqlite_provider_unload(NSSqliteProvider* p);

#ifdef __cplusplus
}
#endif
#endif

/* SQLITE_EXTRA_INIT hook of the custom SQLite build: registers the sample extension (compiled in with
 * -DSQLITE_CORE) so every connection has it, without any loadExtension call. */
#include "sqlite3.h"

int sqlite3_nsext_init(sqlite3*, char**, const sqlite3_api_routines*);

int ns_ext_register(const char* unused) {
    (void)unused;
    return sqlite3_auto_extension((void (*)(void))sqlite3_nsext_init);
}

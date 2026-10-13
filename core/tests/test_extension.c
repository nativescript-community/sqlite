/* Static extension registration through the engine (sqlite3_auto_extension).
 * The sample extension is written against sqlite3ext.h, so its sqlite3_* calls go through the
 * api table the engine passes in: nothing here links SQLite, only its headers are used.
 * Apple's system SQLite refuses sqlite3_auto_extension (SQLITE_MISUSE), so on macOS this test
 * needs a Homebrew SQLite (CMake picks it up when present); otherwise it is skipped. */
#include <sqlite3ext.h>

SQLITE_EXTENSION_INIT1

#include "harness.h"

static void ns_double(sqlite3_context* ctx, int argc, sqlite3_value** argv) {
    sqlite3_result_int64(ctx, sqlite3_value_int64(argv[0]) * 2);
}

static int ext_init(sqlite3* db, char** err, const sqlite3_api_routines* api) {
    (void)err;
    SQLITE_EXTENSION_INIT2(api);
    return sqlite3_create_function(db, "ns_double", 1, SQLITE_UTF8 | SQLITE_DETERMINISTIC, NULL, ns_double, NULL, NULL);
}

int main(void) {
#ifndef NSSQLITE_EXT_ENGINE
    printf("extension: SKIPPED (no engine that supports sqlite3_auto_extension found)\n");
    return 0;
#else
    char err[256];
    NSEngine* e = nssqlite_engine(NSSQLITE_EXT_ENGINE, err, sizeof(err));
    if (!e) {
        fprintf(stderr, "cannot load %s: %s\n", NSSQLITE_EXT_ENGINE, err);
        return 2;
    }
    CHECK_EQ(nssqlite_engine_auto_extension(e, (void (*)(void))ext_init), 0);
    NSDb* db = open_db(e, ":memory:", NULL);
    CHECK_EQ(scalar_int(db, 0, "SELECT ns_double(21)"), 42);
    close_db(db);
    return finish("extension");
#endif
}

#include "../provider.h"

#include <stdio.h>
#include <stdlib.h>

#define CHECK(c) do { if (!(c)) { fprintf(stderr, "FAIL %s:%d %s\n", __FILE__, __LINE__, #c); exit(1);} } while (0)

int main(int argc, char** argv) {
    const char* path = argc > 1 ? argv[1] : NULL;
    NSSqliteProvider p;
    char err[256];
    int rc = nssqlite_provider_load(&p, path, err, sizeof(err));
    if (rc) { fprintf(stderr, "load rc=%d: %s\n", rc, err); return 1; }
    printf("sqlite %s threadsafe=%d auto_ext=%d load_ext=%d\n", p.libversion(), p.threadsafe(),
           p.auto_extension != NULL, p.enable_load_extension != NULL);

    sqlite3* db = NULL;
    CHECK(p.open_v2(":memory:", &db, 0x2 | 0x4 /* READWRITE|CREATE */, NULL) == 0);
    CHECK(p.exec(db, "CREATE TABLE t(a INTEGER, b TEXT, c BLOB, d REAL)", NULL, NULL, NULL) == 0);

    sqlite3_stmt* ins = NULL;
    CHECK(p.prepare_v3(db, "INSERT INTO t VALUES (?,?,?,?)", -1, 0, &ins, NULL) == 0);
    const unsigned char blob[3] = {1, 2, 3};
    CHECK(p.bind_int64(ins, 1, 9007199254740993LL) == 0); /* > 2^53 */
    CHECK(p.bind_text(ins, 2, "héllo", -1, (void (*)(void*))-1 /* SQLITE_TRANSIENT */) == 0);
    CHECK(p.bind_blob(ins, 3, blob, 3, (void (*)(void*))-1) == 0);
    CHECK(p.bind_double(ins, 4, 1.5) == 0);
    CHECK(p.step(ins) == 101);
    p.finalize(ins);

    sqlite3_stmt* sel = NULL;
    CHECK(p.prepare_v3(db, "SELECT * FROM t", -1, 0, &sel, NULL) == 0);
    CHECK(p.step(sel) == 100);
    CHECK(p.column_count(sel) == 4);
    CHECK(p.column_type(sel, 0) == 1);
    CHECK(p.column_int64(sel, 0) == 9007199254740993LL);
    CHECK(p.column_bytes(sel, 2) == 3);
    CHECK(p.column_double(sel, 3) == 1.5);
    printf("col1=%s\n", p.column_text(sel, 1));
    p.finalize(sel);
    CHECK(p.close_v2(db) == 0);
    nssqlite_provider_unload(&p);
    printf("OK\n");
    return 0;
}

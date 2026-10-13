#include <stdatomic.h>
#include <unistd.h>

#include "harness.h"

static NSEngine* E;

static void tmp_path(char* out, size_t n, const char* tag) {
    static atomic_int counter;
    snprintf(out, n, "/tmp/nssqlite_test_%d_%s_%d.db", (int)getpid(), tag, atomic_fetch_add(&counter, 1));
}

static void rm_db(const char* path) {
    char buf[512];
    unlink(path);
    snprintf(buf, sizeof(buf), "%s-wal", path); unlink(buf);
    snprintf(buf, sizeof(buf), "%s-shm", path); unlink(buf);
    snprintf(buf, sizeof(buf), "%s-journal", path); unlink(buf);
}

/* ---- engine ---- */

static void test_engine_cache(void) {
    char err[256] = "";
    CHECK(E != NULL);
    CHECK(nssqlite_engine_version(E) != NULL);
    CHECK(nssqlite_engine("/definitely/not/here.so", err, sizeof(err)) == NULL);
    CHECK(strlen(err) > 0);
    CHECK(nssqlite_engine(NSSQLITE_TEST_ENGINE, NULL, 0) == E); /* cached */
}

/* ---- basic statements and types ---- */

static void test_types(void) {
    NSDb* db = open_db(E, ":memory:", NULL);
    CHECK_EQ(run_ok(db, "CREATE TABLE t(i INTEGER, r REAL, s TEXT, b BLOB, n)"), 0);

    Params p;
    Waiter w;
    const uint8_t blob[3] = {0, 7, 255};
    params_init(&p);
    params_int(&p, 9007199254740993LL);
    params_double(&p, 2.5);
    params_text(&p, "h\xc3\xa9llo \xe2\x82\xac");
    params_blob(&p, blob, 3);
    params_null(&p);
    CHECK_EQ(run(db, 0, "INSERT INTO t VALUES (?,?,?,?,?)", &p, &w), 0);
    CHECK_EQ(waiter_last(&w)->changes, 1);
    CHECK_EQ(waiter_last(&w)->last_insert_rowid, 1);
    nssqlite_buf_free(&p.b);
    waiter_clear(&w);

    CHECK_EQ(run(db, 0, "SELECT i, r, s, b, n, 1 AS one FROM t", NULL, &w), 0);
    NSRows rows;
    CHECK(nssqlite_rows_init(&rows, waiter_last(&w)->data, waiter_last(&w)->len) == 0);
    CHECK_EQ(rows.ncols, 6);
    CHECK_EQ(rows.nrows, 1);
    const uint8_t* name; uint32_t nl;
    CHECK(nssqlite_rows_name(&rows, 5, &name, &nl) == 0 && nl == 3 && memcmp(name, "one", 3) == 0);
    NSValue v[6];
    CHECK_EQ(nssqlite_rows_next(&rows, v), 1);
    CHECK_EQ(v[0].type, NS_T_INT64); CHECK(v[0].i == 9007199254740993LL);
    CHECK_EQ(v[1].type, NS_T_DOUBLE); CHECK(v[1].d == 2.5);
    CHECK_EQ(v[2].type, NS_T_TEXT); CHECK(v[2].len == 10 && memcmp(v[2].ptr, "h\xc3\xa9llo \xe2\x82\xac", 10) == 0);
    CHECK_EQ(v[3].type, NS_T_BLOB); CHECK(v[3].len == 3 && memcmp(v[3].ptr, blob, 3) == 0);
    CHECK_EQ(v[4].type, NS_T_NULL);
    CHECK_EQ(v[5].type, NS_T_INT32); CHECK_EQ(v[5].i, 1);
    waiter_clear(&w);

    /* a statement without rows still produces a valid empty block */
    CHECK_EQ(run(db, 0, "DELETE FROM t", NULL, &w), 0);
    CHECK_EQ(nrows(&w), 0);
    CHECK_EQ(waiter_last(&w)->changes, 1);
    waiter_clear(&w);
    close_db(db);
}

static void test_errors(void) {
    NSDb* db = open_db(E, ":memory:", NULL);
    Waiter w;
    CHECK_EQ(run_ok(db, "CREATE TABLE t(a INTEGER PRIMARY KEY, b TEXT NOT NULL)"), 0);

    int rc = run(db, 0, "SELEKT 1", NULL, &w);
    CHECK(rc > 0);
    CHECK(waiter_last(&w)->message && strstr(waiter_last(&w)->message, "syntax error"));
    waiter_clear(&w);

    Params p;
    params_init(&p); params_int(&p, 1); params_null(&p);
    rc = run(db, 0, "INSERT INTO t VALUES (?,?)", &p, &w);
    CHECK_EQ(rc & 0xff, 19); /* SQLITE_CONSTRAINT, extended code kept in the upper bits */
    CHECK(rc > 255);
    nssqlite_buf_free(&p.b);
    waiter_clear(&w);

    params_init(&p); params_int(&p, 1);
    CHECK_EQ(run(db, 0, "INSERT INTO t VALUES (?,?)", &p, &w), NS_ERR_INVALID); /* 1 given, 2 expected */
    CHECK(strstr(waiter_last(&w)->message, "expected 2"));
    nssqlite_buf_free(&p.b);
    waiter_clear(&w);

    CHECK_EQ(run(db, 0, "SELECT 1; SELECT 2", NULL, &w), NS_ERR_INVALID);
    waiter_clear(&w);
    CHECK_EQ(run(db, 0, "  ", NULL, &w), NS_ERR_INVALID);
    waiter_clear(&w);
    CHECK_EQ(run(db, 0, "SELECT 1;  ", NULL, &w), 0); /* trailing ; is fine */
    waiter_clear(&w);

    /* hand-made malformed params */
    waiter_init(&w);
    const uint8_t bad[] = {1, 0, 0, 0, 9};
    CHECK_EQ(nssqlite_exec(db, 0, "SELECT ?", 8, bad, sizeof(bad), 0, 0, on_result, &w), 0);
    CHECK(waiter_wait(&w));
    CHECK_EQ(waiter_last(&w)->status, NS_ERR_INVALID);
    waiter_clear(&w);

    /* the connection is still usable after errors */
    CHECK_EQ(scalar_int(db, 0, "SELECT 41 + 1"), 42);
    close_db(db);
}

static void test_script(void) {
    NSDb* db = open_db(E, ":memory:", NULL);
    Waiter w;
    waiter_init(&w);
    const char* sql = "CREATE TABLE a(x); INSERT INTO a VALUES (1); INSERT INTO a VALUES (2);";
    CHECK_EQ(nssqlite_exec(db, 0, sql, strlen(sql), NULL, 0, NS_EXEC_SCRIPT, 0, on_result, &w), 0);
    CHECK(waiter_wait(&w));
    CHECK_EQ(waiter_last(&w)->status, 0);
    waiter_clear(&w);
    CHECK_EQ(scalar_int(db, 0, "SELECT COUNT(*) FROM a"), 2);
    close_db(db);
}

/* cached statements must survive schema changes and repeated use */
static void test_statement_cache(void) {
    NSDb* db = open_db(E, ":memory:", NULL);
    CHECK_EQ(run_ok(db, "CREATE TABLE t(a)"), 0);
    for (int i = 0; i < 300; i++) {
        Params p; Waiter w;
        params_init(&p); params_int(&p, i);
        CHECK_EQ(run(db, 0, "INSERT INTO t VALUES (?)", &p, &w), 0);
        nssqlite_buf_free(&p.b);
        waiter_clear(&w);
    }
    CHECK_EQ(scalar_int(db, 0, "SELECT SUM(a) FROM t"), 299 * 300 / 2);
    CHECK_EQ(run_ok(db, "ALTER TABLE t ADD COLUMN b DEFAULT 5"), 0);
    CHECK_EQ(scalar_int(db, 0, "SELECT SUM(b) FROM t"), 1500); /* re-prepare after schema change */
    /* more distinct statements than cache slots */
    for (int i = 0; i < 100; i++) {
        char sql[64];
        snprintf(sql, sizeof(sql), "SELECT %d + a FROM t LIMIT 1", i);
        CHECK_EQ(scalar_int(db, 0, sql), i);
    }
    close_db(db);
}

/* ---- streaming ---- */

static void test_chunks(void) {
    NSDb* db = open_db(E, ":memory:", NULL);
    CHECK_EQ(run_ok(db, "CREATE TABLE t(a)"), 0);
    for (int i = 0; i < 25; i++) {
        Params p; Waiter w;
        params_init(&p); params_int(&p, i);
        CHECK_EQ(run(db, 0, "INSERT INTO t VALUES (?)", &p, &w), 0);
        nssqlite_buf_free(&p.b);
        waiter_clear(&w);
    }
    Waiter w;
    waiter_init(&w);
    const char* sql = "SELECT a FROM t ORDER BY a";
    CHECK_EQ(nssqlite_exec(db, 0, sql, strlen(sql), NULL, 0, 0, 10, on_result, &w), 0);
    CHECK(waiter_wait(&w));
    CHECK_EQ(w.n, 3);
    int expect_next = 0;
    for (int c = 0; c < w.n; c++) {
        CHECK_EQ(w.res[c].done, c == 2);
        NSRows rows;
        CHECK(nssqlite_rows_init(&rows, w.res[c].data, w.res[c].len) == 0);
        CHECK_EQ(rows.nrows, c == 2 ? 5 : 10);
        NSValue v;
        while (nssqlite_rows_next(&rows, &v) > 0) CHECK_EQ(v.i, expect_next++);
    }
    CHECK_EQ(expect_next, 25);
    waiter_clear(&w);

    /* exact multiple of the chunk size: last callback is an empty done block */
    waiter_init(&w);
    CHECK_EQ(nssqlite_exec(db, 0, sql, strlen(sql), NULL, 0, 0, 5, on_result, &w), 0);
    CHECK(waiter_wait(&w));
    CHECK_EQ(w.n, 6);
    CHECK_EQ(nrows(&w), 0);
    waiter_clear(&w);
    close_db(db);
}

/* ---- batch ---- */

static void batch_add(NSBuf* b, const char* sql, Params* p) {
    nssqlite_buf_u32(b, (uint32_t)strlen(sql));
    nssqlite_buf_bytes(b, sql, strlen(sql));
    if (p) {
        params_done(p);
        nssqlite_buf_u32(b, (uint32_t)p->b.len);
        nssqlite_buf_bytes(b, p->b.data, p->b.len);
        nssqlite_buf_free(&p->b);
    } else {
        nssqlite_buf_u32(b, 0);
    }
}

static int run_batch(NSDb* db, uint32_t tx, NSBuf* b, uint32_t n, uint32_t flags, Waiter* w) {
    /* b was built without the leading count: prepend it */
    NSBuf full;
    nssqlite_buf_init(&full);
    nssqlite_buf_u32(&full, n);
    nssqlite_buf_bytes(&full, b->data, b->len);
    waiter_init(w);
    int rc = nssqlite_batch(db, tx, full.data, full.len, flags, on_result, w);
    nssqlite_buf_free(&full);
    nssqlite_buf_free(b);
    if (rc) return rc;
    if (!waiter_wait(w)) return -999;
    return waiter_last(w)->status;
}

static void test_batch(void) {
    NSDb* db = open_db(E, ":memory:", NULL);
    CHECK_EQ(run_ok(db, "CREATE TABLE t(a INTEGER PRIMARY KEY, b TEXT NOT NULL)"), 0);
    Waiter w;
    Params p;
    NSBuf b;

    /* ok batch, atomic */
    nssqlite_buf_init(&b);
    params_init(&p); params_int(&p, 1); params_text(&p, "one");
    batch_add(&b, "INSERT INTO t VALUES (?,?)", &p);
    params_init(&p); params_int(&p, 2); params_text(&p, "two");
    batch_add(&b, "INSERT INTO t VALUES (?,?)", &p);
    batch_add(&b, "SELECT COUNT(*) FROM t", NULL);
    CHECK_EQ(run_batch(db, 0, &b, 3, NS_BATCH_ATOMIC, &w), 0);
    NSReader r;
    nssqlite_reader_init(&r, waiter_last(&w)->data, waiter_last(&w)->len);
    uint32_t n, bl;
    CHECK(nssqlite_reader_u32(&r, &n) == 0);
    CHECK_EQ(n, 3);
    for (uint32_t i = 0; i < 3; i++) {
        const uint8_t* blk = NULL;
        CHECK(nssqlite_reader_u32(&r, &bl) == 0 && nssqlite_reader_bytes(&r, bl, &blk) == 0);
        NSRows rows;
        CHECK(nssqlite_rows_init(&rows, blk, bl) == 0);
        if (i == 2) {
            NSValue v;
            CHECK_EQ(nssqlite_rows_next(&rows, &v), 1);
            CHECK_EQ(v.i, 2);
        } else {
            CHECK_EQ(rows.changes, 1);
        }
    }
    waiter_clear(&w);

    /* atomic batch with a failing last statement: nothing persists */
    nssqlite_buf_init(&b);
    params_init(&p); params_int(&p, 3); params_text(&p, "three");
    batch_add(&b, "INSERT INTO t VALUES (?,?)", &p);
    params_init(&p); params_int(&p, 4); params_null(&p);
    batch_add(&b, "INSERT INTO t VALUES (?,?)", &p);
    CHECK(run_batch(db, 0, &b, 2, NS_BATCH_ATOMIC, &w) > 0);
    waiter_clear(&w);
    CHECK_EQ(scalar_int(db, 0, "SELECT COUNT(*) FROM t"), 2);
    CHECK_EQ(scalar_int(db, 0, "PRAGMA foreign_keys"), 0); /* connection is not left inside a transaction */
    CHECK_EQ(run_ok(db, "BEGIN"), 0);                      /* would fail if a transaction were still open */
    CHECK_EQ(run_ok(db, "ROLLBACK"), 0);

    /* non atomic: the statements before the failure persist, result holds them */
    nssqlite_buf_init(&b);
    params_init(&p); params_int(&p, 3); params_text(&p, "three");
    batch_add(&b, "INSERT INTO t VALUES (?,?)", &p);
    params_init(&p); params_int(&p, 4); params_null(&p);
    batch_add(&b, "INSERT INTO t VALUES (?,?)", &p);
    CHECK(run_batch(db, 0, &b, 2, 0, &w) > 0);
    nssqlite_reader_init(&r, waiter_last(&w)->data, waiter_last(&w)->len);
    CHECK(nssqlite_reader_u32(&r, &n) == 0);
    CHECK_EQ(n, 1);
    waiter_clear(&w);
    CHECK_EQ(scalar_int(db, 0, "SELECT COUNT(*) FROM t"), 3);

    /* truncated batch request */
    waiter_init(&w);
    const uint8_t trunc[] = {2, 0, 0, 0, 5, 0, 0, 0, 'S'};
    CHECK_EQ(nssqlite_batch(db, 0, trunc, sizeof(trunc), 0, on_result, &w), 0);
    CHECK(waiter_wait(&w));
    CHECK_EQ(waiter_last(&w)->status, NS_ERR_INVALID);
    waiter_clear(&w);
    close_db(db);
}

/* ---- transactions ---- */

static atomic_int g_seq;
typedef struct Ordered {
    Waiter w;
    int seq;
} Ordered;
static void on_ordered(void* user, NSResult r) {
    Ordered* o = (Ordered*)user;
    o->seq = atomic_fetch_add(&g_seq, 1);
    on_result(&o->w, r);
}

static void test_transactions(void) {
    char path[256];
    tmp_path(path, sizeof(path), "tx");
    NSDb* db = open_db(E, path, NULL);
    CHECK_EQ(run_ok(db, "CREATE TABLE t(a)"), 0);

    /* rollback; a request without tx submitted while the transaction is open waits for its end */
    Waiter wb, wi, we;
    Ordered sel, tx2;
    atomic_store(&g_seq, 0);
    waiter_init(&wb);
    uint32_t tx = nssqlite_tx_begin(db, NS_TX_IMMEDIATE, on_result, &wb);
    CHECK(tx != 0);
    CHECK_EQ(run(db, tx, "INSERT INTO t VALUES (1)", NULL, &wi), 0);
    waiter_clear(&wi);
    CHECK_EQ(scalar_int(db, tx, "SELECT COUNT(*) FROM t"), 1); /* sees its own write */

    waiter_init(&sel.w);
    const char* q = "SELECT COUNT(*) FROM t";
    CHECK_EQ(nssqlite_exec(db, 0, q, strlen(q), NULL, 0, 0, 0, on_ordered, &sel), 0);        /* waits */
    waiter_init(&tx2.w);
    uint32_t t2 = nssqlite_tx_begin(db, NS_TX_DEFERRED, on_ordered, &tx2);                    /* waits */
    CHECK(t2 != 0 && t2 != tx);
    usleep(100 * 1000);
    CHECK(!sel.w.done); /* still pinned */
    CHECK(!tx2.w.done);

    waiter_init(&we);
    CHECK_EQ(nssqlite_tx_end(db, tx, 0, on_result, &we), 0);
    CHECK(waiter_wait(&we));
    CHECK_EQ(waiter_last(&we)->status, 0);
    CHECK(waiter_wait(&sel.w));
    CHECK(waiter_wait(&tx2.w));
    CHECK_EQ(waiter_last(&sel.w)->status, 0);
    NSValue v;
    CHECK(cell(&sel.w, 0, 0, &v) == 0);
    CHECK_EQ(v.i, 0); /* rolled back */
    CHECK(sel.seq < tx2.seq); /* FIFO among the waiters */

    /* commit through the second transaction */
    CHECK_EQ(run(db, t2, "INSERT INTO t VALUES (2)", NULL, &wi), 0);
    waiter_clear(&wi);
    waiter_clear(&we);
    waiter_init(&we);
    CHECK_EQ(nssqlite_tx_end(db, t2, 1, on_result, &we), 0);
    CHECK(waiter_wait(&we));
    CHECK_EQ(waiter_last(&we)->status, 0);
    CHECK_EQ(scalar_int(db, 0, "SELECT COUNT(*) FROM t"), 1);

    /* a request for a transaction id that is not active never runs by itself; ending twice fails */
    waiter_clear(&sel.w); waiter_clear(&tx2.w); waiter_clear(&wb); waiter_clear(&we);
    close_db(db);
    rm_db(path);
}

static void test_failed_transaction(void) {
    NSDb* db = open_db(E, ":memory:", NULL);
    CHECK_EQ(run_ok(db, "BEGIN"), 0); /* raw transaction: nssqlite BEGIN will fail inside it */
    Waiter wb, w;
    waiter_init(&wb);
    uint32_t tx = nssqlite_tx_begin(db, NS_TX_DEFERRED, on_result, &wb);
    CHECK(tx != 0);
    CHECK(waiter_wait(&wb));
    CHECK(waiter_last(&wb)->status > 0);
    CHECK_EQ(run(db, tx, "SELECT 1", NULL, &w), NS_ERR_TX); /* refused inside the broken transaction */
    waiter_clear(&w);
    waiter_init(&w);
    CHECK_EQ(nssqlite_tx_end(db, tx, 1, on_result, &w), 0);
    CHECK(waiter_wait(&w));
    CHECK_EQ(waiter_last(&w)->status, NS_ERR_TX);
    waiter_clear(&w);
    CHECK_EQ(scalar_int(db, 0, "SELECT 5"), 5); /* the pin is released */
    CHECK_EQ(run_ok(db, "ROLLBACK"), 0);
    waiter_clear(&wb);
    close_db(db);
}

/* ---- close / open failure ---- */

static void test_close_semantics(void) {
    char path[256];
    tmp_path(path, sizeof(path), "close");
    NSDb* db = open_db(E, path, NULL);
    CHECK_EQ(run_ok(db, "CREATE TABLE t(a)"), 0);

    /* an open transaction with queued work behind it, then close */
    Waiter wb, wi;
    waiter_init(&wb);
    uint32_t tx = nssqlite_tx_begin(db, NS_TX_IMMEDIATE, on_result, &wb);
    CHECK(tx != 0);
    CHECK_EQ(run(db, tx, "INSERT INTO t VALUES (1)", NULL, &wi), 0);
    waiter_clear(&wi);
    Waiter waiting;
    waiter_init(&waiting);
    const char* q = "SELECT 1";
    CHECK_EQ(nssqlite_exec(db, 0, q, strlen(q), NULL, 0, 0, 0, on_result, &waiting), 0);
    Waiter wc;
    waiter_init(&wc);
    CHECK_EQ(nssqlite_close(db, on_result, &wc), 0);
    CHECK(waiter_wait(&wc));
    CHECK_EQ(waiter_last(&wc)->status, 0);
    CHECK(waiter_wait(&waiting));
    CHECK_EQ(waiter_last(&waiting)->status, NS_ERR_CLOSED);
    /* handle stays safe to use after close */
    CHECK_EQ(nssqlite_exec(db, 0, q, strlen(q), NULL, 0, 0, 0, on_result, &waiting), NS_ERR_CLOSED);
    CHECK_EQ(nssqlite_close(db, on_result, &wc), NS_ERR_CLOSED);
    waiter_clear(&wb); waiter_clear(&waiting); waiter_clear(&wc);
    nssqlite_db_release(db);

    /* the uncommitted transaction was rolled back */
    db = open_db(E, path, NULL);
    CHECK_EQ(scalar_int(db, 0, "SELECT COUNT(*) FROM t"), 0);
    close_db(db);
    rm_db(path);
}

static void test_open_failure(void) {
    Waiter wo, wq, wc;
    waiter_init(&wo);
    NSDb* db = nssqlite_open(E, "/nonexistent-dir/x/y.db", NULL, on_result, &wo);
    CHECK(db != NULL);
    waiter_init(&wq);
    const char* q = "SELECT 1";
    CHECK_EQ(nssqlite_exec(db, 0, q, strlen(q), NULL, 0, 0, 0, on_result, &wq), 0); /* queued before the open result */
    CHECK(waiter_wait(&wo));
    CHECK(waiter_last(&wo)->status > 0);
    CHECK(waiter_last(&wo)->message != NULL);
    CHECK(waiter_wait(&wq));
    CHECK_EQ(waiter_last(&wq)->status, NS_ERR_CLOSED);
    waiter_init(&wc);
    CHECK_EQ(nssqlite_close(db, on_result, &wc), 0);
    CHECK(waiter_wait(&wc));
    CHECK_EQ(waiter_last(&wc)->status, 0);
    waiter_clear(&wo); waiter_clear(&wq); waiter_clear(&wc);
    nssqlite_db_release(db);
}

static void test_open_options(void) {
    char path[256];
    tmp_path(path, sizeof(path), "opts");
    NSOpenOptions o;
    memset(&o, 0, sizeof(o));
    o.wal = 1;
    o.init_sql = "PRAGMA user_version = 7; PRAGMA foreign_keys = ON";
    NSDb* db = open_db(E, path, &o);
    Waiter w;
    CHECK_EQ(run(db, 0, "PRAGMA journal_mode", NULL, &w), 0);
    NSValue v;
    CHECK(cell(&w, 0, 0, &v) == 0 && v.type == NS_T_TEXT && v.len == 3 && memcmp(v.ptr, "wal", 3) == 0);
    waiter_clear(&w);
    CHECK_EQ(scalar_int(db, 0, "PRAGMA user_version"), 7);
    close_db(db);

    /* read only: writes fail */
    memset(&o, 0, sizeof(o));
    o.flags = 0x1; /* SQLITE_OPEN_READONLY */
    db = open_db(E, path, &o);
    CHECK_EQ(scalar_int(db, 0, "PRAGMA user_version"), 7);
    CHECK(run_ok(db, "CREATE TABLE nope(a)") != 0);
    close_db(db);
    rm_db(path);

    /* init_sql failure fails the open */
    memset(&o, 0, sizeof(o));
    o.init_sql = "THIS IS NOT SQL";
    Waiter wo;
    waiter_init(&wo);
    db = nssqlite_open(E, ":memory:", &o, on_result, &wo);
    CHECK(db && waiter_wait(&wo) && waiter_last(&wo)->status > 0);
    waiter_clear(&wo);
    Waiter wc;
    waiter_init(&wc);
    CHECK_EQ(nssqlite_close(db, on_result, &wc), 0);
    CHECK(waiter_wait(&wc));
    waiter_clear(&wc);
    nssqlite_db_release(db);
}

static void test_extensions_unsupported(void) {
    NSDb* db = open_db(E, ":memory:", NULL);
    if (!nssqlite_engine_can_load_extensions(E)) {
        Waiter w;
        waiter_init(&w);
        CHECK_EQ(nssqlite_load_extension(db, "/nope.so", NULL, on_result, &w), 0);
        CHECK(waiter_wait(&w));
        CHECK_EQ(waiter_last(&w)->status, NS_ERR_UNSUPPORTED);
        waiter_clear(&w);
    }
    close_db(db);
}

/* ---- concurrency ---- */

typedef struct Hammer {
    NSDb* db;
    int id;
    int count;
    atomic_int* completed;
} Hammer;

static void on_count(void* user, NSResult r) {
    Hammer* h = (Hammer*)user;
    if (r.status != 0) {
        fprintf(stderr, "hammer error %d %s\n", r.status, r.message ? r.message : "");
        g_failures++;
    }
    free(r.data);
    free(r.message);
    atomic_fetch_add(h->completed, 1);
}

static void* hammer_thread(void* arg) {
    Hammer* h = (Hammer*)arg;
    for (int i = 0; i < h->count; i++) {
        Params p;
        params_init(&p);
        params_int(&p, h->id);
        params_int(&p, i);
        params_done(&p);
        if (nssqlite_exec(h->db, 0, "INSERT INTO t VALUES (?,?)", 26, p.b.data, p.b.len, 0, 0, on_count, h)) g_failures++;
        nssqlite_buf_free(&p.b);
    }
    return NULL;
}

static void test_many_submitters(void) {
    char path[256];
    tmp_path(path, sizeof(path), "many");
    NSDb* db = open_db(E, path, NULL);
    CHECK_EQ(run_ok(db, "CREATE TABLE t(thread INTEGER, seq INTEGER)"), 0);
    enum { THREADS = 8, PER = 200 };
    pthread_t th[THREADS];
    Hammer h[THREADS];
    atomic_int completed;
    atomic_init(&completed, 0);
    for (int i = 0; i < THREADS; i++) {
        h[i] = (Hammer){db, i, PER, &completed};
        pthread_create(&th[i], NULL, hammer_thread, &h[i]);
    }
    for (int i = 0; i < THREADS; i++) pthread_join(th[i], NULL);
    for (int spin = 0; spin < 2000 && atomic_load(&completed) < THREADS * PER; spin++) usleep(10 * 1000);
    CHECK_EQ(atomic_load(&completed), THREADS * PER);
    CHECK_EQ(scalar_int(db, 0, "SELECT COUNT(*) FROM t"), THREADS * PER);
    /* per submitter order is preserved */
    CHECK_EQ(scalar_int(db, 0, "SELECT COUNT(*) FROM t a JOIN t b ON a.thread = b.thread AND b.seq = a.seq + 1 WHERE b.rowid < a.rowid"), 0);
    close_db(db);
    rm_db(path);
}

static void* db_thread(void* arg) {
    char path[256];
    tmp_path(path, sizeof(path), "par");
    NSDb* db = open_db(E, path, NULL);
    if (run_ok(db, "CREATE TABLE t(a)") != 0) g_failures++;
    for (int i = 0; i < 300; i++) {
        Params p; Waiter w;
        params_init(&p); params_int(&p, i);
        if (run(db, 0, "INSERT INTO t VALUES (?)", &p, &w) != 0) g_failures++;
        nssqlite_buf_free(&p.b);
        waiter_clear(&w);
    }
    if (scalar_int(db, 0, "SELECT COUNT(*) FROM t") != 300) g_failures++;
    close_db(db);
    rm_db(path);
    (void)arg;
    return NULL;
}

static void test_parallel_databases(void) {
    pthread_t th[4];
    for (int i = 0; i < 4; i++) pthread_create(&th[i], NULL, db_thread, NULL);
    for (int i = 0; i < 4; i++) pthread_join(th[i], NULL);
}

/* a big result must not break the encoder growth path */
static void test_large_result(void) {
    NSDb* db = open_db(E, ":memory:", NULL);
    Waiter w;
    CHECK_EQ(run(db, 0,
                 "WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c WHERE x < 50000) "
                 "SELECT x, printf('%.100d', x) AS pad, zeroblob(32) AS z FROM c",
                 NULL, &w),
             0);
    CHECK_EQ(nrows(&w), 50000);
    CHECK(waiter_last(&w)->len > 50000 * 130);
    NSValue v;
    CHECK(cell(&w, 49999, 0, &v) == 0 && v.i == 50000);
    waiter_clear(&w);
    close_db(db);
}

/* string heap: results decode to the same values, ASCII strings are referenced, others inline */
static void test_strheap(void) {
    NSDb* db = open_db(E, ":memory:", NULL);
    CHECK_EQ(run_ok(db, "CREATE TABLE t(a, b, c)"), 0);
    CHECK_EQ(run_ok(db, "INSERT INTO t VALUES ('plain', 'caf\xc3\xa9', ''), (NULL, 'x', 'long ascii string value')"), 0);
    const char* sql = "SELECT a, b, c FROM t";
    Waiter w1, w2;
    waiter_init(&w1);
    waiter_init(&w2);
    CHECK_EQ(nssqlite_exec(db, 0, sql, strlen(sql), NULL, 0, 0, 0, on_result, &w1), 0);
    CHECK_EQ(nssqlite_exec(db, 0, sql, strlen(sql), NULL, 0, NS_EXEC_STRHEAP, 0, on_result, &w2), 0);
    CHECK(waiter_wait(&w1) && waiter_wait(&w2));
    NSRows r1, r2;
    CHECK(nssqlite_rows_init(&r1, w1.res[0].data, w1.res[0].len) == 0);
    CHECK(nssqlite_rows_init(&r2, w2.res[0].data, w2.res[0].len) == 0);
    CHECK(r2.heap != NULL && r2.heap_len == strlen("plain") + strlen("x") + strlen("long ascii string value"));
    NSValue a[3], b[3];
    for (int row = 0; row < 2; row++) {
        CHECK_EQ(nssqlite_rows_next(&r1, a), 1);
        CHECK_EQ(nssqlite_rows_next(&r2, b), 1);
        for (int c = 0; c < 3; c++) {
            CHECK_EQ(a[c].type, b[c].type);
            CHECK_EQ(a[c].len, b[c].len);
            if (a[c].type == NS_T_TEXT) CHECK(memcmp(a[c].ptr, b[c].ptr, a[c].len) == 0);
        }
    }
    waiter_clear(&w1);
    waiter_clear(&w2);
    close_db(db);
}

static void test_json(void) {
    NSDb* db = open_db(E, ":memory:", NULL);
    CHECK_EQ(run_ok(db, "CREATE TABLE t(i INTEGER, r REAL, s TEXT, b BLOB, n)"), 0);
    CHECK_EQ(run_ok(db, "INSERT INTO t VALUES (7, 0.5, 'q\"\\\n\xc3\xa9', x'4d616e', NULL)"), 0);
    Waiter w;
    waiter_init(&w);
    const char* sql = "SELECT i, r, s, b, n FROM t";
    CHECK_EQ(nssqlite_exec(db, 0, sql, strlen(sql), NULL, 0, NS_EXEC_JSON, 0, on_result, &w), 0);
    CHECK(waiter_wait(&w));
    NSResult* r = waiter_last(&w);
    CHECK_EQ(r->status, 0);
    const char* expect = "{\"c\":[\"i\",\"r\",\"s\",\"b\",\"n\"],\"r\":[[7,0.5,\"q\\\"\\\\\\u000a\xc3\xa9\",\"TWFu\",null]]}";
    CHECK(r->len == strlen(expect) && memcmp(r->data, expect, r->len) == 0);
    if (r->len != strlen(expect) || memcmp(r->data, expect, r->len)) fprintf(stderr, "json: %.*s\n", (int)r->len, r->data);
    waiter_clear(&w);
    close_db(db);
}

int main(void) {
    E = test_engine();
    test_engine_cache();
    test_types();
    test_errors();
    test_script();
    test_statement_cache();
    test_chunks();
    test_batch();
    test_transactions();
    test_failed_transaction();
    test_close_semantics();
    test_open_failure();
    test_open_options();
    test_extensions_unsupported();
    test_many_submitters();
    test_parallel_databases();
    test_large_result();
    test_json();
    test_strheap();
    return finish("db");
}

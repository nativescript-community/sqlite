#ifndef NSSQLITE_TEST_HARNESS_H
#define NSSQLITE_TEST_HARNESS_H

#include <pthread.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

#include "../nssqlite.h"
#include "../nssqlite_wire.h"

#define UNUSED __attribute__((unused))
static int g_failures = 0;
#define CHECK(c)                                                                  \
    do {                                                                          \
        if (!(c)) {                                                               \
            fprintf(stderr, "FAIL %s:%d  %s\n", __FILE__, __LINE__, #c);          \
            g_failures++;                                                         \
        }                                                                         \
    } while (0)
#define CHECK_EQ(a, b)                                                                                                       \
    do {                                                                                                                     \
        long long a_ = (long long)(a), b_ = (long long)(b);                                                                  \
        if (a_ != b_) {                                                                                                      \
            fprintf(stderr, "FAIL %s:%d  %s == %s  (%lld vs %lld)\n", __FILE__, __LINE__, #a, #b, a_, b_);                   \
            g_failures++;                                                                                                    \
        }                                                                                                                    \
    } while (0)

/* Collects the callbacks of one request. */
#define MAX_RES 64
typedef struct Waiter {
    pthread_mutex_t mu;
    pthread_cond_t cv;
    NSResult res[MAX_RES];
    int n;
    int done;
} Waiter;

UNUSED static void waiter_init(Waiter* w) {
    memset(w, 0, sizeof(*w));
    pthread_mutex_init(&w->mu, NULL);
    pthread_cond_init(&w->cv, NULL);
}

UNUSED static void on_result(void* user, NSResult r) {
    Waiter* w = (Waiter*)user;
    pthread_mutex_lock(&w->mu);
    if (w->n < MAX_RES) {
        w->res[w->n++] = r;
    } else {
        free(r.data);
        free(r.message);
    }
    if (r.done) w->done = 1;
    pthread_cond_broadcast(&w->cv);
    pthread_mutex_unlock(&w->mu);
}

UNUSED static int waiter_wait(Waiter* w) {
    struct timespec ts;
    clock_gettime(CLOCK_REALTIME, &ts);
    ts.tv_sec += 20;
    pthread_mutex_lock(&w->mu);
    int rc = 0;
    while (!w->done && rc == 0) rc = pthread_cond_timedwait(&w->cv, &w->mu, &ts);
    int ok = w->done;
    pthread_mutex_unlock(&w->mu);
    if (!ok) fprintf(stderr, "TIMEOUT waiting for a callback\n");
    return ok;
}

UNUSED static NSResult* waiter_last(Waiter* w) { return &w->res[w->n - 1]; }

UNUSED static void waiter_clear(Waiter* w) {
    for (int i = 0; i < w->n; i++) {
        free(w->res[i].data);
        free(w->res[i].message);
    }
    w->n = 0;
    w->done = 0;
}

/* params block builder */
typedef struct Params {
    NSBuf b;
    uint32_t n;
} Params;
UNUSED static void params_init(Params* p) {
    nssqlite_buf_init(&p->b);
    nssqlite_buf_u32(&p->b, 0);
    p->n = 0;
}
UNUSED static void params_null(Params* p) { nssqlite_buf_value_null(&p->b); p->n++; }
UNUSED static void params_int(Params* p, int64_t v) { nssqlite_buf_value_int(&p->b, v); p->n++; }
UNUSED static void params_double(Params* p, double v) { nssqlite_buf_value_double(&p->b, v); p->n++; }
UNUSED static void params_text(Params* p, const char* s) { nssqlite_buf_value_text(&p->b, s, strlen(s)); p->n++; }
UNUSED static void params_blob(Params* p, const void* d, size_t n) { nssqlite_buf_value_blob(&p->b, d, n); p->n++; }
UNUSED static void params_done(Params* p) { nssqlite_buf_patch_u32(&p->b, 0, p->n); }

/* Run one statement and wait. Returns the status; w keeps the result (waiter_clear when done). */
UNUSED static int run(NSDb* db, uint32_t tx, const char* sql, Params* p, Waiter* w) {
    waiter_init(w);
    if (p) params_done(p);
    int rc = nssqlite_exec(db, tx, sql, strlen(sql), p ? p->b.data : NULL, p ? p->b.len : 0, 0, 0, on_result, w);
    if (rc) return rc;
    if (!waiter_wait(w)) return -999;
    return waiter_last(w)->status;
}

UNUSED static int run_ok(NSDb* db, const char* sql) {
    Waiter w;
    int rc = run(db, 0, sql, NULL, &w);
    if (rc) fprintf(stderr, "run_ok(%s) -> %d %s\n", sql, rc, waiter_last(&w)->message ? waiter_last(&w)->message : "");
    waiter_clear(&w);
    return rc;
}

UNUSED static NSEngine* test_engine(void) {
    char err[256];
    NSEngine* e = nssqlite_engine(NSSQLITE_TEST_ENGINE, err, sizeof(err));
    if (!e) {
        fprintf(stderr, "cannot load test engine %s: %s\n", NSSQLITE_TEST_ENGINE, err);
        exit(2);
    }
    return e;
}

UNUSED static NSDb* open_db(NSEngine* e, const char* path, const NSOpenOptions* o) {
    Waiter w;
    waiter_init(&w);
    NSDb* db = nssqlite_open(e, path, o, on_result, &w);
    if (!db || !waiter_wait(&w) || waiter_last(&w)->status != 0) {
        fprintf(stderr, "open %s failed: %s\n", path, w.n && waiter_last(&w)->message ? waiter_last(&w)->message : "?");
        exit(2);
    }
    waiter_clear(&w);
    return db;
}

UNUSED static void close_db(NSDb* db) {
    Waiter w;
    waiter_init(&w);
    CHECK(nssqlite_close(db, on_result, &w) == 0);
    CHECK(waiter_wait(&w));
    CHECK_EQ(waiter_last(&w)->status, 0);
    waiter_clear(&w);
    nssqlite_db_release(db);
}

/* Reads value (row, col) of the final result of w. Returns 0 on success. */
UNUSED static int cell(Waiter* w, uint32_t row, uint32_t col, NSValue* out) {
    NSResult* r = waiter_last(w);
    NSRows rows;
    if (!r->data || nssqlite_rows_init(&rows, r->data, r->len)) return -1;
    NSValue vals[32];
    for (uint32_t i = 0;; i++) {
        int rc = nssqlite_rows_next(&rows, vals);
        if (rc <= 0) return -1;
        if (i == row) {
            *out = vals[col];
            return 0;
        }
    }
}

UNUSED static uint32_t nrows(Waiter* w) {
    NSRows rows;
    NSResult* r = waiter_last(w);
    if (!r->data || nssqlite_rows_init(&rows, r->data, r->len)) return 0;
    return rows.nrows;
}

UNUSED static int64_t scalar_int(NSDb* db, uint32_t tx, const char* sql) {
    Waiter w;
    NSValue v;
    int64_t out = -1;
    if (run(db, tx, sql, NULL, &w) == 0 && cell(&w, 0, 0, &v) == 0) out = v.i;
    waiter_clear(&w);
    return out;
}

UNUSED static int finish(const char* name) {
    if (g_failures) {
        fprintf(stderr, "%s: %d failure(s)\n", name, g_failures);
        return 1;
    }
    printf("%s: OK\n", name);
    return 0;
}

#endif

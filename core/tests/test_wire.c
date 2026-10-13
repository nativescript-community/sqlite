#include "harness.h"

static void test_roundtrip(void) {
    NSBuf b;
    nssqlite_buf_init(&b);
    nssqlite_buf_u32(&b, 7);
    nssqlite_buf_value_null(&b);
    nssqlite_buf_value_int(&b, 0);
    nssqlite_buf_value_int(&b, INT32_MAX);
    nssqlite_buf_value_int(&b, (int64_t)INT32_MAX + 1);
    nssqlite_buf_value_int(&b, INT32_MIN);
    nssqlite_buf_value_int(&b, (int64_t)INT32_MIN - 1);
    nssqlite_buf_value_int(&b, 9007199254740993LL);
    nssqlite_buf_value_int(&b, INT64_MIN);
    nssqlite_buf_value_double(&b, -0.5);
    nssqlite_buf_value_text(&b, "h\xc3\xa9llo", 6);
    nssqlite_buf_value_text(&b, "", 0);
    const uint8_t blob[4] = {0, 1, 0, 255};
    nssqlite_buf_value_blob(&b, blob, 4);
    CHECK(!b.oom);

    NSReader r;
    nssqlite_reader_init(&r, b.data, b.len);
    uint32_t head;
    CHECK(nssqlite_reader_u32(&r, &head) == 0);
    CHECK_EQ(head, 7);
    NSValue v;
    CHECK(nssqlite_reader_value(&r, &v) == 0); CHECK_EQ(v.type, NS_T_NULL);
    CHECK(nssqlite_reader_value(&r, &v) == 0); CHECK_EQ(v.type, NS_T_INT32); CHECK_EQ(v.i, 0);
    CHECK(nssqlite_reader_value(&r, &v) == 0); CHECK_EQ(v.type, NS_T_INT32); CHECK_EQ(v.i, INT32_MAX);
    CHECK(nssqlite_reader_value(&r, &v) == 0); CHECK_EQ(v.type, NS_T_INT64); CHECK_EQ(v.i, (int64_t)INT32_MAX + 1);
    CHECK(nssqlite_reader_value(&r, &v) == 0); CHECK_EQ(v.type, NS_T_INT32); CHECK_EQ(v.i, INT32_MIN);
    CHECK(nssqlite_reader_value(&r, &v) == 0); CHECK_EQ(v.type, NS_T_INT64); CHECK_EQ(v.i, (int64_t)INT32_MIN - 1);
    CHECK(nssqlite_reader_value(&r, &v) == 0); CHECK_EQ(v.type, NS_T_INT64); CHECK_EQ(v.i, 9007199254740993LL);
    CHECK(nssqlite_reader_value(&r, &v) == 0); CHECK_EQ(v.type, NS_T_INT64); CHECK(v.i == INT64_MIN);
    CHECK(nssqlite_reader_value(&r, &v) == 0); CHECK_EQ(v.type, NS_T_DOUBLE); CHECK(v.d == -0.5);
    CHECK(nssqlite_reader_value(&r, &v) == 0); CHECK_EQ(v.type, NS_T_TEXT); CHECK_EQ(v.len, 6); CHECK(memcmp(v.ptr, "h\xc3\xa9llo", 6) == 0);
    CHECK(nssqlite_reader_value(&r, &v) == 0); CHECK_EQ(v.type, NS_T_TEXT); CHECK_EQ(v.len, 0);
    CHECK(nssqlite_reader_value(&r, &v) == 0); CHECK_EQ(v.type, NS_T_BLOB); CHECK_EQ(v.len, 4); CHECK(memcmp(v.ptr, blob, 4) == 0);
    CHECK(r.p == r.end);
    CHECK(nssqlite_reader_value(&r, &v) != 0); /* nothing left */
    nssqlite_buf_free(&b);
}

static void test_bad_input(void) {
    NSReader r;
    NSValue v;
    const uint8_t bad_tag[] = {9};
    nssqlite_reader_init(&r, bad_tag, 1);
    CHECK(nssqlite_reader_value(&r, &v) != 0);
    /* text claiming more bytes than available */
    const uint8_t short_text[] = {NS_T_TEXT, 100, 0, 0, 0, 'a'};
    nssqlite_reader_init(&r, short_text, sizeof(short_text));
    CHECK(nssqlite_reader_value(&r, &v) != 0);
    /* length that would overflow pointer arithmetic */
    const uint8_t huge[] = {NS_T_BLOB, 0xff, 0xff, 0xff, 0xff};
    nssqlite_reader_init(&r, huge, sizeof(huge));
    CHECK(nssqlite_reader_value(&r, &v) != 0);
    nssqlite_reader_init(&r, NULL, 0);
    CHECK(nssqlite_reader_value(&r, &v) != 0);
}

/* Every prefix of a valid rows block must be rejected or read without touching out of bounds. */
static void test_truncated_rows(void) {
    NSBuf b;
    nssqlite_buf_init(&b);
    nssqlite_buf_u32(&b, NS_ROWS_MAGIC);
    nssqlite_buf_u32(&b, 2);
    nssqlite_buf_u32(&b, 2);
    nssqlite_buf_i64(&b, 5);
    nssqlite_buf_i64(&b, 6);
    nssqlite_buf_u32(&b, 1); nssqlite_buf_bytes(&b, "a", 1);
    nssqlite_buf_u32(&b, 3); nssqlite_buf_bytes(&b, "bcd", 3);
    for (int row = 0; row < 2; row++) {
        nssqlite_buf_value_int(&b, row);
        nssqlite_buf_value_text(&b, "txt", 3);
    }
    NSRows rows;
    CHECK(nssqlite_rows_init(&rows, b.data, b.len) == 0);
    CHECK_EQ(rows.ncols, 2); CHECK_EQ(rows.nrows, 2); CHECK_EQ(rows.changes, 5); CHECK_EQ(rows.last_insert_rowid, 6);
    const uint8_t* name; uint32_t nl;
    CHECK(nssqlite_rows_name(&rows, 1, &name, &nl) == 0); CHECK(nl == 3 && memcmp(name, "bcd", 3) == 0);
    CHECK(nssqlite_rows_name(&rows, 2, &name, &nl) != 0);
    NSValue vals[2];
    CHECK_EQ(nssqlite_rows_next(&rows, vals), 1);
    CHECK_EQ(nssqlite_rows_next(&rows, vals), 1);
    CHECK_EQ(nssqlite_rows_next(&rows, vals), 0);

    for (size_t len = 0; len < b.len; len++) {
        uint8_t* copy = (uint8_t*)malloc(len ? len : 1); /* exact size so ASan sees overreads */
        memcpy(copy, b.data, len);
        NSRows t;
        if (nssqlite_rows_init(&t, copy, len) == 0) {
            int rc;
            while ((rc = nssqlite_rows_next(&t, vals)) > 0) {}
            CHECK(rc < 0);
        }
        free(copy);
    }
    /* lying counts */
    uint8_t* copy = (uint8_t*)malloc(b.len);
    memcpy(copy, b.data, b.len);
    uint32_t big = 0x7fffffff;
    memcpy(copy + 4, &big, 4); /* ncols */
    CHECK(nssqlite_rows_init(&rows, copy, b.len) != 0);
    free(copy);
    nssqlite_buf_free(&b);
}

static void test_buf_take(void) {
    NSBuf b;
    nssqlite_buf_init(&b);
    nssqlite_buf_u32(&b, 1);
    size_t n;
    uint8_t* d = nssqlite_buf_take(&b, &n);
    CHECK(d && n == 4 && b.data == NULL && b.len == 0);
    nssqlite_free(d);
}

int main(void) {
    test_roundtrip();
    test_bad_input();
    test_truncated_rows();
    test_buf_take();
    return finish("wire");
}

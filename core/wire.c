#include "nssqlite_wire.h"

#include <stdlib.h>
#include <string.h>

#include "nssqlite.h"

/* The format is little endian; every supported target (arm64, x86_64, armv7, x86) is. */
#if defined(__BYTE_ORDER__) && __BYTE_ORDER__ != __ORDER_LITTLE_ENDIAN__
#error "nssqlite wire format assumes a little endian host"
#endif

void nssqlite_free(void* p) { free(p); }

/* ---- writer ---- */

void nssqlite_buf_init(NSBuf* b) { memset(b, 0, sizeof(*b)); }

void nssqlite_buf_free(NSBuf* b) {
    free(b->data);
    nssqlite_buf_init(b);
}

uint8_t* nssqlite_buf_take(NSBuf* b, size_t* len) {
    uint8_t* d = b->data;
    if (len) *len = b->len;
    if (b->oom) {
        free(d);
        d = NULL;
        if (len) *len = 0;
    }
    nssqlite_buf_init(b);
    return d;
}

static int reserve(NSBuf* b, size_t extra) {
    if (b->oom) return 0;
    if (extra > SIZE_MAX - b->len) {
        b->oom = 1;
        return 0;
    }
    size_t need = b->len + extra;
    if (need <= b->cap) return 1;
    size_t cap = b->cap ? b->cap : 256;
    while (cap < need) {
        if (cap > SIZE_MAX / 2) {
            cap = need;
            break;
        }
        cap *= 2;
    }
    uint8_t* d = (uint8_t*)realloc(b->data, cap);
    if (!d) {
        b->oom = 1;
        return 0;
    }
    b->data = d;
    b->cap = cap;
    return 1;
}

void nssqlite_buf_bytes(NSBuf* b, const void* p, size_t n) {
    if (n && reserve(b, n)) {
        memcpy(b->data + b->len, p, n);
        b->len += n;
    }
}

void nssqlite_buf_u8(NSBuf* b, uint8_t v) { nssqlite_buf_bytes(b, &v, 1); }
void nssqlite_buf_u32(NSBuf* b, uint32_t v) { nssqlite_buf_bytes(b, &v, 4); }
void nssqlite_buf_i64(NSBuf* b, int64_t v) { nssqlite_buf_bytes(b, &v, 8); }

void nssqlite_buf_patch_u32(NSBuf* b, size_t at, uint32_t v) {
    if (!b->oom && at + 4 <= b->len) memcpy(b->data + at, &v, 4);
}

void nssqlite_buf_value_null(NSBuf* b) { nssqlite_buf_u8(b, NS_T_NULL); }

void nssqlite_buf_value_int(NSBuf* b, int64_t v) {
    if (v >= INT32_MIN && v <= INT32_MAX) {
        int32_t i = (int32_t)v;
        nssqlite_buf_u8(b, NS_T_INT32);
        nssqlite_buf_bytes(b, &i, 4);
    } else {
        nssqlite_buf_u8(b, NS_T_INT64);
        nssqlite_buf_i64(b, v);
    }
}

void nssqlite_buf_value_double(NSBuf* b, double v) {
    nssqlite_buf_u8(b, NS_T_DOUBLE);
    nssqlite_buf_bytes(b, &v, 8);
}

static void value_bytes(NSBuf* b, uint8_t tag, const void* p, size_t n) {
    if (n > UINT32_MAX) {
        b->oom = 1;
        return;
    }
    nssqlite_buf_u8(b, tag);
    nssqlite_buf_u32(b, (uint32_t)n);
    nssqlite_buf_bytes(b, p, n);
}

void nssqlite_buf_value_text(NSBuf* b, const char* s, size_t n) { value_bytes(b, NS_T_TEXT, s, n); }
void nssqlite_buf_value_blob(NSBuf* b, const void* p, size_t n) { value_bytes(b, NS_T_BLOB, p, n); }

/* ---- reader ---- */

void nssqlite_reader_init(NSReader* r, const uint8_t* data, size_t len) {
    r->p = data;
    r->end = data ? data + len : data;
}

int nssqlite_reader_bytes(NSReader* r, size_t n, const uint8_t** out) {
    if (n > (size_t)(r->end - r->p)) return -1;
    if (out) *out = r->p;
    r->p += n;
    return 0;
}

int nssqlite_reader_u32(NSReader* r, uint32_t* out) {
    const uint8_t* p;
    if (nssqlite_reader_bytes(r, 4, &p)) return -1;
    memcpy(out, p, 4);
    return 0;
}

int nssqlite_reader_value(NSReader* r, NSValue* out) {
    const uint8_t* p;
    if (nssqlite_reader_bytes(r, 1, &p)) return -1;
    memset(out, 0, sizeof(*out));
    out->type = *p;
    switch (out->type) {
        case NS_T_NULL:
            return 0;
        case NS_T_INT32: {
            int32_t v;
            if (nssqlite_reader_bytes(r, 4, &p)) return -1;
            memcpy(&v, p, 4);
            out->i = v;
            return 0;
        }
        case NS_T_INT64:
            if (nssqlite_reader_bytes(r, 8, &p)) return -1;
            memcpy(&out->i, p, 8);
            return 0;
        case NS_T_DOUBLE:
            if (nssqlite_reader_bytes(r, 8, &p)) return -1;
            memcpy(&out->d, p, 8);
            return 0;
        case NS_T_TEXT:
        case NS_T_BLOB:
            if (nssqlite_reader_u32(r, &out->len)) return -1;
            return nssqlite_reader_bytes(r, out->len, &out->ptr);
        default:
            return -1;
    }
}

/* ---- rows block ---- */

int nssqlite_rows_init(NSRows* rows, const uint8_t* data, size_t len) {
    memset(rows, 0, sizeof(*rows));
    nssqlite_reader_init(&rows->r, data, len);
    uint32_t magic;
    const uint8_t* p;
    if (nssqlite_reader_u32(&rows->r, &magic) || magic != NS_ROWS_MAGIC) return -1;
    if (nssqlite_reader_u32(&rows->r, &rows->ncols) || nssqlite_reader_u32(&rows->r, &rows->nrows)) return -1;
    if (nssqlite_reader_bytes(&rows->r, 8, &p)) return -1;
    memcpy(&rows->changes, p, 8);
    if (nssqlite_reader_bytes(&rows->r, 8, &p)) return -1;
    memcpy(&rows->last_insert_rowid, p, 8);
    rows->names = rows->r.p;
    for (uint32_t i = 0; i < rows->ncols; i++) {
        uint32_t n;
        if (nssqlite_reader_u32(&rows->r, &n) || nssqlite_reader_bytes(&rows->r, n, NULL)) return -1;
    }
    return 0;
}

int nssqlite_rows_name(const NSRows* rows, uint32_t i, const uint8_t** name, uint32_t* len) {
    if (i >= rows->ncols) return -1;
    NSReader r;
    nssqlite_reader_init(&r, rows->names, (size_t)(rows->r.end - rows->names));
    for (uint32_t k = 0;; k++) {
        uint32_t n;
        const uint8_t* p;
        if (nssqlite_reader_u32(&r, &n) || nssqlite_reader_bytes(&r, n, &p)) return -1;
        if (k == i) {
            *name = p;
            *len = n;
            return 0;
        }
    }
}

int nssqlite_rows_next(NSRows* rows, NSValue* out) {
    if (rows->next_row >= rows->nrows) return 0;
    for (uint32_t c = 0; c < rows->ncols; c++) {
        if (nssqlite_reader_value(&rows->r, &out[c])) return -1;
    }
    rows->next_row++;
    return 1;
}

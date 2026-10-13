/*
 * Wire format shared by the core, the bindings and the TypeScript codec. Little endian, no padding.
 *
 * value       := tag:u8 payload
 *   NULL   (0): -
 *   INT32  (1): i32
 *   INT64  (2): i64
 *   DOUBLE (3): f64
 *   TEXT   (4): len:u32 utf8 bytes
 *   BLOB   (5): len:u32 bytes
 *
 * params block  := count:u32 value{count}
 * rows block    := magic:u32 'NSR1' ncols:u32 nrows:u32 changes:i64 last_insert_rowid:i64
 *                  (len:u32 utf8){ncols}  value{ncols * nrows}      (row major)
 * rows block v2 := magic:u32 'NSR2' ncols:u32 nrows:u32 changes:i64 last_insert_rowid:i64 heap_offset:u32
 *                  (len:u32 utf8){ncols}  value{ncols * nrows}  heap:bytes   (requested with NS_EXEC_STRHEAP)
 *   adds value TEXT_REF (6): offset:u32 len:u32 = an all-ASCII string stored in the heap that starts at
 *   heap_offset (byte offsets equal UTF-16 offsets, so a reader can decode the heap once and slice it).
 *   Strings with non-ASCII bytes stay inline (TEXT).
 * batch request := n:u32 ( sql_len:u32 sql  params_len:u32 params block ){n}
 * batch result  := n:u32 ( block_len:u32 rows block ){n}            (n = statements completed)
 */
#ifndef NSSQLITE_WIRE_H
#define NSSQLITE_WIRE_H

#include <stddef.h>
#include <stdint.h>

#include "nssqlite.h"

#ifdef __cplusplus
extern "C" {
#endif

#define NS_ROWS_MAGIC 0x3152534Eu  /* "NSR1" little endian */
#define NS_ROWS_MAGIC2 0x3252534Eu /* "NSR2": rows block with an ASCII string heap */

enum { NS_T_NULL = 0, NS_T_INT32 = 1, NS_T_INT64 = 2, NS_T_DOUBLE = 3, NS_T_TEXT = 4, NS_T_BLOB = 5, NS_T_TEXT_REF = 6 };

typedef struct NSValue {
    uint8_t type;
    int64_t i;              /* INT32, INT64 */
    double d;               /* DOUBLE */
    const uint8_t* ptr;     /* TEXT, BLOB: points into the source buffer */
    uint32_t len;
    uint8_t ascii;          /* TEXT read from the string heap: known to be 7-bit ASCII */
} NSValue;

/* ---- writer ---- */

typedef struct NSBuf {
    uint8_t* data;
    size_t len;
    size_t cap;
    int oom;
} NSBuf;

NSSQLITE_API void nssqlite_buf_init(NSBuf* b);
NSSQLITE_API void nssqlite_buf_free(NSBuf* b);
/* Hand the bytes to the caller (free with nssqlite_free) and reset the buffer. */
NSSQLITE_API uint8_t* nssqlite_buf_take(NSBuf* b, size_t* len);
NSSQLITE_API void nssqlite_buf_u8(NSBuf* b, uint8_t v);
NSSQLITE_API void nssqlite_buf_u32(NSBuf* b, uint32_t v);
NSSQLITE_API void nssqlite_buf_i64(NSBuf* b, int64_t v);
NSSQLITE_API void nssqlite_buf_bytes(NSBuf* b, const void* p, size_t n);
NSSQLITE_API void nssqlite_buf_value_null(NSBuf* b);
NSSQLITE_API void nssqlite_buf_value_int(NSBuf* b, int64_t v); /* INT32 when it fits */
NSSQLITE_API void nssqlite_buf_value_double(NSBuf* b, double v);
NSSQLITE_API void nssqlite_buf_value_text(NSBuf* b, const char* s, size_t n);
NSSQLITE_API void nssqlite_buf_value_blob(NSBuf* b, const void* p, size_t n);
NSSQLITE_API void nssqlite_buf_patch_u32(NSBuf* b, size_t at, uint32_t v);

/* ---- reader (bounds checked; every call returns 0 on success) ---- */

typedef struct NSReader {
    const uint8_t* p;
    const uint8_t* end;
} NSReader;

NSSQLITE_API void nssqlite_reader_init(NSReader* r, const uint8_t* data, size_t len);
NSSQLITE_API int nssqlite_reader_u32(NSReader* r, uint32_t* out);
NSSQLITE_API int nssqlite_reader_bytes(NSReader* r, size_t n, const uint8_t** out);
NSSQLITE_API int nssqlite_reader_value(NSReader* r, NSValue* out);

/* Rows block reader. */
typedef struct NSRows {
    NSReader r;
    uint32_t ncols;
    uint32_t nrows;
    uint32_t next_row;
    int64_t changes;
    int64_t last_insert_rowid;
    const uint8_t* names; /* start of the column names */
    const uint8_t* heap;  /* v2: string heap, NULL for v1 */
    size_t heap_len;
} NSRows;

NSSQLITE_API int nssqlite_rows_init(NSRows* rows, const uint8_t* data, size_t len);
/* Name i (0 <= i < ncols). Returns 0 on success. Walks the names, O(i). */
NSSQLITE_API int nssqlite_rows_name(const NSRows* rows, uint32_t i, const uint8_t** name, uint32_t* len);
/* Fills out[ncols]. Returns 1 when a row was read, 0 at the end, < 0 on malformed data. */
NSSQLITE_API int nssqlite_rows_next(NSRows* rows, NSValue* out);

#ifdef __cplusplus
}
#endif
#endif

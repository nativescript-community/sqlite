/**
 * TypeScript side of the wire format shared with the C core (core/nssqlite_wire.h): parameters and batches are
 * encoded here, rows blocks are decoded here. One implementation serves every backend (the decode benchmark showed
 * native decoding is not worth a second implementation).
 */
import { Int64Mode, SqliteParam, SqliteParams } from './sqlite.common';

const T_NULL = 0;
const T_INT32 = 1;
const T_INT64 = 2;
const T_DOUBLE = 3;
const T_TEXT = 4;
const T_BLOB = 5;
const T_TEXT_REF = 6;

const ROWS_MAGIC = 0x3152534e; // "NSR1"
const HEADER_SIZE = 32;
const TWO32 = 4294967296;

/**
 * UTF-8 without a hard dependency on the globals: a runtime installs TextDecoder / TextEncoder lazily (NativeScript
 * core polyfills them when its globals load, which may be after this module is evaluated), and some have none. The
 * native ones are used as soon as they exist; until then (or without them) small pure JS versions do the work.
 */
declare const TextDecoder: any;
declare const TextEncoder: any;

let nativeDecoder: any;
let nativeEncoder: any;
/** NativeScript 8 runtimes ship a TextDecoder that ignores the byteOffset of a view: there, decode copies (`slice`) instead of views (`subarray`). */
let subarrayOk = false;

function nativeCodecs() {
    if (!nativeDecoder && typeof TextDecoder !== 'undefined') {
        const d = new TextDecoder();
        try {
            subarrayOk = d.decode(new Uint8Array([65, 66, 67, 68]).subarray(2)) === 'CD';
        } catch (e) {
            subarrayOk = false;
        }
        nativeDecoder = d;
    }
    if (!nativeEncoder && typeof TextEncoder !== 'undefined') {
        nativeEncoder = new TextEncoder();
    }
}

/** UTF-8 -> string. Invalid sequences become U+FFFD. */
export function utf8DecodeJs(u8: Uint8Array, start: number, end: number): string {
    let out = '';
    let chunk: number[] = [];
    let i = start;
    const flush = () => {
        out += String.fromCharCode.apply(null, chunk as any);
        chunk = [];
    };
    while (i < end) {
        const b0 = u8[i++];
        let cp: number;
        if (b0 < 0x80) {
            cp = b0;
        } else if (b0 >= 0xc2 && b0 < 0xe0 && i < end && (u8[i] & 0xc0) === 0x80) {
            cp = ((b0 & 0x1f) << 6) | (u8[i++] & 0x3f);
        } else if (b0 >= 0xe0 && b0 < 0xf0 && i + 1 < end && (u8[i] & 0xc0) === 0x80 && (u8[i + 1] & 0xc0) === 0x80) {
            cp = ((b0 & 0x0f) << 12) | ((u8[i] & 0x3f) << 6) | (u8[i + 1] & 0x3f);
            i += 2;
            if (cp < 0x800 || (cp >= 0xd800 && cp < 0xe000)) {
                cp = 0xfffd;
            }
        } else if (b0 >= 0xf0 && b0 < 0xf5 && i + 2 < end && (u8[i] & 0xc0) === 0x80 && (u8[i + 1] & 0xc0) === 0x80 && (u8[i + 2] & 0xc0) === 0x80) {
            cp = ((b0 & 0x07) << 18) | ((u8[i] & 0x3f) << 12) | ((u8[i + 1] & 0x3f) << 6) | (u8[i + 2] & 0x3f);
            i += 3;
            if (cp < 0x10000 || cp > 0x10ffff) {
                cp = 0xfffd;
            }
        } else {
            cp = 0xfffd;
        }
        if (cp >= 0x10000) {
            cp -= 0x10000;
            chunk.push(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
        } else {
            chunk.push(cp);
        }
        if (chunk.length >= 8192) {
            flush();
        }
    }
    flush();
    return out;
}

/** string -> UTF-8. Lone surrogates become U+FFFD, like TextEncoder. */
export function utf8EncodeJs(s: string): Uint8Array {
    const n = s.length;
    const out = new Uint8Array(n * 3);
    let o = 0;
    for (let i = 0; i < n; i++) {
        let c = s.charCodeAt(i);
        if (c >= 0xd800 && c < 0xdc00 && i + 1 < n) {
            const d = s.charCodeAt(i + 1);
            if (d >= 0xdc00 && d < 0xe000) {
                c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00);
                i++;
            }
        }
        if (c >= 0xd800 && c < 0xe000) {
            c = 0xfffd;
        }
        if (c < 0x80) {
            out[o++] = c;
        } else if (c < 0x800) {
            out[o++] = 0xc0 | (c >> 6);
            out[o++] = 0x80 | (c & 0x3f);
        } else if (c < 0x10000) {
            out[o++] = 0xe0 | (c >> 12);
            out[o++] = 0x80 | ((c >> 6) & 0x3f);
            out[o++] = 0x80 | (c & 0x3f);
        } else {
            out[o++] = 0xf0 | (c >> 18);
            out[o++] = 0x80 | ((c >> 12) & 0x3f);
            out[o++] = 0x80 | ((c >> 6) & 0x3f);
            out[o++] = 0x80 | (c & 0x3f);
        }
    }
    return out.subarray(0, o);
}

function decodeUtf8(u8: Uint8Array, start: number, end: number): string {
    nativeCodecs();
    if (!nativeDecoder) {
        return utf8DecodeJs(u8, start, end);
    }
    return nativeDecoder.decode(subarrayOk ? u8.subarray(start, end) : u8.slice(start, end));
}

export function encodeUtf8(s: string): Uint8Array {
    nativeCodecs();
    return nativeEncoder ? nativeEncoder.encode(s) : utf8EncodeJs(s);
}

// ---------------------------------------------------------------------------------------------------------------
// writer
// ---------------------------------------------------------------------------------------------------------------

class Writer {
    u8 = new Uint8Array(512);
    dv = new DataView(this.u8.buffer);
    len = 0;

    reset() {
        this.len = 0;
    }

    ensure(extra: number) {
        const need = this.len + extra;
        if (need <= this.u8.length) {
            return;
        }
        let cap = this.u8.length * 2;
        while (cap < need) {
            cap *= 2;
        }
        const u8 = new Uint8Array(cap);
        u8.set(this.u8.subarray(0, this.len));
        this.u8 = u8;
        this.dv = new DataView(u8.buffer);
    }

    u32(v: number) {
        this.ensure(4);
        this.dv.setUint32(this.len, v, true);
        this.len += 4;
    }

    patchU32(at: number, v: number) {
        this.dv.setUint32(at, v, true);
    }

    bytes(src: Uint8Array) {
        this.ensure(src.length);
        this.u8.set(src, this.len);
        this.len += src.length;
    }

    value(p: SqliteParam, index: number) {
        if (p === null || p === undefined) {
            this.ensure(1);
            this.u8[this.len++] = T_NULL;
            return;
        }
        const type: string = typeof p;
        switch (type) {
            case 'number':
                if (Number.isInteger(p)) {
                    this.integer(p as number);
                } else {
                    this.double(p as number);
                }
                return;
            case 'boolean':
                this.integer(p ? 1 : 0);
                return;
            case 'bigint':
                this.ensure(9);
                this.u8[this.len++] = T_INT64;
                this.dv.setBigInt64(this.len, BigInt.asIntN(64, p as bigint), true);
                this.len += 8;
                return;
            case 'string':
                this.text(p as string);
                return;
            case 'object':
                this.object(p, index);
                return;
        }
        throw new TypeError(`unsupported parameter type ${type} at index ${index}`);
    }

    private integer(v: number) {
        this.ensure(9);
        if (v >= -2147483648 && v <= 2147483647) {
            this.u8[this.len++] = T_INT32;
            this.dv.setInt32(this.len, v, true);
            this.len += 4;
        } else {
            // beyond 2^53 a number is not an exact integer anymore, but it is still the value the caller gave
            this.u8[this.len++] = T_INT64;
            const hi = Math.floor(v / TWO32);
            this.dv.setUint32(this.len, v - hi * TWO32, true);
            this.dv.setInt32(this.len + 4, hi, true);
            this.len += 8;
        }
    }

    private double(v: number) {
        this.ensure(9);
        this.u8[this.len++] = T_DOUBLE;
        this.dv.setFloat64(this.len, v, true);
        this.len += 8;
    }

    private text(s: string) {
        const n = s.length;
        // ASCII fast path, no TextEncoder allocation for the usual identifiers and short values
        if (n <= 64) {
            this.ensure(5 + n);
            const start = this.len + 5;
            let ok = true;
            for (let i = 0; i < n; i++) {
                const c = s.charCodeAt(i);
                if (c > 127) {
                    ok = false;
                    break;
                }
                this.u8[start + i] = c;
            }
            if (ok) {
                this.u8[this.len] = T_TEXT;
                this.dv.setUint32(this.len + 1, n, true);
                this.len = start + n;
                return;
            }
        }
        const bytes = encodeUtf8(s);
        this.ensure(5 + bytes.length);
        this.u8[this.len++] = T_TEXT;
        this.dv.setUint32(this.len, bytes.length, true);
        this.len += 4;
        this.u8.set(bytes, this.len);
        this.len += bytes.length;
    }

    private blob(src: Uint8Array) {
        this.ensure(5 + src.length);
        this.u8[this.len++] = T_BLOB;
        this.dv.setUint32(this.len, src.length, true);
        this.len += 4;
        this.u8.set(src, this.len);
        this.len += src.length;
    }

    private object(p: any, index: number) {
        if (p instanceof Date) {
            this.text(p.toISOString());
        } else if (p instanceof ArrayBuffer) {
            this.blob(new Uint8Array(p));
        } else if (ArrayBuffer.isView(p)) {
            this.blob(new Uint8Array(p.buffer, p.byteOffset, p.byteLength));
        } else if (Array.isArray(p)) {
            // an array of byte values is a blob
            this.blob(Uint8Array.from(p));
        } else {
            throw new TypeError(`unsupported parameter ${Object.prototype.toString.call(p)} at index ${index}`);
        }
    }
}

const scratch = new Writer();
const scratchBatch = new Writer();

function finish(w: Writer): ArrayBuffer {
    return w.u8.buffer.slice(0, w.len) as ArrayBuffer;
}

function writeParams(w: Writer, params: SqliteParams | undefined) {
    if (params === undefined || params === null) {
        w.u32(0);
        return;
    }
    if (!Array.isArray(params)) {
        w.u32(1);
        w.value(params as SqliteParam, 0);
        return;
    }
    w.u32(params.length);
    for (let i = 0; i < params.length; i++) {
        w.value(params[i], i);
    }
}

/** A params block, or null when there is no parameter. */
export function encodeParams(params: SqliteParams | undefined): ArrayBuffer | null {
    if (params === undefined || params === null || (Array.isArray(params) && params.length === 0)) {
        return null;
    }
    scratch.reset();
    writeParams(scratch, params);
    return finish(scratch);
}

/** A batch request block. */
export function encodeBatch(statements: Array<{ sql: string; params?: SqliteParams }>): ArrayBuffer {
    const w = scratchBatch;
    w.reset();
    w.u32(statements.length);
    for (const st of statements) {
        const sql = encodeUtf8(st.sql);
        w.u32(sql.length);
        w.bytes(sql);
        const lenAt = w.len;
        w.u32(0);
        const start = w.len;
        writeParams(w, st.params);
        w.patchU32(lenAt, w.len - start);
    }
    return finish(w);
}

// ---------------------------------------------------------------------------------------------------------------
// reader
// ---------------------------------------------------------------------------------------------------------------

export interface DecodeOptions {
    /** rows as {column: value}, otherwise arrays */
    objects: boolean;
    /** BLOB as ArrayBuffer instead of Uint8Array */
    arrayBufferBlobs?: boolean;
    int64?: Int64Mode;
}

export interface DecodedRows {
    columns: string[];
    rows: any[];
    changes: number;
    lastInsertRowId: number;
}

function int64At(dv: DataView, o: number, mode: Int64Mode | undefined): number | bigint {
    const lo = dv.getUint32(o, true);
    const hi = dv.getInt32(o + 4, true);
    if (mode === 'bigint') {
        return (BigInt(hi) << BigInt(32)) | BigInt(lo);
    }
    if (mode === 'auto' && (hi >= 2097152 || hi < -2097152)) {
        return (BigInt(hi) << BigInt(32)) | BigInt(lo);
    }
    return hi * TWO32 + lo;
}

/** Decodes one rows block located at byteOffset of buf. */
export function decodeRows(buf: ArrayBuffer, options: DecodeOptions, byteOffset = 0, byteLength = buf.byteLength - byteOffset): DecodedRows {
    const dv = new DataView(buf);
    const u8 = new Uint8Array(buf);
    const end = byteOffset + byteLength;
    if (byteLength < HEADER_SIZE || dv.getUint32(byteOffset, true) !== ROWS_MAGIC) {
        throw new Error('malformed result: bad rows block');
    }
    const ncols = dv.getUint32(byteOffset + 4, true);
    const nrows = dv.getUint32(byteOffset + 8, true);
    const changes = dv.getUint32(byteOffset + 12, true) + dv.getInt32(byteOffset + 16, true) * TWO32;
    const lastInsertRowId = dv.getUint32(byteOffset + 20, true) + dv.getInt32(byteOffset + 24, true) * TWO32;
    const heapStart = byteOffset + dv.getUint32(byteOffset + 28, true);
    if (heapStart > end) {
        throw new Error('malformed result: bad string heap');
    }
    const heap = heapStart < end ? decodeUtf8(u8, heapStart, end) : '';

    let o = byteOffset + HEADER_SIZE;
    const columns: string[] = new Array(ncols);
    for (let c = 0; c < ncols; c++) {
        const n = dv.getUint32(o, true);
        o += 4;
        columns[c] = decodeUtf8(u8, o, o + n);
        o += n;
    }

    const objects = options.objects;
    const abBlobs = options.arrayBufferBlobs === true;
    const int64 = options.int64;
    const rows: any[] = new Array(nrows);
    for (let r = 0; r < nrows; r++) {
        const row: any = objects ? {} : new Array(ncols);
        for (let c = 0; c < ncols; c++) {
            let v: any;
            switch (u8[o++]) {
                case T_NULL:
                    v = null;
                    break;
                case T_INT32:
                    v = dv.getInt32(o, true);
                    o += 4;
                    break;
                case T_INT64:
                    v = int64At(dv, o, int64);
                    o += 8;
                    break;
                case T_DOUBLE:
                    v = dv.getFloat64(o, true);
                    o += 8;
                    break;
                case T_TEXT_REF: {
                    const s = dv.getUint32(o, true);
                    v = heap.substring(s, s + dv.getUint32(o + 4, true));
                    o += 8;
                    break;
                }
                case T_TEXT: {
                    const n = dv.getUint32(o, true);
                    o += 4;
                    v = n === 0 ? '' : decodeUtf8(u8, o, o + n);
                    o += n;
                    break;
                }
                case T_BLOB: {
                    const n = dv.getUint32(o, true);
                    o += 4;
                    v = abBlobs ? buf.slice(o, o + n) : u8.slice(o, o + n);
                    o += n;
                    break;
                }
                default:
                    throw new Error('malformed result: unknown value type');
            }
            if (objects) {
                row[columns[c]] = v;
            } else {
                row[c] = v;
            }
        }
        rows[r] = row;
    }
    if (o > heapStart) {
        throw new Error('malformed result: rows run into the string heap');
    }
    return { columns, rows, changes, lastInsertRowId };
}

/** Decodes a batch result: the rows blocks of the statements that completed. */
export function decodeBatch(buf: ArrayBuffer, options: DecodeOptions): DecodedRows[] {
    const dv = new DataView(buf);
    const n = dv.getUint32(0, true);
    const out: DecodedRows[] = new Array(n);
    let o = 4;
    for (let i = 0; i < n; i++) {
        const len = dv.getUint32(o, true);
        o += 4;
        out[i] = decodeRows(buf, options, o, len);
        o += len;
    }
    return out;
}

/**
 * TypeScript side of the wire format shared with the C core (core/nssqlite_wire.h): parameters and batches are encoded here,
 * rows blocks decoded here, for every backend.
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
 * UTF-8 without a hard dependency on the globals: a runtime installs TextDecoder / TextEncoder lazily (maybe after this module
 * loads) and some have none. The native ones are used once they exist, small JS versions otherwise.
 */
declare const TextDecoder: any;
declare const TextEncoder: any;

let nativeDecoder: any;
let nativeEncoder: any;
/** NativeScript 8's TextDecoder ignores the byteOffset of a view: there, decode copies (`slice`) instead of views (`subarray`). */
let subarrayOk = false;

/**
 * UTF-8 done by the Node-API module (decodeUtf8 / encodeUtf8), registered by the backend and used for long strings only: a call
 * costs more than decoding a short one in JS, and beats the JS fallback by far where there is no native TextDecoder.
 */
export interface NativeUtf8 {
    decode(buffer: ArrayBuffer, start: number, end: number): string;
    encode(text: string): ArrayBuffer;
}
let nativeUtf8: NativeUtf8 | null = null;
const NATIVE_UTF8_MIN = 48;
export function setNativeUtf8(codec: NativeUtf8 | null) {
    nativeUtf8 = codec;
}

function nativeCodecs() {
    if (!nativeDecoder && typeof TextDecoder !== 'undefined') {
        const decoder = new TextDecoder();
        try {
            subarrayOk = decoder.decode(new Uint8Array([65, 66, 67, 68]).subarray(2)) === 'CD';
        } catch (error) {
            subarrayOk = false;
        }
        nativeDecoder = decoder;
    }
    if (!nativeEncoder && typeof TextEncoder !== 'undefined') {
        nativeEncoder = new TextEncoder();
    }
}

/** UTF-8 -> string. Invalid sequences become U+FFFD. */
export function utf8DecodeJs(u8: Uint8Array, start: number, end: number): string {
    let out = '';
    let chunk: number[] = [];
    let index = start;
    const flush = () => {
        out += String.fromCharCode(...chunk);
        chunk = [];
    };
    while (index < end) {
        const b0 = u8[index++];
        let cp: number;
        if (b0 < 0x80) {
            cp = b0;
        } else if (b0 >= 0xc2 && b0 < 0xe0 && index < end && (u8[index] & 0xc0) === 0x80) {
            cp = ((b0 & 0x1f) << 6) | (u8[index++] & 0x3f);
        } else if (b0 >= 0xe0 && b0 < 0xf0 && index + 1 < end && (u8[index] & 0xc0) === 0x80 && (u8[index + 1] & 0xc0) === 0x80) {
            cp = ((b0 & 0x0f) << 12) | ((u8[index] & 0x3f) << 6) | (u8[index + 1] & 0x3f);
            index += 2;
            if (cp < 0x800 || (cp >= 0xd800 && cp < 0xe000)) {
                cp = 0xfffd;
            }
        } else if (b0 >= 0xf0 && b0 < 0xf5 && index + 2 < end && (u8[index] & 0xc0) === 0x80 && (u8[index + 1] & 0xc0) === 0x80 && (u8[index + 2] & 0xc0) === 0x80) {
            cp = ((b0 & 0x07) << 18) | ((u8[index] & 0x3f) << 12) | ((u8[index + 1] & 0x3f) << 6) | (u8[index + 2] & 0x3f);
            index += 3;
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
export function utf8EncodeJs(text: string): Uint8Array {
    const textLength = text.length;
    const out = new Uint8Array(textLength * 3);
    let offset = 0;
    for (let index = 0; index < textLength; index++) {
        let code = text.charCodeAt(index);
        if (code >= 0xd800 && code < 0xdc00 && index + 1 < textLength) {
            const next = text.charCodeAt(index + 1);
            if (next >= 0xdc00 && next < 0xe000) {
                code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
                index++;
            }
        }
        if (code >= 0xd800 && code < 0xe000) {
            code = 0xfffd;
        }
        if (code < 0x80) {
            out[offset++] = code;
        } else if (code < 0x800) {
            out[offset++] = 0xc0 | (code >> 6);
            out[offset++] = 0x80 | (code & 0x3f);
        } else if (code < 0x10000) {
            out[offset++] = 0xe0 | (code >> 12);
            out[offset++] = 0x80 | ((code >> 6) & 0x3f);
            out[offset++] = 0x80 | (code & 0x3f);
        } else {
            out[offset++] = 0xf0 | (code >> 18);
            out[offset++] = 0x80 | ((code >> 12) & 0x3f);
            out[offset++] = 0x80 | ((code >> 6) & 0x3f);
            out[offset++] = 0x80 | (code & 0x3f);
        }
    }
    return out.subarray(0, offset);
}

function decodeUtf8(u8: Uint8Array, start: number, end: number): string {
    if (nativeUtf8 && end - start >= NATIVE_UTF8_MIN && u8.buffer instanceof ArrayBuffer) {
        return nativeUtf8.decode(u8.buffer, u8.byteOffset + start, u8.byteOffset + end);
    }
    nativeCodecs();
    if (!nativeDecoder) {
        return utf8DecodeJs(u8, start, end);
    }
    return nativeDecoder.decode(subarrayOk ? u8.subarray(start, end) : u8.slice(start, end));
}

export function encodeUtf8(text: string): Uint8Array {
    if (nativeUtf8 && text.length >= NATIVE_UTF8_MIN) {
        return new Uint8Array(nativeUtf8.encode(text));
    }
    nativeCodecs();
    return nativeEncoder ? nativeEncoder.encode(text) : utf8EncodeJs(text);
}

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

    u32(value: number) {
        this.ensure(4);
        this.dv.setUint32(this.len, value, true);
        this.len += 4;
    }

    patchU32(at: number, value: number) {
        this.dv.setUint32(at, value, true);
    }

    bytes(src: Uint8Array) {
        this.ensure(src.length);
        this.u8.set(src, this.len);
        this.len += src.length;
    }

    value(param: SqliteParam, index: number) {
        if (param === null || param === undefined) {
            this.ensure(1);
            this.u8[this.len++] = T_NULL;
            return;
        }
        switch (typeof param) {
            case 'number':
                if (Number.isInteger(param)) {
                    this.integer(param);
                } else {
                    this.double(param);
                }
                return;
            case 'boolean':
                this.integer(param ? 1 : 0);
                return;
            case 'bigint':
                this.ensure(9);
                this.u8[this.len++] = T_INT64;
                this.dv.setBigInt64(this.len, BigInt.asIntN(64, param), true);
                this.len += 8;
                return;
            case 'string':
                this.text(param);
                return;
            case 'object':
                this.object(param, index);
                return;
            default:
                throw new TypeError(`unsupported parameter type ${typeof param} at index ${index}`);
        }
    }

    private integer(value: number) {
        this.ensure(9);
        if (value >= -2147483648 && value <= 2147483647) {
            this.u8[this.len++] = T_INT32;
            this.dv.setInt32(this.len, value, true);
            this.len += 4;
        } else {
            // beyond 2^53 a number is not an exact integer anymore, but it is still the value the caller gave
            this.u8[this.len++] = T_INT64;
            const hi = Math.floor(value / TWO32);
            this.dv.setUint32(this.len, value - hi * TWO32, true);
            this.dv.setInt32(this.len + 4, hi, true);
            this.len += 8;
        }
    }

    private double(value: number) {
        this.ensure(9);
        this.u8[this.len++] = T_DOUBLE;
        this.dv.setFloat64(this.len, value, true);
        this.len += 8;
    }

    private text(text: string) {
        const textLength = text.length;
        // ASCII fast path, no TextEncoder allocation for the usual identifiers and short values
        if (textLength <= 64) {
            this.ensure(5 + textLength);
            const start = this.len + 5;
            let ok = true;
            for (let index = 0; index < textLength; index++) {
                const code = text.charCodeAt(index);
                if (code > 127) {
                    ok = false;
                    break;
                }
                this.u8[start + index] = code;
            }
            if (ok) {
                this.u8[this.len] = T_TEXT;
                this.dv.setUint32(this.len + 1, textLength, true);
                this.len = start + textLength;
                return;
            }
        }
        const bytes = encodeUtf8(text);
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

    private object(param: any, index: number) {
        if (param instanceof Date) {
            this.text(param.toISOString());
        } else if (param instanceof ArrayBuffer) {
            this.blob(new Uint8Array(param));
        } else if (ArrayBuffer.isView(param)) {
            this.blob(new Uint8Array(param.buffer, param.byteOffset, param.byteLength));
        } else if (Array.isArray(param)) {
            // an array of byte values is a blob
            this.blob(Uint8Array.from(param));
        } else {
            throw new TypeError(`unsupported parameter ${Object.prototype.toString.call(param)} at index ${index}`);
        }
    }
}

const scratch = new Writer();
const scratchBatch = new Writer();

function finish(writer: Writer): ArrayBuffer {
    return writer.u8.slice(0, writer.len).buffer;
}

function writeParams(writer: Writer, params: SqliteParams | undefined) {
    if (params === undefined || params === null) {
        writer.u32(0);
        return;
    }
    if (!Array.isArray(params)) {
        writer.u32(1);
        writer.value(params, 0);
        return;
    }
    writer.u32(params.length);
    for (let index = 0; index < params.length; index++) {
        writer.value(params[index], index);
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

export function encodeBatch(statements: Array<{ sql: string; params?: SqliteParams }>): ArrayBuffer {
    const writer = scratchBatch;
    writer.reset();
    writer.u32(statements.length);
    for (const st of statements) {
        const sql = encodeUtf8(st.sql);
        writer.u32(sql.length);
        writer.bytes(sql);
        const lenAt = writer.len;
        writer.u32(0);
        const start = writer.len;
        writeParams(writer, st.params);
        writer.patchU32(lenAt, writer.len - start);
    }
    return finish(writer);
}

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

function int64At(dv: DataView, offset: number, mode: Int64Mode | undefined): number | bigint {
    const lo = dv.getUint32(offset, true);
    const hi = dv.getInt32(offset + 4, true);
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

    let offset = byteOffset + HEADER_SIZE;
    const columns: string[] = new Array(ncols);
    for (let column = 0; column < ncols; column++) {
        const nameLength = dv.getUint32(offset, true);
        offset += 4;
        columns[column] = decodeUtf8(u8, offset, offset + nameLength);
        offset += nameLength;
    }

    const objects = options.objects;
    const abBlobs = options.arrayBufferBlobs === true;
    const int64 = options.int64;
    const rows: any[] = new Array(nrows);
    for (let rowIndex = 0; rowIndex < nrows; rowIndex++) {
        const row: any = objects ? {} : new Array(ncols);
        for (let column = 0; column < ncols; column++) {
            let value: any;
            switch (u8[offset++]) {
                case T_NULL:
                    value = null;
                    break;
                case T_INT32:
                    value = dv.getInt32(offset, true);
                    offset += 4;
                    break;
                case T_INT64:
                    value = int64At(dv, offset, int64);
                    offset += 8;
                    break;
                case T_DOUBLE:
                    value = dv.getFloat64(offset, true);
                    offset += 8;
                    break;
                case T_TEXT_REF: {
                    const start = dv.getUint32(offset, true);
                    value = heap.substring(start, start + dv.getUint32(offset + 4, true));
                    offset += 8;
                    break;
                }
                case T_TEXT: {
                    const textLength = dv.getUint32(offset, true);
                    offset += 4;
                    value = textLength === 0 ? '' : decodeUtf8(u8, offset, offset + textLength);
                    offset += textLength;
                    break;
                }
                case T_BLOB: {
                    const blobLength = dv.getUint32(offset, true);
                    offset += 4;
                    value = abBlobs ? buf.slice(offset, offset + blobLength) : u8.slice(offset, offset + blobLength);
                    offset += blobLength;
                    break;
                }
                default:
                    throw new Error('malformed result: unknown value type');
            }
            if (objects) {
                row[columns[column]] = value;
            } else {
                row[column] = value;
            }
        }
        rows[rowIndex] = row;
    }
    if (offset > heapStart) {
        throw new Error('malformed result: rows run into the string heap');
    }
    return { columns, rows, changes, lastInsertRowId };
}

/** Decodes a batch result: the rows blocks of the statements that completed. */
export function decodeBatch(buf: ArrayBuffer, options: DecodeOptions): DecodedRows[] {
    const dv = new DataView(buf);
    const count = dv.getUint32(0, true);
    const out: DecodedRows[] = new Array(count);
    let offset = 4;
    for (let index = 0; index < count; index++) {
        const len = dv.getUint32(offset, true);
        offset += 4;
        out[index] = decodeRows(buf, options, offset, len);
        offset += len;
    }
    return out;
}

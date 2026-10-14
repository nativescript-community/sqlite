import { strict as assert } from 'assert';
import { describe, it } from 'node:test';
import { decodeBatch, decodeRows, encodeBatch, encodeParams, utf8DecodeJs, utf8EncodeJs } from '../codec';
import { SqliteParams } from '../sqlite.common';

function encodedParams(params: SqliteParams) {
    const encoded = encodeParams(params);
    assert.ok(encoded);
    return encoded;
}

const u32 = (value: number) => new Uint8Array(new Uint32Array([value]).buffer);

describe('encodeParams', () => {
    it('returns null without parameters', () => {
        assert.equal(encodeParams(undefined), null);
        assert.equal(encodeParams(null), null);
        assert.equal(encodeParams([]), null);
    });

    it('writes count and typed values', () => {
        const bytes = new Uint8Array(encodedParams([1, 'a', null, 1.5]));
        assert.deepEqual(Array.from(bytes.subarray(0, 4)), [4, 0, 0, 0]);
        assert.deepEqual(Array.from(bytes.subarray(4, 9)), [1, 1, 0, 0, 0]); // INT32 1
        assert.deepEqual(Array.from(bytes.subarray(9, 15)), [4, 1, 0, 0, 0, 97]); // TEXT "a"
        assert.equal(bytes[15], 0); // NULL
        assert.equal(bytes[16], 3); // DOUBLE
        assert.equal(bytes.length, 4 + 5 + 6 + 1 + 9);
    });

    it('uses 64 bit integers beyond 32 bits and keeps the sign', () => {
        const dv = new DataView(encodedParams([-3000000000, 2 ** 40]));
        assert.equal(dv.getUint8(4), 2);
        assert.equal(dv.getUint32(5, true) + dv.getInt32(9, true) * 4294967296, -3000000000);
        assert.equal(dv.getUint8(13), 2);
        assert.equal(dv.getUint32(14, true) + dv.getInt32(18, true) * 4294967296, 2 ** 40);
    });

    it('grows past its scratch buffer without corrupting the data', () => {
        const long = 'é'.repeat(3000);
        const buf = encodedParams([long, new Uint8Array(5000).fill(7)]);
        const dv = new DataView(buf);
        assert.equal(dv.getUint8(4), 4);
        assert.equal(dv.getUint32(5, true), 6000);
        const off = 4 + 5 + 6000;
        assert.equal(dv.getUint8(off), 5);
        assert.equal(dv.getUint32(off + 1, true), 5000);
        assert.equal(new Uint8Array(buf)[off + 5 + 4999], 7);
    });

    it('does not share memory between calls', () => {
        const encoded = encodedParams(['first']);
        const copy = new Uint8Array(encoded).slice();
        encodeParams(['second value that is different']);
        assert.deepEqual(new Uint8Array(encoded), copy);
    });
});

describe('encodeBatch', () => {
    it('writes each statement with its parameter block length', () => {
        const buf = encodeBatch([{ sql: 'A' }, { sql: 'BC', params: [1] }]);
        const dv = new DataView(buf);
        assert.equal(dv.getUint32(0, true), 2);
        assert.equal(dv.getUint32(4, true), 1); // sql length
        assert.equal(dv.getUint8(8), 65);
        assert.equal(dv.getUint32(9, true), 4); // params block: count only
        assert.equal(dv.getUint32(13, true), 0);
        assert.equal(dv.getUint32(17, true), 2);
        assert.equal(dv.getUint32(23, true), 9); // count + INT32
    });
});

describe('decodeRows', () => {
    const header = (ncols: number, nrows: number, heapOffset: number) => {
        const headerBytes = new Uint8Array(32);
        const dv = new DataView(headerBytes.buffer);
        dv.setUint32(0, 0x3152534e, true);
        dv.setUint32(4, ncols, true);
        dv.setUint32(8, nrows, true);
        dv.setUint32(28, heapOffset, true);
        return headerBytes;
    };
    const concat = (...parts: Uint8Array[]) => {
        const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
        let offset = 0;
        for (const part of parts) {
            out.set(part, offset);
            offset += part.length;
        }
        return out.buffer;
    };

    it('decodes a minimal block', () => {
        const buf = concat(header(1, 1, 32 + 5 + 5), u32(1), new Uint8Array([97]), new Uint8Array([1, 9, 0, 0, 0]));
        const result = decodeRows(buf, { objects: true });
        assert.deepEqual(result.rows, [{ a: 9 }]);
    });

    it('rejects malformed blocks', () => {
        assert.throws(() => decodeRows(new ArrayBuffer(10), { objects: false }), /malformed/);
        const bad = new Uint8Array(header(1, 1, 32));
        bad[0] = 0;
        assert.throws(() => decodeRows(bad.buffer, { objects: false }), /malformed/);
        assert.throws(() => decodeRows(concat(header(1, 1, 9999)), { objects: false }), /malformed/);
        // unknown value tag
        assert.throws(() => decodeRows(concat(header(1, 1, 32 + 5 + 1), u32(1), new Uint8Array([97]), new Uint8Array([42])), { objects: false }), /unknown value type/);
    });

    it('decodes a block located inside a bigger buffer', () => {
        const block = new Uint8Array(concat(header(1, 1, 32 + 5 + 5), u32(1), new Uint8Array([97]), new Uint8Array([1, 5, 0, 0, 0])));
        const prefix = new Uint8Array(7).fill(0xee);
        const buf = concat(prefix, block, prefix);
        assert.deepEqual(decodeRows(buf, { objects: false }, 7, block.length).rows, [[5]]);
    });

    it('decodes batch results', () => {
        const block = new Uint8Array(concat(header(1, 1, 32 + 5 + 5), u32(1), new Uint8Array([97]), new Uint8Array([1, 5, 0, 0, 0])));
        const buf = concat(u32(2), u32(block.length), block, u32(block.length), block);
        const results = decodeBatch(buf, { objects: true });
        assert.equal(results.length, 2);
        assert.deepEqual(results[1].rows, [{ a: 5 }]);
    });
});

describe('utf-8 without TextDecoder / TextEncoder', () => {
    const samples = ['', 'abc', 'héllo € 😀 ünï', '😀'.repeat(5000), 'a\u0000b', '߿ࠀ￿', 'x'.repeat(100000)];

    it('encodes like TextEncoder', () => {
        const native = new TextEncoder();
        for (const sample of samples.concat(['lone \ud800 high', 'lone \udc00 low', '\ud800', 'a\udbff'])) {
            assert.deepEqual(Array.from(utf8EncodeJs(sample)), Array.from(native.encode(sample)));
        }
    });

    it('decodes like TextDecoder', () => {
        const native = new TextDecoder();
        for (const sample of samples) {
            const bytes = new TextEncoder().encode(sample);
            assert.equal(utf8DecodeJs(bytes, 0, bytes.length), native.decode(bytes));
        }
        // invalid input (never produced by SQLite for text): both give U+FFFD, the number of replacements may differ
        for (const bad of [[0x80], [0xc3], [0xe2, 0x82], [0xf0, 0x9f, 0x98], [0xc0, 0x80], [0xed, 0xa0, 0x80], [0xf4, 0x90, 0x80, 0x80], [0xff, 0x41], [0xe2, 0x28, 0xa1]]) {
            const bytes = new Uint8Array(bad);
            const js = utf8DecodeJs(bytes, 0, bytes.length);
            assert.ok(js.includes('\ufffd'), bad.join(','));
            assert.ok(native.decode(bytes).includes('\ufffd'));
        }
    });

    it('decodes a range of a bigger buffer', () => {
        const bytes = new TextEncoder().encode('xxhéllo 😀yy');
        assert.equal(utf8DecodeJs(bytes, 2, bytes.length - 2), 'héllo 😀');
    });

    it('round trips rows through the codec without the globals', () => {
        const globals: any = globalThis;
        const saved = [globals.TextDecoder, globals.TextEncoder];
        // a fresh module instance that has not seen the globals yet
        globals.TextDecoder = undefined;
        globals.TextEncoder = undefined;
        try {
            for (const key of Object.keys(require.cache)) {
                if (/[\\/]codec\.js$/.test(key)) {
                    delete require.cache[key];
                }
            }
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const fresh = require('../codec');
            const params = fresh.encodeParams(['héllo 😀', 7]);
            assert.ok(params.byteLength > 0);
            const batch = fresh.encodeBatch([{ sql: 'SELECT ? AS é', params: ['😀'] }]);
            assert.ok(batch.byteLength > 0);
            assert.equal(Array.from(new Uint8Array(batch)).length, batch.byteLength);
        } finally {
            globals.TextDecoder = saved[0];
            globals.TextEncoder = saved[1];
        }
    });
});

describe('native utf-8 (Node-API module)', () => {
    // loaded lazily: this file also runs where no addon exists
    const { loadAddon } = require('./support');
    const sample = 'plain ascii, accents éàü, euro €, emoji 😀, cjk 漢字, nul \u0000 inside, end';

    it('decodes like the JS decoder, at any offset of a larger buffer', () => {
        const addon = loadAddon();
        const bytes = utf8EncodeJs(sample.repeat(50));
        const host = new Uint8Array(bytes.length + 20);
        host.set(bytes, 13);
        assert.equal(addon.decodeUtf8(host.buffer, 13, 13 + bytes.length), sample.repeat(50));
        assert.equal(addon.decodeUtf8(host.buffer, 13, 13 + 5), 'plain');
    });

    it('encodes like the JS encoder', () => {
        const addon = loadAddon();
        const text = sample.repeat(50) + '\ud800 lone surrogate';
        assert.deepEqual(Array.from(new Uint8Array(addon.encodeUtf8(text))), Array.from(utf8EncodeJs(text)));
    });

    it('rejects a range outside the buffer and a non ArrayBuffer', () => {
        const addon = loadAddon();
        assert.throws(() => addon.decodeUtf8(new ArrayBuffer(4), 0, 9));
        assert.throws(() => addon.decodeUtf8(new Uint8Array(4), 0, 4));
        assert.throws(() => addon.encodeUtf8(5));
    });

    it('does not throw on invalid sequences', () => {
        const addon = loadAddon();
        const bad = new Uint8Array([0x61, 0xff, 0xc3, 0x28, 0xe2, 0x82, 0x62]);
        const out = addon.decodeUtf8(bad.buffer, 0, bad.length);
        assert.ok(out.startsWith('a') && out.includes('�') && out.endsWith('b'));
    });
});

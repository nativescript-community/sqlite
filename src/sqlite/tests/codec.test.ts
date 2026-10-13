import { strict as assert } from 'assert';
import { describe, it } from 'node:test';
import { decodeBatch, decodeRows, encodeBatch, encodeParams } from '../codec';

const u32 = (v: number) => new Uint8Array(new Uint32Array([v]).buffer);

describe('encodeParams', () => {
    it('returns null without parameters', () => {
        assert.equal(encodeParams(undefined), null);
        assert.equal(encodeParams(null), null);
        assert.equal(encodeParams([]), null);
    });

    it('writes count and typed values', () => {
        const b = new Uint8Array(encodeParams([1, 'a', null, 1.5])!);
        assert.deepEqual(Array.from(b.subarray(0, 4)), [4, 0, 0, 0]);
        assert.deepEqual(Array.from(b.subarray(4, 9)), [1, 1, 0, 0, 0]); // INT32 1
        assert.deepEqual(Array.from(b.subarray(9, 15)), [4, 1, 0, 0, 0, 97]); // TEXT "a"
        assert.equal(b[15], 0); // NULL
        assert.equal(b[16], 3); // DOUBLE
        assert.equal(b.length, 4 + 5 + 6 + 1 + 9);
    });

    it('uses 64 bit integers beyond 32 bits and keeps the sign', () => {
        const dv = new DataView(encodeParams([-3000000000, 2 ** 40])!);
        assert.equal(dv.getUint8(4), 2);
        assert.equal(dv.getUint32(5, true) + dv.getInt32(9, true) * 4294967296, -3000000000);
        assert.equal(dv.getUint8(13), 2);
        assert.equal(dv.getUint32(14, true) + dv.getInt32(18, true) * 4294967296, 2 ** 40);
    });

    it('grows past its scratch buffer without corrupting the data', () => {
        const long = 'é'.repeat(3000);
        const buf = encodeParams([long, new Uint8Array(5000).fill(7)])!;
        const dv = new DataView(buf);
        assert.equal(dv.getUint8(4), 4);
        assert.equal(dv.getUint32(5, true), 6000);
        const off = 4 + 5 + 6000;
        assert.equal(dv.getUint8(off), 5);
        assert.equal(dv.getUint32(off + 1, true), 5000);
        assert.equal(new Uint8Array(buf)[off + 5 + 4999], 7);
    });

    it('does not share memory between calls', () => {
        const a = encodeParams(['first'])!;
        const copy = new Uint8Array(a).slice();
        encodeParams(['second value that is different']);
        assert.deepEqual(new Uint8Array(a), copy);
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
        const h = new Uint8Array(32);
        const dv = new DataView(h.buffer);
        dv.setUint32(0, 0x3152534e, true);
        dv.setUint32(4, ncols, true);
        dv.setUint32(8, nrows, true);
        dv.setUint32(28, heapOffset, true);
        return h;
    };
    const concat = (...parts: Uint8Array[]) => {
        const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
        let o = 0;
        for (const p of parts) {
            out.set(p, o);
            o += p.length;
        }
        return out.buffer;
    };

    it('decodes a minimal block', () => {
        const buf = concat(header(1, 1, 32 + 5 + 5), u32(1), new Uint8Array([97]), new Uint8Array([1, 9, 0, 0, 0]));
        const r = decodeRows(buf, { objects: true });
        assert.deepEqual(r.rows, [{ a: 9 }]);
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
        const r = decodeBatch(buf, { objects: true });
        assert.equal(r.length, 2);
        assert.deepEqual(r[1].rows, [{ a: 5 }]);
    });
});

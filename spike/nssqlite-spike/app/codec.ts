/* Minimal TypeScript codec for the wire format (core/nssqlite_wire.h). The plugin's real codec replaces it. */
export class Enc {
  parts: number[] = []
  private dv = new DataView(new ArrayBuffer(8))
  u8(v: number) { this.parts.push(v) }
  u32(v: number) { this.dv.setUint32(0, v, true); for (let i = 0; i < 4; i++) this.parts.push(this.dv.getUint8(i)) }
  bytes(b: ArrayLike<number>) { for (let i = 0; i < b.length; i++) this.parts.push(b[i]) }
  int(v: number) { this.u8(1); this.dv.setInt32(0, v, true); for (let i = 0; i < 4; i++) this.parts.push(this.dv.getUint8(i)) }
  double(v: number) { this.u8(3); this.dv.setFloat64(0, v, true); for (let i = 0; i < 8; i++) this.parts.push(this.dv.getUint8(i)) }
  text(s: string) { const b = new TextEncoder().encode(s); this.u8(4); this.u32(b.length); this.bytes(b) }
  blob(b: Uint8Array) { this.u8(5); this.u32(b.length); this.bytes(b) }
  null() { this.u8(0) }
  buffer(): ArrayBuffer { return new Uint8Array(this.parts).buffer }
}

export function params(fn: (e: Enc) => void, count: number): ArrayBuffer {
  const e = new Enc(); e.u32(count); fn(e); return e.buffer()
}

/* NativeScript 8 runtimes ship a TextDecoder that ignores the byteOffset of a view: decode copies (slice), not subarrays. */
export function decodeRows(buf: ArrayBuffer): { columns: string[]; rows: any[][]; changes: number; rowId: number } {
  const dv = new DataView(buf); const u8 = new Uint8Array(buf); let o = 0
  const u32 = () => { const v = dv.getUint32(o, true); o += 4; return v }
  if (u32() !== 0x3152534e) throw new Error('bad rows magic')
  const ncols = u32(); const nrows = u32()
  const changes = Number(dv.getBigInt64(o, true)); o += 8
  const rowId = Number(dv.getBigInt64(o, true)); o += 8
  const dec = new TextDecoder(); const columns: string[] = []
  for (let i = 0; i < ncols; i++) { const n = u32(); columns.push(dec.decode(u8.slice(o, o + n))); o += n }
  const rows: any[][] = []
  for (let r = 0; r < nrows; r++) {
    const row: any[] = []
    for (let c = 0; c < ncols; c++) {
      const t = u8[o++]
      switch (t) {
        case 0: row.push(null); break
        case 1: row.push(dv.getInt32(o, true)); o += 4; break
        case 2: row.push(dv.getBigInt64(o, true)); o += 8; break
        case 3: row.push(dv.getFloat64(o, true)); o += 8; break
        case 4: { const n = u32(); row.push(dec.decode(u8.slice(o, o + n))); o += n; break }
        case 5: { const n = u32(); row.push(u8.slice(o, o + n)); o += n; break }
        default: throw new Error('bad tag ' + t)
      }
    }
    rows.push(row)
  }
  return { columns, rows, changes, rowId }
}


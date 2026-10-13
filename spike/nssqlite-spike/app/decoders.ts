/* Candidate decoders for the rows block (core/nssqlite_wire.h), used by the benchmark. */
export type Rows = { columns: string[]; rows: any[] }

const td = new TextDecoder()

/* Tunables measured by the benchmark. */
export const textConfig = { asciiMax: 24, subarray: false }

/* NativeScript 8 TextDecoder ignores the byteOffset of a view: detect it once instead of always copying. */
export function detectSubarrayDecoding(): boolean {
  try {
    return td.decode(new Uint8Array([65, 66, 67, 68]).subarray(2)) === 'CD'
  } catch (e) {
    return false
  }
}

function readText(u8: Uint8Array, o: number, n: number): string {
  if (n <= textConfig.asciiMax) {
    // ASCII fast path: most identifiers / short strings never need the TextDecoder
    let ascii = true
    for (let i = 0; i < n; i++) {
      if (u8[o + i] > 127) {
        ascii = false
        break
      }
    }
    if (ascii) {
      if (n === 0) return ''
      if (n <= 8) {
        let s = ''
        for (let i = 0; i < n; i++) s += String.fromCharCode(u8[o + i])
        return s
      }
      return String.fromCharCode.apply(null, u8.subarray(o, o + n) as any)
    }
  }
  return td.decode(textConfig.subarray ? u8.subarray(o, o + n) : u8.slice(o, o + n))
}

interface Header { ncols: number; nrows: number; names: string[]; o: number; dv: DataView; u8: Uint8Array; changes: number; rowId: number; heap: string }

function header(buf: ArrayBuffer, offset = 0, length = buf.byteLength - offset): Header {
  const dv = new DataView(buf)
  const u8 = new Uint8Array(buf)
  let o = offset
  const magic = dv.getUint32(o, true)
  if (magic !== 0x3152534e && magic !== 0x3252534e) throw new Error('bad rows magic')
  const ncols = dv.getUint32(o + 4, true)
  const nrows = dv.getUint32(o + 8, true)
  const changes = dv.getUint32(o + 12, true) + dv.getInt32(o + 16, true) * 4294967296
  const rowId = dv.getUint32(o + 20, true) + dv.getInt32(o + 24, true) * 4294967296
  o += 28
  let heap = ''
  if (magic === 0x3252534e) {
    const heapOff = offset + dv.getUint32(o, true)
    o += 4
    // all-ASCII heap: decoded once, cells are substrings of it
    const end = offset + length
    heap = end > heapOff ? td.decode(textConfig.subarray ? u8.subarray(heapOff, end) : u8.slice(heapOff, end)) : ''
  }
  const names: string[] = []
  for (let c = 0; c < ncols; c++) {
    const n = dv.getUint32(o, true)
    o += 4
    names.push(readText(u8, o, n))
    o += n
  }
  return { ncols, nrows, names, o, dv, u8, changes, rowId, heap }
}

/* The cell reader is inlined by hand in both decoders: a shared helper returning (value, newOffset) would allocate. */
export function decodeArrays(buf: ArrayBuffer, offset = 0, length = buf.byteLength - offset): Rows {
  const h = header(buf, offset, length)
  const { ncols, nrows, dv, u8, heap } = h
  let o = h.o
  const rows: any[] = new Array(nrows)
  for (let r = 0; r < nrows; r++) {
    const row: any[] = new Array(ncols)
    for (let c = 0; c < ncols; c++) {
      switch (u8[o++]) {
        case 0: row[c] = null; break
        case 1: row[c] = dv.getInt32(o, true); o += 4; break
        case 2: row[c] = dv.getUint32(o, true) + dv.getInt32(o + 4, true) * 4294967296; o += 8; break
        case 3: row[c] = dv.getFloat64(o, true); o += 8; break
        case 4: { const n = dv.getUint32(o, true); o += 4; row[c] = readText(u8, o, n); o += n; break }
        case 6: { const s = dv.getUint32(o, true); row[c] = heap.substring(s, s + dv.getUint32(o + 4, true)); o += 8; break }
        default: { const n = dv.getUint32(o, true); o += 4; row[c] = u8.slice(o, o + n); o += n; break }
      }
    }
    rows[r] = row
  }
  return { columns: h.names, rows }
}

export function decodeObjects(buf: ArrayBuffer, offset = 0, length = buf.byteLength - offset): Rows {
  const h = header(buf, offset, length)
  const { ncols, nrows, dv, u8, names, heap } = h
  let o = h.o
  const rows: any[] = new Array(nrows)
  for (let r = 0; r < nrows; r++) {
    const row: any = {}
    for (let c = 0; c < ncols; c++) {
      let v: any
      switch (u8[o++]) {
        case 0: v = null; break
        case 1: v = dv.getInt32(o, true); o += 4; break
        case 2: v = dv.getUint32(o, true) + dv.getInt32(o + 4, true) * 4294967296; o += 8; break
        case 3: v = dv.getFloat64(o, true); o += 8; break
        case 4: { const n = dv.getUint32(o, true); o += 4; v = readText(u8, o, n); o += n; break }
        case 6: { const s = dv.getUint32(o, true); v = heap.substring(s, s + dv.getUint32(o + 4, true)); o += 8; break }
        default: { const n = dv.getUint32(o, true); o += 4; v = u8.slice(o, o + n); o += n; break }
      }
      row[names[c]] = v
    }
    rows[r] = row
  }
  return { columns: names, rows }
}

/* Same as decodeArrays but strings always go through the TextDecoder (what a naive port does). */
export function decodeArraysNaive(buf: ArrayBuffer): Rows {
  const h = header(buf)
  const { ncols, nrows, dv, u8 } = h
  let o = h.o
  const rows: any[] = []
  for (let r = 0; r < nrows; r++) {
    const row: any[] = []
    for (let c = 0; c < ncols; c++) {
      const t = u8[o++]
      if (t === 0) row.push(null)
      else if (t === 1) { row.push(dv.getInt32(o, true)); o += 4 }
      else if (t === 2) { row.push(Number(dv.getBigInt64(o, true))); o += 8 }
      else if (t === 3) { row.push(dv.getFloat64(o, true)); o += 8 }
      else { const n = dv.getUint32(o, true); o += 4; row.push(t === 4 ? td.decode(u8.slice(o, o + n)) : u8.slice(o, o + n)); o += n }
    }
    rows.push(row)
  }
  return { columns: h.names, rows }
}

export function decodeJsonArrays(buf: ArrayBuffer): Rows {
  const j = JSON.parse(td.decode(new Uint8Array(buf)))
  return { columns: j.c, rows: j.r }
}

export function decodeJsonObjects(buf: ArrayBuffer): Rows {
  const j = JSON.parse(td.decode(new Uint8Array(buf)))
  const names: string[] = j.c
  const src: any[][] = j.r
  const rows: any[] = new Array(src.length)
  for (let r = 0; r < src.length; r++) {
    const a = src[r]
    const o: any = {}
    for (let c = 0; c < names.length; c++) o[names[c]] = a[c]
    rows[r] = o
  }
  return { columns: names, rows }
}

/* Order independent digest to check that all decoders agree. */
export function digest(rows: any[], arrays: boolean): string {
  let sum = 0
  let chars = 0
  let blobs = 0
  let nulls = 0
  for (const row of rows) {
    const vals = arrays ? row : Object.keys(row).map((k) => row[k])
    for (const v of vals) {
      if (v === null) nulls++
      else if (typeof v === 'number') sum += v
      else if (typeof v === 'string') chars += v.length
      else if (v && v.byteLength !== undefined) blobs += v.byteLength
    }
  }
  return `${rows.length}/${sum.toFixed(2)}/${chars}/${blobs}/${nulls}`
}

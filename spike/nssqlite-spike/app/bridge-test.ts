/* Exercises the JNI / ObjC bridge binding (the path used by runtimes without Node-API).
 * Minimal inline codec: the real one lives in the plugin's TypeScript. */
declare const __ANDROID__: boolean
declare const com: any
declare const java: any
declare const NSSqliteBridge: any
declare const NSData: any
declare const interop: any

const log = (...a: any[]) => console.log('[BRIDGE]', ...a)

class Enc {
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

function params(fn: (e: Enc) => void, count: number): ArrayBuffer {
  const e = new Enc(); e.u32(count); fn(e); return e.buffer()
}

function decodeRows(buf: ArrayBuffer): { columns: string[]; rows: any[][]; changes: number; rowId: number } {
  const dv = new DataView(buf); const u8 = new Uint8Array(buf); let o = 0
  const u32 = () => { const v = dv.getUint32(o, true); o += 4; return v }
  if (u32() !== 0x3152534e) throw new Error('bad rows magic')
  const ncols = u32(); const nrows = u32()
  const changes = Number(dv.getBigInt64(o, true)); o += 8
  const rowId = Number(dv.getBigInt64(o, true)); o += 8
  const dec = new TextDecoder(); const columns: string[] = []
  for (let i = 0; i < ncols; i++) { const n = u32(); columns.push(dec.decode(u8.subarray(o, o + n))); o += n }
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
        case 4: { const n = u32(); row.push(dec.decode(u8.subarray(o, o + n))); o += n; break }
        case 5: { const n = u32(); row.push(u8.slice(o, o + n)); o += n; break }
        default: throw new Error('bad tag ' + t)
      }
    }
    rows.push(row)
  }
  return { columns, rows, changes, rowId }
}

interface Res { status: number; done: boolean; data: ArrayBuffer | null; message: string | null; changes: number; rowId: number; release(): void }

/* platform adapter: one function per core call, results come back through cb(Res) on this thread */
function adapter() {
  if (__ANDROID__) {
    const N = com.akylas.sqlite.NativeSqlite
    const cbOf: any = (cb: (r: Res) => void) => new N.Callback({
      onResult(r: any) {
        const bb = r.getData()
        const data: any = bb ? (ArrayBuffer as any).from(bb) : null
        cb({ status: r.getStatus(), done: r.isDone(), data, message: r.getMessage(), changes: Number(r.getChanges()), rowId: Number(r.getLastInsertRowId()), release: () => r.release() })
      }
    })
    return {
      engine: (lib: string | null) => N.engine(lib),
      version: (e: any) => N.engineVersion(e),
      open: (e: any, path: string, cb: (r: Res) => void) => N.open(e, path, 0, 0, false, null, cbOf(cb)),
      exec: (db: any, tx: number, sql: string, p: ArrayBuffer | null, chunk: number, cb: (r: Res) => void) => N.exec(db, tx, sql, p, 0, chunk, cbOf(cb)),
      close: (db: any, cb: (r: Res) => void) => N.close(db, cbOf(cb)),
      release: (db: any) => N.release(db)
    }
  }
  const B = NSSqliteBridge
  const cbOf = (cb: (r: Res) => void) => (status: number, done: boolean, data: any, message: string | null, changes: number, rowId: number) => {
    const buf = data ? interop.bufferFromData(data) : null
    cb({ status, done, data: buf, message, changes: Number(changes), rowId: Number(rowId), release() {} })
  }
  return {
    engine: (lib: string | null) => B.engineError(lib, null),
    version: (e: any) => B.engineVersion(e),
    open: (e: any, path: string, cb: (r: Res) => void) => B.openPathFlagsBusyMsWalInitSqlCallback(e, path, 0, 0, false, null, cbOf(cb)),
    exec: (db: any, tx: number, sql: string, p: ArrayBuffer | null, chunk: number, cb: (r: Res) => void) => B.execTxSqlParamsFlagsChunkRowsCallback(db, tx, sql, p ? NSData.dataWithData(p as any) : null, 0, chunk, cbOf(cb)),
    close: (db: any, cb: (r: Res) => void) => B.closeCallback(db, cbOf(cb)),
    release: (db: any) => B.releaseDb(db)
  }
}

export function runBridgeTests() {
  try {
    const a = adapter()
    const engine = a.engine(__ANDROID__ ? 'libsqliteJni.so' : null)
    log('engine version', a.version(engine))
    const mainTid = __ANDROID__ ? java.lang.Thread.currentThread().getId() : 0
    const db = a.open(engine, ':memory:', (r) => log('open cb', r.status, r.message))
    const steps: Array<[string, ArrayBuffer | null, number]> = [
      ['CREATE TABLE t(i INTEGER, r REAL, s TEXT, b BLOB, n)', null, 0],
      ['INSERT INTO t VALUES (?,?,?,?,?)', params((e) => { e.int(123456); e.double(2.5); e.text('héllo €'); e.blob(new Uint8Array([0, 7, 255])); e.null() }, 5), 0],
      ['SELECT i, r, s, b, n FROM t', null, 0],
      ['SELECT * FROM nope', null, 0]
    ]
    let remaining = steps.length
    steps.forEach(([sql, p, chunk]) => {
      a.exec(db, 0, sql, p, chunk, (r) => {
        if (!r.done) return
        if (r.status !== 0) { log(sql, '-> status', r.status, r.message) } else {
          const rows = r.data ? decodeRows(r.data) : null
          log(sql, '-> ok', rows ? JSON.stringify({ c: rows.columns, r: rows.rows.map((x) => x.map((v) => (v instanceof Uint8Array ? 'blob[' + Array.from(v).join(',') + ']' : String(v)))), ch: rows.changes }) : 'no data')
        }
        r.release()
        if (--remaining === 0) a.close(db, (c) => { log('close', c.status); a.release(db); log('callback thread same as call thread', __ANDROID__ ? java.lang.Thread.currentThread().getId() === mainTid : 'n/a') })
      })
    })
  } catch (e) {
    const x: any = e
    log('ERROR', String(x), x && x.message, x && x.nativeException ? String(x.nativeException) : '', x && x.stack ? String(x.stack).split('\n').slice(0, 4).join(' | ') : '')
  }
}

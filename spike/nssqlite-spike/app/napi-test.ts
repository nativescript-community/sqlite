/* Exercises the Node-API binding used directly from JS (NativeScript >= 9.1 runtimes). */
import { Enc, decodeRows, params } from './codec'

declare const __ANDROID__: boolean
declare const __non_webpack_require__: any
declare const java: any

const log = (...a: any[]) => console.log('[NAPI]', ...a)

export function loadAddon(): any {
  // The module registers itself process-wide when its library loads. Bare require works once that happened
  // (iOS: at startup; Android: after the first load, also from Workers, where requiring the path again
  // fails because the constructor does not run twice). Otherwise load the library by path.
  try {
    return __non_webpack_require__('nssqlite')
  } catch (e) {
    if (!__ANDROID__) throw e
    return __non_webpack_require__('system_lib://libnssqlite_napi.so')
  }
}

interface Res { status: number; done: boolean; data: ArrayBuffer | null; message: string | null; changes: number; rowId: number }

const DECODE_OBJECTS = 1
const DECODE_BIGINT = 2

export function makeApi(addon: any) {
  const run = (call: (cb: any) => number): Promise<Res[]> =>
    new Promise((resolve, reject) => {
      const results: Res[] = []
      const rc = call((status: number, done: boolean, data: ArrayBuffer | null, message: string | null, changes: number, rowId: number) => {
        results.push({ status, done, data, message, changes, rowId })
        if (done) resolve(results)
      })
      if (rc) reject(new Error('submit failed ' + rc))
    })
  return {
    engine: (lib: string | null) => addon.engine(lib),
    open: (engine: any, path: string, opts: { flags?: number; busyMs?: number; wal?: boolean; initSql?: string | null } = {}) =>
      new Promise<any>((resolve, reject) => {
        const db = addon.open(engine, path, opts.flags || 0, opts.busyMs || 0, !!opts.wal, opts.initSql || null, (status: number, _d: boolean, _b: any, message: string) =>
          status ? reject(new Error('open failed ' + status + ' ' + message)) : resolve(db)
        )
      }),
    exec: (db: any, sql: string, p: ArrayBuffer | null = null, tx = 0, chunk = 0) => run((cb) => addon.exec(db, tx, sql, p, 0, chunk, cb)),
    batch: (db: any, req: ArrayBuffer, atomic: boolean, tx = 0) => run((cb) => addon.batch(db, tx, req, atomic ? 1 : 0, cb)),
    txBegin: (db: any, mode = 1) => {
      let id = 0
      // txBegin returns the transaction id (0 = refused), unlike the other submit calls
      const done = run((cb) => {
        id = addon.txBegin(db, mode, cb)
        return id ? 0 : 1
      })
      return { id: () => id, done }
    },
    txEnd: (db: any, tx: number, commit: boolean) => run((cb) => addon.txEnd(db, tx, commit, cb)),
    close: (db: any) => run((cb) => addon.close(db, cb))
  }
}

function must(r: Res[], what: string): Res {
  const last = r[r.length - 1]
  if (last.status) throw new Error(what + ' failed: ' + last.status + ' ' + last.message)
  return last
}

export async function runNapiTests() {
  try {
    const addon = loadAddon()
    log('exports', Object.keys(addon).join(','), 'apiVersion', addon.apiVersion)
    const api = makeApi(addon)
    const engine = api.engine(__ANDROID__ ? 'libsqliteJni.so' : null)
    log('engine', addon.engineVersion(engine), 'loadExt', addon.engineCanLoadExtensions(engine))
    const db = await api.open(engine, ':memory:')
    must(await api.exec(db, 'CREATE TABLE t(i INTEGER, r REAL, s TEXT, b BLOB, n)'), 'create')
    const ins = await api.exec(db, 'INSERT INTO t VALUES (?,?,?,?,?)', params((e) => { e.int(123456); e.double(2.5); e.text('héllo €'); e.blob(new Uint8Array([0, 7, 255])); e.null() }, 5))
    log('insert changes', must(ins, 'insert').changes, 'rowid', ins[0].rowId)
    const sel = must(await api.exec(db, 'SELECT i, r, s, b, n, 9007199254740993 AS big FROM t'), 'select')
    log('data is ArrayBuffer', sel.data instanceof ArrayBuffer, 'len', sel.data!.byteLength)
    const ts = decodeRows(sel.data!)
    log('TS decode', JSON.stringify(ts.rows.map((r) => r.map((v) => (v instanceof Uint8Array ? Array.from(v) : String(v))))))
    const nat = addon.decodeRows(sel.data, 0, sel.data!.byteLength, DECODE_OBJECTS)
    log('native decode (objects)', JSON.stringify(nat.columns), JSON.stringify(nat.rows[0], (_k, v) => (v instanceof Uint8Array ? Array.from(v) : v)))
    const natBig = addon.decodeRows(sel.data, 0, sel.data!.byteLength, DECODE_BIGINT)
    log('native decode (bigint)', String(natBig.rows[0][5]), typeof natBig.rows[0][5])
    const bad = await api.exec(db, 'SELECT * FROM nope')
    log('error', bad[0].status, bad[0].message)

    // threading evidence: the call returns before the work is done and the callback comes on the JS thread
    const tid = __ANDROID__ ? java.lang.Thread.currentThread().getId() : 0
    let cbTid = -1
    await new Promise<void>((resolve) => {
      addon.exec(db, 0, 'SELECT 1', null, 0, 0, () => { cbTid = __ANDROID__ ? java.lang.Thread.currentThread().getId() : 0; resolve() })
    })
    log('callback on the calling thread', tid === cbTid)

    // batch: many inserts in one native hop
    must(await api.exec(db, 'CREATE TABLE big(a INTEGER, b TEXT, c REAL)'), 'create big')
    const N = 20000
    const e = new Enc()
    e.u32(N)
    for (let i = 0; i < N; i++) {
      const sql = new TextEncoder().encode('INSERT INTO big VALUES (?,?,?)')
      e.u32(sql.length); e.bytes(sql)
      const p = new Enc(); p.u32(3); p.int(i); p.text('row number ' + i); p.double(i * 0.5)
      const pb = new Uint8Array(p.parts)
      e.u32(pb.length); e.bytes(pb)
    }
    const req = e.buffer()
    let t0 = Date.now()
    const br = must(await api.batch(db, req, true), 'batch')
    log('batch insert', N, 'rows in', Date.now() - t0, 'ms (includes JS encoding? no: encode excluded) result bytes', br.data!.byteLength)

    t0 = Date.now()
    const all = must(await api.exec(db, 'SELECT * FROM big'), 'select all')
    const tNative = Date.now() - t0
    t0 = Date.now()
    const dTs = decodeRows(all.data!)
    const tTs = Date.now() - t0
    t0 = Date.now()
    const dNat = addon.decodeRows(all.data, 0, all.data!.byteLength, 0)
    const tNat = Date.now() - t0
    t0 = Date.now()
    const dNatObj = addon.decodeRows(all.data, 0, all.data!.byteLength, DECODE_OBJECTS)
    const tNatObj = Date.now() - t0
    log('select', N, 'rows: native query', tNative, 'ms | TS decode (arrays)', tTs, 'ms | native decode arrays', tNat, 'ms, objects', tNatObj, 'ms |', dTs.rows.length, dNat.rows.length, dNatObj.rows.length, all.data!.byteLength, 'bytes')

    // streaming
    const chunks = await api.exec(db, 'SELECT a FROM big ORDER BY a LIMIT 25', null, 0, 10)
    log('chunks', chunks.length, chunks.map((c) => (c.data ? addon.decodeRows(c.data, 0, c.data.byteLength, 0).rows.length : 0)).join('+'))

    // transactions
    const tx = api.txBegin(db)
    await tx.done
    await api.exec(db, 'INSERT INTO big VALUES (-1, ?, 0)', params((p) => p.text('in tx'), 1), tx.id())
    const queued = api.exec(db, 'SELECT COUNT(*) FROM big WHERE a = -1') // no tx: waits for the end
    await api.txEnd(db, tx.id(), false)
    log('after rollback, count of -1 rows =', addon.decodeRows((await queued)[0].data, 0, (await queued)[0].data!.byteLength, 0).rows[0][0])

    must(await api.close(db), 'close')
    log('done')
  } catch (e) {
    const x: any = e
    log('ERROR', String(x), x && x.stack ? String(x.stack).split('\n').slice(0, 5).join(' | ') : '')
  }
}

export function runWorkerTest() {
  try {
    const worker = new Worker('./worker-test')
    worker.onmessage = (m: any) => {
      log('worker result', JSON.stringify(m.data))
      worker.terminate()
    }
    worker.onerror = (e: any) => log('worker error', String(e && (e.message || e)))
    worker.postMessage('go')
    // keep using the main thread env at the same time
    runNapiTests()
  } catch (e) {
    log('worker setup ERROR', String(e))
  }
}

/* Runs the Node-API binding inside a Worker: the worker has its own napi env and its own dispatcher. */
import { loadAddon, makeApi } from './napi-test'
import { params } from './codec'

declare const __ANDROID__: boolean
const ctx: Worker = self as any

ctx.onmessage = async () => {
  try {
    const addon = loadAddon()
    const api = makeApi(addon)
    const engine = api.engine(__ANDROID__ ? 'libsqliteJni.so' : null)
    const db = await api.open(engine, ':memory:')
    await api.exec(db, 'CREATE TABLE w(a INTEGER, b TEXT)')
    let total = 0
    for (let i = 0; i < 200; i++) {
      const r = await api.exec(db, 'INSERT INTO w VALUES (?,?)', params((e) => { e.int(i); e.text('worker ' + i) }, 2))
      total += r[r.length - 1].changes
    }
    const sel = await api.exec(db, 'SELECT COUNT(*), SUM(a) FROM w')
    const rows = addon.decodeRows(sel[0].data, 0, sel[0].data!.byteLength, 0).rows
    await api.close(db)
    ctx.postMessage({ ok: true, inserted: total, count: rows[0][0], sum: rows[0][1] })
  } catch (e) {
    ctx.postMessage({ ok: false, error: String(e) })
  }
}

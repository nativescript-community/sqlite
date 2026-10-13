/* Decode benchmark: which way of turning a native result into JS rows is fastest on a runtime?
 * Query phase (native work + delivery) and decode phase (JS side) are measured separately, then summed. */
import { loadAddon } from './napi-test'
import { decodeArrays, decodeArraysNaive, decodeJsonArrays, decodeJsonObjects, decodeObjects, detectSubarrayDecoding, digest, textConfig } from './decoders'
import { params } from './codec'

declare const __ANDROID__: boolean

const log = (...a: any[]) => console.log('[BENCH]', ...a)
const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now())

const EXEC_JSON = 2
const EXEC_STRHEAP = 4
const DECODE_OBJECTS = 1

const RUNS = 15
const WARMUP = 4

function median(xs: number[]): number {
  const s = xs.slice().sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

function timeIt(fn: () => any, runs = RUNS, warmup = WARMUP): number {
  for (let i = 0; i < warmup; i++) fn()
  const t: number[] = []
  for (let i = 0; i < runs; i++) {
    const t0 = now()
    fn()
    t.push(now() - t0)
  }
  return median(t)
}

interface Dataset { name: string; setup: string[]; query: string; blobs?: boolean }

const CTE = (n: number) => `WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c WHERE x < ${n})`
const DATASETS: Dataset[] = [
  {
    name: 'narrow 20000x3 (int, short text, real)',
    setup: [`CREATE TABLE narrow(id INTEGER, name TEXT, score REAL)`, `${CTE(20000)} INSERT INTO narrow SELECT x, 'name_' || x, x * 0.25 FROM c`],
    query: 'SELECT id, name, score FROM narrow'
  },
  {
    name: 'wide 5000x12 (ints, reals, text 24-40, nulls)',
    setup: [
      `CREATE TABLE wide(i1, i2, i3, i4, r1, r2, r3, t1, t2, t3, n1, n2)`,
      `${CTE(5000)} INSERT INTO wide SELECT x, x * 3, x % 7, x * 1000003, x / 3.0, x * 1.5, -x * 0.125, printf('%024d', x), 'description of item ' || x || ' in the catalog', 'x' || (x % 100) || '/' || abs(random() % 1000000), CASE WHEN x % 2 THEN NULL ELSE x END, NULL FROM c`
    ],
    query: 'SELECT * FROM wide'
  },
  {
    name: 'text 5000x3 (200 chars, 10% non-ASCII)',
    setup: [
      `CREATE TABLE txt(a TEXT, b TEXT, c TEXT)`,
      `${CTE(5000)} INSERT INTO txt SELECT printf('%0200d', x), CASE WHEN x % 10 = 0 THEN substr(printf('%0200d', x), 1, 150) || 'é€😀 ünïcode ' || x ELSE printf('%0200d', x * 2) END, printf('%0100d', x) || printf('%0100d', x) FROM c`
    ],
    query: 'SELECT a, b, c FROM txt'
  },
  {
    name: 'blobs 1000x2 (2 KB blob)',
    setup: [`CREATE TABLE bl(id INTEGER, data BLOB)`, `${CTE(1000)} INSERT INTO bl SELECT x, randomblob(2048) FROM c`],
    query: 'SELECT id, data FROM bl',
    blobs: true
  },
  {
    name: 'tiny 100x2',
    setup: [`CREATE TABLE tiny(id INTEGER, label TEXT)`, `${CTE(100)} INSERT INTO tiny SELECT x, 'row ' || x FROM c`],
    query: 'SELECT id, label FROM tiny'
  }
]

type Res = { status: number; data: ArrayBuffer | null; message: string | null }

export async function runBench() {
  try {
    const addon = loadAddon()
    const engine = addon.engine(__ANDROID__ ? 'libsqliteJni.so' : null)
    log('platform', __ANDROID__ ? 'android' : 'ios', 'sqlite', addon.engineVersion(engine), 'runs', RUNS, 'timer', typeof performance !== 'undefined' ? 'performance.now' : 'Date.now')
    const db = await new Promise<any>((resolve, reject) => {
      const d = addon.open(engine, ':memory:', 0, 0, false, null, (status: number, _x: boolean, _b: any, msg: string) => (status ? reject(new Error(msg)) : resolve(d)))
    })
    const exec = (sql: string, flags = 0, p: ArrayBuffer | null = null): Promise<Res> =>
      new Promise((resolve, reject) => {
        const rc = addon.exec(db, 0, sql, p, flags, 0, (status: number, done: boolean, data: ArrayBuffer | null, message: string | null) => {
          if (!done) return
          status ? reject(new Error(sql + ': ' + message)) : resolve({ status, data, message })
        })
        if (rc) reject(new Error('submit ' + rc))
      })

    const subarrayOk = detectSubarrayDecoding()
    log('TextDecoder honours view byteOffset:', subarrayOk)
    for (const ds of DATASETS) {
      for (const s of ds.setup) await exec(s)
      // 1) query phase (native work + delivery to JS), formats interleaved
      const formats: Array<[string, number]> = [['bin', 0], ['heap', EXEC_STRHEAP]]
      if (!ds.blobs) formats.push(['json', EXEC_JSON])
      const tq: Record<string, number[]> = {}
      const bufs: Record<string, ArrayBuffer> = {}
      for (let i = 0; i < WARMUP + RUNS; i++) {
        for (const [name, flag] of formats) {
          const t0 = now()
          const r = await exec(ds.query, flag)
          const dt = now() - t0
          if (i >= WARMUP) (tq[name] = tq[name] || []).push(dt)
          bufs[name] = r.data!
        }
      }
      const q: Record<string, number> = {}
      for (const [name] of formats) q[name] = +median(tq[name]).toFixed(2)
      const bin = bufs.bin
      const heap = bufs.heap
      const nat = (b: ArrayBuffer, flags: number) => addon.decodeRows(b, 0, b.byteLength, flags)
      const sub = (v: boolean, fn: () => any) => () => {
        textConfig.subarray = v
        return fn()
      }
      // [name, format, arrays?, fn]
      const variants: Array<[string, string, boolean, () => any]> = [
        ['TS arrays (TextDecoder only)', 'bin', true, () => decodeArraysNaive(bin)],
        ['TS arrays', 'bin', true, sub(false, () => decodeArrays(bin))],
        ['TS objects', 'bin', false, sub(false, () => decodeObjects(bin))],
        ['native arrays', 'bin', true, () => nat(bin, 0)],
        ['native objects', 'bin', false, () => nat(bin, DECODE_OBJECTS)],
        ['TS arrays +heap', 'heap', true, sub(false, () => decodeArrays(heap))],
        ['TS objects +heap', 'heap', false, sub(false, () => decodeObjects(heap))],
        ['native arrays +heap', 'heap', true, () => nat(heap, 0)],
        ['native objects +heap', 'heap', false, () => nat(heap, DECODE_OBJECTS)]
      ]
      if (subarrayOk) {
        variants.push(['TS arrays subarray', 'bin', true, sub(true, () => decodeArrays(bin))])
        variants.push(['TS arrays +heap subarray', 'heap', true, sub(true, () => decodeArrays(heap))])
      }
      if (bufs.json) {
        variants.push(['JSON arrays', 'json', true, () => decodeJsonArrays(bufs.json)])
        variants.push(['JSON objects', 'json', false, () => decodeJsonObjects(bufs.json)])
      }
      // 2) decode phase: variants interleaved so JIT warmup and GC do not favour the first one
      const samples: number[][] = variants.map(() => [])
      for (let i = 0; i < WARMUP + RUNS; i++) {
        variants.forEach(([, , , fn], k) => {
          const t0 = now()
          fn()
          const dt = now() - t0
          if (i >= WARMUP) samples[k].push(dt)
        })
      }
      textConfig.subarray = false
      const out: any = {
        dataset: ds.name,
        rows: decodeArrays(bin).rows.length,
        bytes: { bin: bin.byteLength, heap: heap.byteLength, json: bufs.json ? bufs.json.byteLength : null },
        queryMs: q,
        decode: {} as any
      }
      let reference: string | null = null
      variants.forEach(([name, fmt, arrays, fn], k) => {
        const r = fn()
        const d = digest(r.rows, arrays)
        if (!reference) reference = d
        out.decode[name] = {
          med: +median(samples[k]).toFixed(2),
          min: +Math.min(...samples[k]).toFixed(2),
          total: +(q[fmt] + median(samples[k])).toFixed(2),
          ok: d === reference ? 1 : 'MISMATCH ' + d + ' vs ' + reference
        }
      })
      log(JSON.stringify(out))
    }

    // latency: one small query end to end, many times (call, native, delivery, decode)
    const N = 300
    const one = 'SELECT id, label FROM tiny WHERE id = ?'
    const lat: Record<string, number> = {}
    const run1 = (decoder: ((b: ArrayBuffer) => any) | null) =>
      new Promise<void>((resolve) => {
        addon.exec(db, 0, one, params((e) => e.int(42), 1), 0, 0, (_s: number, _d: boolean, data: ArrayBuffer) => {
          if (decoder) decoder(data)
          resolve()
        })
      })
    for (const [name, dec] of [
      ['no decode', null],
      ['TS arrays', (b: ArrayBuffer) => decodeArrays(b)],
      ['TS objects', (b: ArrayBuffer) => decodeObjects(b)],
      ['native arrays', (b: ArrayBuffer) => addon.decodeRows(b, 0, b.byteLength, 0)],
      ['native objects', (b: ArrayBuffer) => addon.decodeRows(b, 0, b.byteLength, DECODE_OBJECTS)]
    ] as Array<[string, any]>) {
      for (let i = 0; i < 30; i++) await run1(dec)
      const t0 = now()
      for (let i = 0; i < N; i++) await run1(dec)
      lat[name] = +((now() - t0) / N).toFixed(3)
    }
    log('latency per 1-row query (ms, awaited round trip)', JSON.stringify(lat))
    log('done')
  } catch (e) {
    const x: any = e
    log('ERROR', String(x), x && x.stack ? String(x.stack).split('\n').slice(0, 4).join(' | ') : '')
  }
}

import { Backend, OpenParams, RawResult, ResultCallback } from './backend';
import { setNativeUtf8 } from './codec';
import { messageOf } from './core';

declare function setTimeout(callback: () => void, ms?: number): any;

/** microseconds a lone request is waited for right after it is submitted (polling mode only) */
const POLL_SPIN_US = 150;

/** Node-API binding (binding/napi/nssqlite_napi.c): `addon` is the module's exports, callbacks run on the calling thread. */
export function createNapiBackend(addon: any, defaultEngines: Array<string | null>): Backend {
    if (!addon || typeof addon.engine !== 'function') {
        // a runtime that lacks a Node-API function loads the module without its functions: the module says which one
        throw new Error((addon && addon.error) || 'the Node-API module did not export its functions');
    }
    // long strings are converted by the module: the JS conversion of a runtime without TextDecoder is slow
    if (typeof addon.decodeUtf8 === 'function' && typeof addon.encodeUtf8 === 'function') {
        setNativeUtf8({ decode: addon.decodeUtf8, encode: addon.encodeUtf8 });
    }
    const wrap = (cb: ResultCallback) => (status: number, done: boolean, data: ArrayBuffer | null, message: string | null, changes: number, lastInsertRowId: number) => {
        const result: RawResult = { status, done, data, message, changes, lastInsertRowId };
        cb(result);
    };
    // Runtimes without threadsafe functions (the NativeScript QuickJS runtime) cannot wake the JS thread from a database
    // thread: `threadsafe` is false and results wait in a queue until `poll()` runs, here from a timer while requests are
    // in flight. With them (V8 runtimes, Node.js) results are delivered by the runtime and nothing is polled.
    const polling = addon.threadsafe === false && typeof addon.poll === 'function';
    let scheduled = false;
    const pump = () => {
        scheduled = false;
        let pending = 1;
        try {
            pending = addon.poll();
        } finally {
            // a throwing callback must not strand the results left in the queue
            if (pending > 0) {
                schedule();
            }
        }
    };
    const schedule = () => {
        if (!scheduled) {
            scheduled = true;
            setTimeout(pump, 0);
        }
    };
    const submit = <T>(fn: () => T): T => {
        const result = fn();
        if (polling) {
            // a request that is alone usually finishes while we wait for it a moment: no timer round trip then
            if (addon.poll(POLL_SPIN_US) > 0) {
                schedule();
            }
        }
        return result;
    };
    return {
        kind: 'napi',
        defaultEngines,
        engine: (library) => {
            try {
                return addon.engine(library);
            } catch (error) {
                        throw new Error(`${messageOf(error)} (addon.engine is ${typeof addon.engine}, exports: ${Object.keys(addon).join(',')}, thrown: ${error instanceof Error ? error.name : typeof error})`);
            }
        },
        engineVersion: (engine) => addon.engineVersion(engine),
        engineCanLoadExtensions: (engine) => addon.engineCanLoadExtensions(engine),
        open: (engine, path, params: OpenParams, cb) => submit(() => addon.open(engine, path, params.flags, params.busyTimeoutMs, params.wal, params.initSql, wrap(cb))),
        exec: (db, tx, sql, params, flags, chunkRows, cb) => submit(() => addon.exec(db, tx, sql, params, flags, chunkRows, wrap(cb))),
        execSync: (db, tx, sql, params, flags) => {
            const [status, data, message, changes, lastInsertRowId] = addon.execSync(db, tx, sql, params, flags);
            return { status, done: true, data, message, changes, lastInsertRowId };
        },
        batch: (db, tx, request, flags, cb) => submit(() => addon.batch(db, tx, request, flags, wrap(cb))),
        txBegin: (db, mode, cb) => submit(() => addon.txBegin(db, mode, wrap(cb))),
        txEnd: (db, tx, commit, cb) => submit(() => addon.txEnd(db, tx, commit, wrap(cb))),
        loadExtension: (db, path, entry, cb) => submit(() => addon.loadExtension(db, path, entry, wrap(cb))),
        close: (db, cb) => submit(() => addon.close(db, wrap(cb))),
        // the external handle releases its reference when it is garbage collected
        release: () => {}
    };
}

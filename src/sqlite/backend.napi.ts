import { Backend, OpenParams, RawResult, ResultCallback } from './backend';
import { setNativeUtf8 } from './codec';

declare function setTimeout(callback: () => void, ms?: number): any;

/**
 * Node-API binding (binding/napi/nssqlite_napi.c), used directly. `addon` is the module's exports. The addon
 * invokes the callbacks as (status, done, data, message, changes, lastInsertRowId) on the calling thread.
 */
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
        const r: RawResult = { status, done, data, message, changes, lastInsertRowId };
        cb(r);
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
            // also when a callback threw (the exception still reaches the caller): results left in the queue must not be stranded
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
    /** runs a submit call, then makes sure its result will be picked up */
    const submit = <T>(fn: () => T): T => {
        const r = fn();
        if (polling) {
            schedule();
        }
        return r;
    };
    return {
        kind: 'napi',
        defaultEngines,
        engine: (library) => {
            try {
                return addon.engine(library);
            } catch (e) {
                // a runtime-specific failure of the native call itself (a SQLite failure carries its own message)
                const m = (e && (e as any).message) || String(e);
                throw new Error(`${m} (addon.engine is ${typeof addon.engine}, exports: ${Object.keys(addon).join(',')}, thrown: ${(e && (e as any).name) || typeof e})`);
            }
        },
        engineVersion: (e) => addon.engineVersion(e),
        engineCanLoadExtensions: (e) => addon.engineCanLoadExtensions(e),
        open: (engine, path, p: OpenParams, cb) => submit(() => addon.open(engine, path, p.flags, p.busyTimeoutMs, p.wal, p.initSql, wrap(cb))),
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

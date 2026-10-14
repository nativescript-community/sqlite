import { Backend, OpenParams, RawResult, ResultCallback } from './backend';

/**
 * Node-API binding (binding/napi/nssqlite_napi.c), used directly. `addon` is the module's exports. The addon
 * invokes the callbacks as (status, done, data, message, changes, lastInsertRowId) on the calling thread.
 */
export function createNapiBackend(addon: any, defaultEngines: Array<string | null>): Backend {
    if (!addon || typeof addon.engine !== 'function') {
        // a runtime that lacks a Node-API function loads the module without its functions: the module says which one
        throw new Error((addon && addon.error) || 'the Node-API module did not export its functions');
    }
    const wrap = (cb: ResultCallback) => (status: number, done: boolean, data: ArrayBuffer | null, message: string | null, changes: number, lastInsertRowId: number) => {
        const r: RawResult = { status, done, data, message, changes, lastInsertRowId };
        cb(r);
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
        open: (engine, path, p: OpenParams, cb) => addon.open(engine, path, p.flags, p.busyTimeoutMs, p.wal, p.initSql, wrap(cb)),
        exec: (db, tx, sql, params, flags, chunkRows, cb) => addon.exec(db, tx, sql, params, flags, chunkRows, wrap(cb)),
        execSync: (db, tx, sql, params, flags) => {
            const [status, data, message, changes, lastInsertRowId] = addon.execSync(db, tx, sql, params, flags);
            return { status, done: true, data, message, changes, lastInsertRowId };
        },
        batch: (db, tx, request, flags, cb) => addon.batch(db, tx, request, flags, wrap(cb)),
        txBegin: (db, mode, cb) => addon.txBegin(db, mode, wrap(cb)),
        txEnd: (db, tx, commit, cb) => addon.txEnd(db, tx, commit, wrap(cb)),
        loadExtension: (db, path, entry, cb) => addon.loadExtension(db, path, entry, wrap(cb)),
        close: (db, cb) => addon.close(db, wrap(cb)),
        // the external handle releases its reference when it is garbage collected
        release: () => {}
    };
}

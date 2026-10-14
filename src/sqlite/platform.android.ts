import { Utils } from '@nativescript/core';
import { Backend, OpenParams, ResultCallback } from './backend';
import { encodeUtf8 } from './codec';
import { nativeRequire, pickBackend } from './platform.common';

declare const com: any;
declare const java: any;

// androidx sqlite-bundled ships its SQLite as libsqliteJni.so
// no default: the app (or @nativescript-community/sqlite, which adds androidx sqlite-bundled) chooses the SQLite
const DEFAULT_ENGINES: Array<string | null> = [];

/** NativeScript adds ArrayBuffer.from(javaByteBuffer): the bytes of a direct ByteBuffer without a copy. */
function arrayBufferFrom(javaBuffer: unknown): ArrayBuffer {
    if ('from' in ArrayBuffer && typeof ArrayBuffer.from === 'function') {
        return ArrayBuffer.from(javaBuffer);
    }
    throw new Error('ArrayBuffer.from is not available in this runtime');
}

function loadAddon() {
    // The module registers itself process wide when its library loads: the bare name works afterwards (also in
    // Workers, where requiring the path again fails), the first load goes through the path.
    try {
        return nativeRequire('nssqlite');
    } catch (error) {
        return nativeRequire('system_lib://libnssqlite_napi.so');
    }
}

/**
 * JNI bridge (NativeSqlite.java), for runtimes without Node-API. Only numbers cross the boundary per request (the runtime aborts
 * at 51200 alive global references): SQL and parameters go through one request arena, results through a result arena.
 */
function createJniBackend(): Backend {
    let NativeSqlite: any;
    try {
        NativeSqlite = com.akylas.sqlite.NativeSqlite;
    } catch (error) {
    }
    if (!NativeSqlite) {
        throw new Error('com.akylas.sqlite.NativeSqlite not found');
    }
    const pending = new Map<number, ResultCallback>();
    let nextId = 1;
    let registered = false;

    let requestU8: Uint8Array;
    let resultAB: ArrayBuffer;

    const ensureRequest = (size: number) => {
        if (!requestU8 || requestU8.length < size) {
            requestU8 = new Uint8Array(arrayBufferFrom(NativeSqlite.requestArena(size)));
        }
    };

    const register = () => {
        if (registered) {
            return;
        }
        registered = true;
        resultAB = arrayBufferFrom(NativeSqlite.resultArena());
        ensureRequest(1);
        NativeSqlite.setCallback(
            new NativeSqlite.Callback({
                onResult(id: number, status: number, done: boolean, dataLen: number, changes: number, lastInsertRowId: number) {
                    const callback = pending.get(Number(id));
                    if (done) {
                        pending.delete(Number(id));
                    }
                    if (!callback) {
                        return;
                    }
                    let data: ArrayBuffer | null = null;
                    if (dataLen >= 0) {
                        data = resultAB.slice(0, dataLen);
                    } else if (dataLen === -2) {
                        // too large for the arena: a copy, then the Java side frees the native memory
                        data = arrayBufferFrom(NativeSqlite.takeBigData()).slice(0);
                    }
                    callback({ status, done, data, message: status !== 0 ? NativeSqlite.takeMessage() : null, changes: Number(changes), lastInsertRowId: Number(lastInsertRowId) });
                }
            })
        );
    };

    /** writes `sql` (UTF-8) at the start of the request arena, returns its length in bytes */
    const writeSql = (sql: string, reserve: number): number => {
        const sqlLength = sql.length;
        ensureRequest(sqlLength * 3 + reserve);
        const u8 = requestU8;
        for (let index = 0; index < sqlLength; index++) {
            const code = sql.charCodeAt(index);
            if (code > 127) {
                const bytes = encodeUtf8(sql);
                ensureRequest(bytes.length + reserve);
                requestU8.set(bytes, 0);
                return bytes.length;
            }
            u8[index] = code;
        }
        return sqlLength;
    };

    /** runs `submit(id)` and forgets the callback when the core refused the request */
    const request = (callback: ResultCallback, submit: (id: number) => number, accepted: (rc: number) => boolean = (rc) => rc === 0) => {
        register();
        const id = nextId++;
        pending.set(id, callback);
        let rc: number;
        try {
            rc = submit(id);
        } catch (error) {
            pending.delete(id);
            throw error;
        }
        if (!accepted(rc)) {
            pending.delete(id);
        }
        return rc;
    };

    return {
        kind: 'bridge',
        defaultEngines: DEFAULT_ENGINES,
        engine: (library) => NativeSqlite.engine(library),
        engineVersion: (engine) => NativeSqlite.engineVersion(engine),
        engineCanLoadExtensions: (engine) => NativeSqlite.engineCanLoadExtensions(engine),
        open: (engine, path, params: OpenParams, callback) => {
            register();
            const id = nextId++;
            pending.set(id, callback);
            try {
                return NativeSqlite.open(engine, path, params.flags, params.busyTimeoutMs, params.wal, params.initSql, id);
            } catch (error) {
                pending.delete(id);
                throw error;
            }
        },
        exec: (db, tx, sql, params, flags, chunkRows, callback) =>
            request(callback, (id) => {
                const paramsLen = params ? params.byteLength : 0;
                const sqlLen = writeSql(sql, paramsLen);
                if (paramsLen) {
                    requestU8.set(new Uint8Array(params), sqlLen);
                }
                return NativeSqlite.exec(db, tx, sqlLen, paramsLen, flags, chunkRows, id);
            }),
        batch: (db, tx, req, flags, callback) =>
            request(callback, (id) => {
                ensureRequest(req.byteLength);
                requestU8.set(new Uint8Array(req), 0);
                return NativeSqlite.batch(db, tx, req.byteLength, flags, id);
            }),
        txBegin: (db, mode, callback) => request(callback, (id) => NativeSqlite.txBegin(db, mode, id), (tx) => tx !== 0),
        txEnd: (db, tx, commit, callback) => request(callback, (id) => NativeSqlite.txEnd(db, tx, commit, id)),
        loadExtension: (db, path, entry, callback) => request(callback, (id) => NativeSqlite.loadExtension(db, path, entry, id)),
        close: (db, callback) => request(callback, (id) => NativeSqlite.close(db, id)),
        release: (db) => NativeSqlite.release(db)
    };
}

export function loadBackend(prefer: 'auto' | 'napi' | 'bridge'): Backend {
    return pickBackend(prefer, DEFAULT_ENGINES, loadAddon, createJniBackend);
}

export function resolveDatabasePath(path: string) {
    if (path === ':memory:' || path.indexOf('file:') === 0) {
        return path;
    }
    if (path.indexOf('/') < 0) {
        path = Utils.android.getApplicationContext().getDatabasePath(path).getAbsolutePath();
    }
    const parent = new java.io.File(path).getParentFile();
    if (parent && !parent.exists()) {
        parent.mkdirs(); // best effort: the open reports the real problem
    }
    return path;
}

export function deleteDatabaseFiles(path: string) {
    path = resolveDatabasePath(path);
    let existed = false;
    for (const suffix of ['', '-wal', '-shm', '-journal']) {
        const file = new java.io.File(path + suffix);
        if (file.exists()) {
            existed = existed || suffix === '';
            file.delete();
        }
    }
    return existed;
}

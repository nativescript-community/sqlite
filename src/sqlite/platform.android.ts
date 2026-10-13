import { Utils } from '@nativescript/core';
import { Backend, OpenParams, ResultCallback } from './backend';
import { nativeRequire, pickBackend } from './platform.common';

declare const com: any;
declare const java: any;

// androidx sqlite-bundled ships its SQLite as libsqliteJni.so
// no default: the app (or @nativescript-community/sqlite, which adds androidx sqlite-bundled) chooses the SQLite
const DEFAULT_ENGINES: Array<string | null> = [];

function loadAddon() {
    // The module registers itself process wide when its library loads: the bare name works afterwards (also in
    // Workers, where requiring the path again fails), the first load goes through the path.
    try {
        return nativeRequire('nssqlite');
    } catch (e) {
        return nativeRequire('system_lib://libnssqlite_napi.so');
    }
}

/**
 * JNI bridge (NativeSqlite.java), for runtimes without Node-API.
 *
 * Only numbers cross the boundary per request: the NativeScript runtime pins a global reference for every Java object
 * or JS buffer it converts, and aborts the process at 51200 alive references, which thousands of queries between two
 * garbage collections reach. The SQL and parameters are written into a request arena (one direct ByteBuffer created
 * once, wrapped as an ArrayBuffer), results come back as numbers with their bytes in a result arena that is copied
 * right away. Requests are numbered; one Java callback object serves all of them.
 */
function createJniBackend(): Backend {
    const N = com.akylas.sqlite.NativeSqlite;
    const pending = new Map<number, ResultCallback>();
    let nextId = 1;
    let registered = false;

    // arenas, wrapped once
    let requestU8: Uint8Array;
    let resultAB: ArrayBuffer;
    let encoder: TextEncoder;

    const ensureRequest = (size: number) => {
        if (!requestU8 || requestU8.length < size) {
            requestU8 = new Uint8Array((ArrayBuffer as any).from(N.requestArena(size)));
        }
    };

    const register = () => {
        if (registered) {
            return;
        }
        registered = true;
        resultAB = (ArrayBuffer as any).from(N.resultArena());
        ensureRequest(1);
        N.setCallback(
            new N.Callback({
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
                        data = (ArrayBuffer as any).from(N.takeBigData()).slice(0);
                    }
                    callback({ status, done, data, message: status !== 0 ? N.takeMessage() : null, changes: Number(changes), lastInsertRowId: Number(lastInsertRowId) });
                }
            })
        );
    };

    /** writes `sql` (UTF-8) at the start of the request arena, returns its length in bytes */
    const writeSql = (sql: string, reserve: number): number => {
        const n = sql.length;
        ensureRequest(n * 3 + reserve);
        const u8 = requestU8;
        for (let i = 0; i < n; i++) {
            const c = sql.charCodeAt(i);
            if (c > 127) {
                encoder = encoder || new TextEncoder();
                const bytes = encoder.encode(sql);
                ensureRequest(bytes.length + reserve);
                requestU8.set(bytes, 0);
                return bytes.length;
            }
            u8[i] = c;
        }
        return n;
    };

    /** runs `submit(id)` and forgets the callback when the core refused the request */
    const request = (callback: ResultCallback, submit: (id: number) => number, accepted: (rc: number) => boolean = (rc) => rc === 0) => {
        register();
        const id = nextId++;
        pending.set(id, callback);
        let rc: number;
        try {
            rc = submit(id);
        } catch (e) {
            pending.delete(id);
            throw e;
        }
        if (!accepted(rc)) {
            pending.delete(id);
        }
        return rc;
    };

    return {
        kind: 'bridge',
        defaultEngines: DEFAULT_ENGINES,
        engine: (library) => N.engine(library),
        engineVersion: (e) => N.engineVersion(e),
        engineCanLoadExtensions: (e) => N.engineCanLoadExtensions(e),
        open: (engine, path, p: OpenParams, callback) => {
            register();
            const id = nextId++;
            pending.set(id, callback);
            try {
                return N.open(engine, path, p.flags, p.busyTimeoutMs, p.wal, p.initSql, id);
            } catch (e) {
                pending.delete(id);
                throw e;
            }
        },
        exec: (db, tx, sql, params, flags, chunkRows, callback) =>
            request(callback, (id) => {
                const paramsLen = params ? params.byteLength : 0;
                const sqlLen = writeSql(sql, paramsLen);
                if (paramsLen) {
                    requestU8.set(new Uint8Array(params), sqlLen);
                }
                return N.exec(db, tx, sqlLen, paramsLen, flags, chunkRows, id);
            }),
        batch: (db, tx, req, flags, callback) =>
            request(callback, (id) => {
                ensureRequest(req.byteLength);
                requestU8.set(new Uint8Array(req), 0);
                return N.batch(db, tx, req.byteLength, flags, id);
            }),
        txBegin: (db, mode, callback) => request(callback, (id) => N.txBegin(db, mode, id), (tx) => tx !== 0),
        txEnd: (db, tx, commit, callback) => request(callback, (id) => N.txEnd(db, tx, commit, id)),
        loadExtension: (db, path, entry, callback) => request(callback, (id) => N.loadExtension(db, path, entry, id)),
        close: (db, callback) => request(callback, (id) => N.close(db, id)),
        release: (db) => N.release(db)
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

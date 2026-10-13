import { Utils } from '@nativescript/core';
import { Backend, OpenParams, RawResult, ResultCallback } from './backend';
import { nativeRequire, pickBackend } from './platform.common';

declare const com: any;
declare const java: any;

// androidx sqlite-bundled ships its SQLite as libsqliteJni.so
const DEFAULT_ENGINES = ['libsqliteJni.so'];

function loadAddon() {
    // The module registers itself process wide when its library loads: the bare name works afterwards (also in
    // Workers, where requiring the path again fails), the first load goes through the path.
    try {
        return nativeRequire('nssqlite');
    } catch (e) {
        return nativeRequire('system_lib://libnssqlite_napi.so');
    }
}

/** JNI bridge (NativeSqlite.java), for runtimes without Node-API. */
function createJniBackend(): Backend {
    const N = com.akylas.sqlite.NativeSqlite;
    const cb = (callback: ResultCallback) =>
        new N.Callback({
            onResult(r: any) {
                // a ByteBuffer returned by a method becomes an ArrayBuffer over the same native memory
                const bb = r.getData();
                const raw: RawResult = {
                    status: r.getStatus(),
                    done: r.isDone(),
                    data: bb ? (ArrayBuffer as any).from(bb) : null,
                    message: r.getMessage(),
                    changes: Number(r.getChanges()),
                    lastInsertRowId: Number(r.getLastInsertRowId()),
                    release: () => r.release()
                };
                callback(raw);
            }
        });
    return {
        kind: 'bridge',
        defaultEngines: DEFAULT_ENGINES,
        engine: (library) => N.engine(library),
        engineVersion: (e) => N.engineVersion(e),
        engineCanLoadExtensions: (e) => N.engineCanLoadExtensions(e),
        open: (engine, path, p: OpenParams, callback) => N.open(engine, path, p.flags, p.busyTimeoutMs, p.wal, p.initSql, cb(callback)),
        exec: (db, tx, sql, params, flags, chunkRows, callback) => N.exec(db, tx, sql, params, flags, chunkRows, cb(callback)),
        batch: (db, tx, request, flags, callback) => N.batch(db, tx, request, flags, cb(callback)),
        txBegin: (db, mode, callback) => N.txBegin(db, mode, cb(callback)),
        txEnd: (db, tx, commit, callback) => N.txEnd(db, tx, commit, cb(callback)),
        loadExtension: (db, path, entry, callback) => N.loadExtension(db, path, entry, cb(callback)),
        close: (db, callback) => N.close(db, cb(callback)),
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

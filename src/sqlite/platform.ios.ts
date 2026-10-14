import { knownFolders } from '@nativescript/core';
import { Backend, OpenParams, RawResult, ResultCallback } from './backend';
import { nativeRequire, pickBackend } from './platform.common';

declare const NSSqliteBridge: any;
declare const NSFileManager: any;
declare const NSData: any;
declare const interop: any;

// no default: the app (or @nativescript-community/sqlite, which picks the SQLite of the process) chooses the SQLite
const DEFAULT_ENGINES: Array<string | null> = [];

function loadAddon() {
    // linked into the app: registered when the app starts
    return nativeRequire('nssqlite');
}

/** Objective-C bridge (NSSqliteBridge), for runtimes without Node-API. */
function createObjcBackend(): Backend {
    if (typeof NSSqliteBridge === 'undefined') {
        throw new Error('NSSqliteBridge not found');
    }
    const bridge = NSSqliteBridge;
    const cb = (callback: ResultCallback) => (status: number, done: boolean, data: any, message: string | null, changes: number, lastInsertRowId: number) => {
        const raw: RawResult = { status, done, data: data ? interop.bufferFromData(data) : null, message, changes: Number(changes), lastInsertRowId: Number(lastInsertRowId) };
        callback(raw);
    };
    const toData = (buffer: ArrayBuffer | null) => (buffer ? NSData.dataWithData(buffer) : null);
    return {
        kind: 'bridge',
        defaultEngines: DEFAULT_ENGINES,
        engine: (library) => {
            const error = bridge.engineError(library);
            if (!error) {
                throw new Error(`cannot load SQLite library ${library}`);
            }
            return error;
        },
        engineVersion: (engine) => bridge.engineVersion(engine),
        engineCanLoadExtensions: (engine) => bridge.engineCanLoadExtensions(engine),
        open: (engine, path, params: OpenParams, callback) => bridge.openPathFlagsBusyMsWalInitSqlCallback(engine, path, params.flags, params.busyTimeoutMs, params.wal, params.initSql, cb(callback)),
        exec: (db, tx, sql, params, flags, chunkRows, callback) => bridge.execTxSqlParamsFlagsChunkRowsCallback(db, tx, sql, toData(params), flags, chunkRows, cb(callback)),
        batch: (db, tx, request, flags, callback) => bridge.batchTxRequestFlagsCallback(db, tx, NSData.dataWithData(request), flags, cb(callback)),
        txBegin: (db, mode, callback) => bridge.txBeginModeCallback(db, mode, cb(callback)),
        txEnd: (db, tx, commit, callback) => bridge.txEndTxCommitCallback(db, tx, commit, cb(callback)),
        loadExtension: (db, path, entry, callback) => bridge.loadExtensionPathEntryCallback(db, path, entry, cb(callback)),
        close: (db, callback) => bridge.closeCallback(db, cb(callback)),
        release: (db) => bridge.releaseDb(db)
    };
}

export function loadBackend(prefer: 'auto' | 'napi' | 'bridge'): Backend {
    return pickBackend(prefer, DEFAULT_ENGINES, loadAddon, createObjcBackend);
}

export function resolveDatabasePath(path: string) {
    if (path === ':memory:' || path.indexOf('file:') === 0) {
        return path;
    }
    if (path.indexOf('/') < 0) {
        // a bare name lives in the app's documents folder (the working directory is not writable)
        path = knownFolders.documents().path + '/' + path;
    }
    const fm = NSFileManager.defaultManager;
    const dir = path.substring(0, path.lastIndexOf('/'));
    if (dir && !fm.fileExistsAtPath(dir)) {
        try {
            fm.createDirectoryAtPathWithIntermediateDirectoriesAttributesError(dir, true, null);
        } catch (error) {
            // the open reports the real problem
        }
    }
    return path;
}

export function deleteDatabaseFiles(path: string) {
    path = resolveDatabasePath(path);
    const fm = NSFileManager.defaultManager;
    let existed = false;
    for (const suffix of ['', '-wal', '-shm', '-journal']) {
        if (fm.fileExistsAtPath(path + suffix)) {
            existed = existed || suffix === '';
            try {
                fm.removeItemAtPathError(path + suffix);
            } catch (error) {
                // best effort
            }
        }
    }
    return existed;
}

import { Backend } from './backend';
import { Database } from './database';
import { deleteDatabaseFiles, loadBackend, resolveDatabasePath } from './platform';
import { translateAndroidFlags } from './platform.common';
import { DatabaseOptions, GlobalConfig, SQLiteDatabase } from './sqlite.common';

export * from './sqlite.common';

const config: GlobalConfig = {};
let backend: Backend | undefined;

/**
 * Global settings. `engine` is the SQLite library databases use unless their `engine` option says otherwise: a library
 * name the platform can dlopen (`libsqlcipher.so`), or `null` for the SQLite of the process (iOS). This package ships
 * none; `defaultEngine` is what a provider package (@nativescript-community/sqlite) sets. `backend` forces a binding for
 * the databases opened afterwards.
 */
export function configure(options: GlobalConfig) {
    if (options.backend && options.backend !== config.backend) {
        // databases keep the binding they were opened with
        backend = undefined;
    }
    Object.assign(config, options);
}

function getBackend() {
    return backend || (backend = loadBackend(config.backend || 'auto'));
}

/**
 * Opens (or creates) a database. The call returns at once: the database opens on its own thread, requests wait
 * for it, and an open error is reported by `db.ready` and by the first request.
 */
export function openOrCreate(filePath: string, options: DatabaseOptions = {}): SQLiteDatabase {
    const b = getBackend();
    const engine = config.engine !== undefined ? config.engine : config.defaultEngine;
    options = translateAndroidFlags(options);
    return new Database(b, resolveDatabasePath(filePath), config.defaultOptions ? { ...config.defaultOptions, ...options } : options, engine !== undefined ? [engine] : undefined);
}

/** Like `openOrCreate`, resolves once the database is open and rejects with the open error. */
export async function openOrCreateAsync(filePath: string, options: DatabaseOptions = {}): Promise<SQLiteDatabase> {
    const db = openOrCreate(filePath, options);
    await db.ready;
    return db;
}

export function deleteDatabase(filePath: string) {
    return deleteDatabaseFiles(filePath);
}

export { Database };

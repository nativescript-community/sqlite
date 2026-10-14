import { Backend } from './backend';
import { Database } from './database';
import { deleteDatabaseFiles, loadBackend, resolveDatabasePath } from './platform';
import { translateAndroidFlags } from './platform.common';
import { DatabaseOptions, GlobalConfig, SQLiteDatabase } from './sqlite.common';

export * from './sqlite.common';

const config: GlobalConfig = {};
let backend: Backend | undefined;

/**
 * Global settings. `engine` is the SQLite library of the databases that do not set their own: a library name the platform can
 * dlopen, or `null` for the process SQLite (iOS). `defaultEngine` is what a provider package sets; `backend` forces a binding.
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

/** Opens (or creates) a database and returns at once: an open error is reported by `db.ready` and by the first request. */
export function openOrCreate(filePath: string, options: DatabaseOptions = {}): SQLiteDatabase {
    const binding = getBackend();
    const engine = config.engine !== undefined ? config.engine : config.defaultEngine;
    options = translateAndroidFlags(options);
    return new Database(binding, resolveDatabasePath(filePath), config.defaultOptions ? { ...config.defaultOptions, ...options } : options, engine !== undefined ? [engine] : undefined);
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

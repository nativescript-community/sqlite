import { createNapiBackend } from '../backend.napi';
import { Database } from '../database';
import { DatabaseOptions, SqliteParam } from '../sqlite.common';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const ENGINE = process.env.NSSQLITE_TEST_ENGINE || (process.platform === 'darwin' ? '/usr/lib/libsqlite3.dylib' : 'libsqlite3.so.0');

let addon: any;
export function loadAddon() {
    if (!addon) {
        const file = process.env.NSSQLITE_NODE_ADDON;
        if (!file) {
            throw new Error('NSSQLITE_NODE_ADDON is not set: run native/test-ts.sh');
        }
        const fakeModule: any = { exports: {} };
        process.dlopen(fakeModule, file);
        addon = fakeModule.exports;
    }
    return addon;
}

export function backend() {
    return createNapiBackend(loadAddon(), [ENGINE]);
}

export function open(file = ':memory:', options: DatabaseOptions = {}) {
    return new Database(backend(), file, { engine: ENGINE, ...options });
}

let counter = 0;
const created: string[] = [];
export function tmpDb() {
    const file = path.join(os.tmpdir(), `nssqlite-ts-${process.pid}-${counter++}.db`);
    created.push(file);
    return file;
}

process.on('exit', () => {
    for (const file of created) {
        for (const suffix of ['', '-wal', '-shm', '-journal']) {
            try {
                fs.unlinkSync(file + suffix);
            } catch (error) {
                // ignore
            }
        }
    }
});

/** A statement with its parameters, in the shape batch() takes. */
export function statement(sql: string, ...params: SqliteParam[]): [string, SqliteParam[]] {
    return [sql, params];
}

export const engine = ENGINE;

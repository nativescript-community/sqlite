import { Backend, RawResult, ResultCallback } from './backend';
import { SqliteError } from './sqlite.common';

/** Turns a failed raw result into an error and always releases the native memory behind a result. */
export function toError(raw: RawResult, sql?: string) {
    return new SqliteError(raw.message || `SQLite error ${raw.status}`, raw.status, sql);
}

/**
 * Submits a request and resolves with its (only) result, rejects with a SqliteError. `submit` receives the
 * callback and returns the core submit status.
 */
export function request(submit: (cb: ResultCallback) => number, sql?: string): Promise<RawResult> {
    return new Promise((resolve, reject) => {
        const rc = submit((raw) => {
            if (raw.status !== 0) {
                const err = toError(raw, sql);
                raw.release && raw.release();
                reject(err);
            } else {
                resolve(raw);
            }
        });
        if (rc) {
            reject(new SqliteError(rc === -1 ? 'database is closed' : `request refused (${rc})`, rc, sql));
        }
    });
}

/**
 * Same for streamed requests: `onChunk` is called for every chunk (done = false) and the promise resolves with the
 * final result. When `onChunk` throws, remaining chunks are released and the promise rejects once the stream ended.
 */
export function stream(submit: (cb: ResultCallback) => number, onChunk: (raw: RawResult) => void, sql?: string): Promise<RawResult> {
    return new Promise((resolve, reject) => {
        let failure: any;
        const rc = submit((raw) => {
            if (raw.status !== 0) {
                const err = toError(raw, sql);
                raw.release && raw.release();
                reject(failure || err);
                return;
            }
            if (!raw.done) {
                if (!failure) {
                    try {
                        onChunk(raw);
                    } catch (e) {
                        failure = e;
                    }
                }
                raw.release && raw.release();
                return;
            }
            if (failure) {
                raw.release && raw.release();
                reject(failure);
            } else {
                resolve(raw);
            }
        });
        if (rc) {
            reject(new SqliteError(rc === -1 ? 'database is closed' : `request refused (${rc})`, rc, sql));
        }
    });
}

const engines = new Map<any, any>();

/** Loads (and caches) the first SQLite library of the candidates that works. */
export function loadEngine(backend: Backend, candidates: Array<string | null>): any {
    const errors: string[] = [];
    for (const lib of candidates) {
        const key = backend.kind + ':' + lib;
        if (engines.has(key)) {
            return engines.get(key);
        }
        try {
            const e = backend.engine(lib);
            engines.set(key, e);
            return e;
        } catch (e) {
            errors.push(`${lib === null ? '(sqlite3 symbols of the process)' : lib}: ${(e && (e as any).message) || e}`);
        }
    }
    if (candidates.length === 0) {
        throw new Error(
            'No SQLite engine chosen. This package ships no SQLite: set one with configure({ engine }) or the `engine` option ' +
                "(e.g. 'libsqlcipher.so' on Android, null for the SQLite linked into the app on iOS), or use @nativescript-community/sqlite, " +
                'which adds the default one.'
        );
    }
    throw new Error(
        'No usable SQLite library. Tried ' +
            errors.join('; ') +
            '. Choose one with configure({ engine }) or the `engine` option; on Android add a library that exports the sqlite3_* API ' +
            'to the app (e.g. androidx.sqlite:sqlite-bundled provides libsqliteJni.so).'
    );
}

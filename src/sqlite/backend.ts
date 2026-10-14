/**
 * What a binding (Node-API, JNI, Objective-C) provides, mirroring core/nssqlite.h. Results come back through callbacks on the
 * calling thread; submit calls return 0 when queued or a negative core error (the callback is then not called).
 */
export interface RawResult {
    /** 0 = ok, > 0 SQLite (extended) result code, < 0 core error */
    status: number;
    /** false for the chunks of a streamed request */
    done: boolean;
    /** rows block / batch block, null when there is none. Valid until `release` is called. */
    data: ArrayBuffer | null;
    message: string | null;
    changes: number;
    lastInsertRowId: number;
    /** frees the native memory behind `data` (bridges only), call it once the data was decoded */
    release?: () => void;
}

export type ResultCallback = (result: RawResult) => void;

export interface OpenParams {
    flags: number;
    busyTimeoutMs: number;
    wal: boolean;
    initSql: string | null;
}

export interface Backend {
    readonly kind: 'napi' | 'bridge';
    /** SQLite libraries to try when the app did not choose one */
    readonly defaultEngines: Array<string | null>;
    /** null = the SQLite already in the process. Throws when it cannot be loaded. */
    engine(library: string | null): any;
    engineVersion(engine: any): string;
    engineCanLoadExtensions(engine: any): boolean;
    /** returns the handle immediately, the callback reports the open result. Throws. */
    open(engine: any, path: string, params: OpenParams, callback: ResultCallback): any;
    exec(db: any, tx: number, sql: string, params: ArrayBuffer | null, flags: number, chunkRows: number, callback: ResultCallback): number;
    batch(db: any, tx: number, request: ArrayBuffer, flags: number, callback: ResultCallback): number;
    /**
     * Optional: runs one statement and blocks the calling thread until the database thread answers. Saves the event
     * loop round trip of the asynchronous calls (about 0.05 ms on iOS, 0.4 ms on Android) for tiny statements.
     */
    execSync?(db: any, tx: number, sql: string, params: ArrayBuffer | null, flags: number): RawResult;
    /** returns the transaction id, 0 when refused */
    txBegin(db: any, mode: number, callback: ResultCallback): number;
    txEnd(db: any, tx: number, commit: boolean, callback: ResultCallback): number;
    loadExtension(db: any, path: string, entry: string | null, callback: ResultCallback): number;
    close(db: any, callback: ResultCallback): number;
    /** drops the caller's reference of the handle, after close */
    release(db: any): void;
}

export const EXEC_SCRIPT = 1;
export const BATCH_ATOMIC = 1;
export const TX_DEFERRED = 0;
export const TX_IMMEDIATE = 1;
export const TX_EXCLUSIVE = 2;

// SQLITE_OPEN_* values
export const OPEN_READONLY = 0x1;
export const OPEN_READWRITE = 0x2;
export const OPEN_CREATE = 0x4;

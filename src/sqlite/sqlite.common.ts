/** A value that can be bound to a statement parameter. */
export type SqliteParam = null | undefined | boolean | number | bigint | string | Date | ArrayBuffer | ArrayBufferView | number[];

export type SqliteParams = SqliteParam | SqliteParam[];

/** How INT64 cells (integers that do not fit 32 bits) are returned. */
export type Int64Mode =
    /** always a number: values beyond 2^53 lose precision (default) */
    | 'number'
    /** a number when it is a safe integer, a bigint otherwise */
    | 'auto'
    /** always a bigint */
    | 'bigint';

export interface SqliteRequestOptions {
    /**
     * BLOB values: a Uint8Array (default) or, with `false`, an ArrayBuffer.
     */
    transformBlobs?: boolean;
    int64?: Int64Mode;
    /** @deprecated Android cursor windows do not exist anymore. */
    cursorWindowSize?: number;
    /** @deprecated Android cursor windows do not exist anymore. */
    cursorWindowName?: string;
}

export interface DatabaseOptions extends SqliteRequestOptions {
    /** @deprecated Every request runs on a native thread now. */
    threading?: boolean;
    readOnly?: boolean;
    /** sqlite3_open_v2 flags. Default: READWRITE | CREATE. */
    flags?: number;
    /**
     * The SQLite library to use: a library name the platform can dlopen (`libsqliteJni.so` is androidx
     * sqlite-bundled, `libsqlcipher.so`...), or `null` for the SQLite already in the process (iOS system SQLite).
     * Default: the value given to `configure`, else the platform default (see `configure`).
     */
    engine?: string | null;
    /** milliseconds, default 5000, negative to disable */
    busyTimeout?: number;
    /** switch to write-ahead logging after opening */
    wal?: boolean;
    /** SQL run right after opening, e.g. `PRAGMA key = '...'` for SQLCipher */
    initSql?: string;
}

export interface GlobalConfig {
    /** default `engine` of databases */
    engine?: string | null;
    /** force a binding: 'napi' (NativeScript >= 9.1) or 'bridge' (JNI / Objective-C). Default: napi when available. */
    backend?: 'auto' | 'napi' | 'bridge';
}

export interface SqliteRow {
    [name: string]: any;
}

export interface ExecResult {
    /** rows changed by the last INSERT / UPDATE / DELETE of the statement */
    changes: number;
    lastInsertRowId: number;
}

export interface BatchStatement {
    sql: string;
    params?: SqliteParams;
}

export interface BatchResult extends ExecResult {
    /** rows returned by the statement (objects) */
    rows: SqliteRow[];
}

export interface BatchOptions {
    /** all statements or none, default true */
    atomic?: boolean;
}

export type TransactionMode = 'deferred' | 'immediate' | 'exclusive';

export interface TransactionOptions {
    /** default 'immediate' */
    mode?: TransactionMode;
}

/** The query methods, shared by a database and by a transaction. */
export interface SQLiteQueryApi {
    execute(query: string, params?: SqliteParams): Promise<ExecResult>;
    /** run several statements separated by `;`, without parameters */
    executeScript(script: string): Promise<void>;
    select(query: string, params?: SqliteParams, options?: SqliteRequestOptions): Promise<SqliteRow[]>;
    selectArray(query: string, params?: SqliteParams, options?: SqliteRequestOptions): Promise<any[][]>;
    get(query: string, params?: SqliteParams, options?: SqliteRequestOptions): Promise<SqliteRow | null>;
    getArray(query: string, params?: SqliteParams, options?: SqliteRequestOptions): Promise<any[] | null>;
    /** streams rows in chunks, resolves with the number of rows */
    each(
        query: string,
        params: SqliteParams,
        callback: (error: Error | null, row: SqliteRow) => void,
        complete?: (error: Error | null, count: number) => void,
        options?: SqliteRequestOptions
    ): Promise<number>;
    batch(statements: Array<BatchStatement | string | [string, SqliteParams?]>, options?: BatchOptions): Promise<BatchResult[]>;

    /**
     * Blocking variants: they wait for the database thread on the calling thread, which saves the event loop round
     * trip of the asynchronous calls (a few tens of microseconds on iOS, ~0.4 ms on Android) and blocks the thread for
     * the duration of the statement. For small, fast statements in a loop; use the asynchronous methods for anything
     * that can take long. Only available with the Node-API binding (NativeScript >= 9.1).
     */
    executeSync(query: string, params?: SqliteParams): ExecResult;
    selectSync(query: string, params?: SqliteParams, options?: SqliteRequestOptions): SqliteRow[];
    selectArraySync(query: string, params?: SqliteParams, options?: SqliteRequestOptions): any[][];
    getSync(query: string, params?: SqliteParams, options?: SqliteRequestOptions): SqliteRow | null;
    getArraySync(query: string, params?: SqliteParams, options?: SqliteRequestOptions): any[] | null;
}

export interface SQLiteTransaction extends SQLiteQueryApi {
    readonly id: number;
}

export interface SQLiteDatabase extends SQLiteQueryApi {
    readonly filePath: string;
    /** true once the database is opened and until it is closed */
    readonly isOpen: boolean;
    /** resolves when the database is opened, rejects with the open error */
    readonly ready: Promise<void>;
    getVersion(): Promise<number>;
    setVersion(version: number): Promise<void>;
    /**
     * Runs `action` in a transaction on the connection: BEGIN, then COMMIT when it resolves, ROLLBACK when it
     * throws or `cancel()` was called. While it runs, other calls made on this database join the transaction;
     * use the `tx` argument to be explicit. Requests of other parts of the app wait for the end.
     */
    transaction<T = any>(action: (cancel: () => void, tx: SQLiteTransaction) => Promise<T> | T, options?: TransactionOptions): Promise<T>;
    loadExtension(path: string, entryPoint?: string): Promise<void>;
    /** version of the SQLite library in use */
    getSqliteVersion(): string;
    close(): Promise<void>;
}

export class SqliteError extends Error {
    /** primary SQLite result code (1..), or a negative core code */
    code: number;
    /** SQLite extended result code */
    extendedCode: number;
    sql?: string;
    constructor(message: string, status: number, sql?: string) {
        super(message);
        this.name = 'SqliteError';
        this.extendedCode = status;
        this.code = status > 0 ? status & 0xff : status;
        this.sql = sql;
        Object.setPrototypeOf(this, SqliteError.prototype);
    }
}

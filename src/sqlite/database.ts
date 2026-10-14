import { BATCH_ATOMIC, Backend, EXEC_SCRIPT, OPEN_CREATE, OPEN_READONLY, OPEN_READWRITE, RawResult, TX_DEFERRED, TX_EXCLUSIVE, TX_IMMEDIATE } from './backend';
import { DecodeOptions, decodeBatch, decodeRows, encodeBatch, encodeParams } from './codec';
import { loadEngine, request, stream, toError } from './core';
import {
    BatchOptions,
    BatchResult,
    BatchStatement,
    DatabaseOptions,
    ExecResult,
    SQLiteDatabase,
    SQLiteQueryApi,
    SQLiteTransaction,
    SqliteError,
    SqliteParams,
    SqliteRequestOptions,
    SqliteRow,
    TransactionOptions
} from './sqlite.common';

const EACH_CHUNK_ROWS = 256;

function decodeOptions(db: DatabaseOptions, options: SqliteRequestOptions | undefined, objects: boolean): DecodeOptions {
    const blobs = options && options.transformBlobs !== undefined ? options.transformBlobs : db.transformBlobs;
    return { objects, arrayBufferBlobs: blobs === false, int64: (options && options.int64) || db.int64 };
}

/** Decodes the rows of a raw result and releases its native memory. */
function rowsOf(raw: RawResult, opts: DecodeOptions) {
    try {
        return raw.data ? decodeRows(raw.data, opts) : { columns: [], rows: [], changes: raw.changes, lastInsertRowId: raw.lastInsertRowId };
    } finally {
        raw.release && raw.release();
    }
}

/** The query methods, once, for a database and for a transaction. */
abstract class QueryApi implements SQLiteQueryApi {
    protected abstract readonly backend: Backend;
    protected abstract readonly options: DatabaseOptions;
    protected abstract handle(): any;
    /** the transaction a call belongs to, 0 for none */
    protected abstract txId(): number;

    async execute(query: string, params?: SqliteParams): Promise<ExecResult> {
        const raw = await request((cb) => this.backend.exec(this.handle(), this.txId(), query, encodeParams(params), 0, 0, cb), query);
        const { changes, lastInsertRowId } = raw;
        raw.release && raw.release();
        return { changes, lastInsertRowId };
    }

    async executeScript(script: string): Promise<void> {
        const raw = await request((cb) => this.backend.exec(this.handle(), this.txId(), script, null, EXEC_SCRIPT, 0, cb), script);
        raw.release && raw.release();
    }

    /** Runs a statement and waits for it on the calling thread: no event loop round trip. */
    private runSync(query: string, params: SqliteParams | undefined, flags = 0): RawResult {
        if (!this.backend.execSync) {
            throw new Error('Synchronous calls are not available with this binding');
        }
        const raw = this.backend.execSync(this.handle(), this.txId(), query, encodeParams(params), flags);
        if (raw.status !== 0) {
            const err = toError(raw, query);
            raw.release && raw.release();
            throw err;
        }
        return raw;
    }

    executeSync(query: string, params?: SqliteParams): ExecResult {
        const raw = this.runSync(query, params);
        const { changes, lastInsertRowId } = raw;
        raw.release && raw.release();
        return { changes, lastInsertRowId };
    }

    selectSync(query: string, params?: SqliteParams, options?: SqliteRequestOptions): SqliteRow[] {
        return rowsOf(this.runSync(query, params), decodeOptions(this.options, options, true)).rows;
    }

    selectArraySync(query: string, params?: SqliteParams, options?: SqliteRequestOptions): any[][] {
        return rowsOf(this.runSync(query, params), decodeOptions(this.options, options, false)).rows;
    }

    getSync(query: string, params?: SqliteParams, options?: SqliteRequestOptions): SqliteRow | null {
        return this.selectSync(query, params, options)[0] || null;
    }

    getArraySync(query: string, params?: SqliteParams, options?: SqliteRequestOptions): any[] | null {
        return this.selectArraySync(query, params, options)[0] || null;
    }

    private async query(query: string, params: SqliteParams | undefined, options: SqliteRequestOptions | undefined, objects: boolean) {
        const raw = await request((cb) => this.backend.exec(this.handle(), this.txId(), query, encodeParams(params), 0, 0, cb), query);
        return rowsOf(raw, decodeOptions(this.options, options, objects)).rows;
    }

    select(query: string, params?: SqliteParams, options?: SqliteRequestOptions): Promise<SqliteRow[]> {
        return this.query(query, params, options, true);
    }

    selectArray(query: string, params?: SqliteParams, options?: SqliteRequestOptions): Promise<any[][]> {
        return this.query(query, params, options, false);
    }

    async get(query: string, params?: SqliteParams, options?: SqliteRequestOptions): Promise<SqliteRow | null> {
        return (await this.query(query, params, options, true))[0] || null;
    }

    async getArray(query: string, params?: SqliteParams, options?: SqliteRequestOptions): Promise<any[] | null> {
        return (await this.query(query, params, options, false))[0] || null;
    }

    async each(
        query: string,
        params: SqliteParams,
        callback: (error: Error | null, row: SqliteRow) => void,
        complete?: (error: Error | null, count: number) => void,
        options?: SqliteRequestOptions
    ): Promise<number> {
        const opts = decodeOptions(this.options, options, true);
        let count = 0;
        let callbackThrew = false;
        const deliver = (rows: any[]) => {
            for (let i = 0; i < rows.length; i++) {
                count++;
                try {
                    callback(null, rows[i]);
                } catch (e) {
                    callbackThrew = true;
                    throw e;
                }
            }
        };
        try {
            const last = await stream(
                (cb) => this.backend.exec(this.handle(), this.txId(), query, encodeParams(params), 0, EACH_CHUNK_ROWS, cb),
                (raw) => deliver(raw.data ? decodeRows(raw.data, opts).rows : []),
                query
            );
            deliver(rowsOf(last, opts).rows);
        } catch (e) {
            if (callbackThrew) {
                // the error comes from the caller's own callback: do not hand it back to the callbacks
                throw e;
            }
            if (complete) {
                complete(e as Error, count);
            } else {
                callback(e as Error, null);
            }
            throw e;
        }
        complete && complete(null, count);
        return count;
    }

    async batch(statements: Array<BatchStatement | string | [string, SqliteParams?]>, options?: BatchOptions): Promise<BatchResult[]> {
        const list = statements.map((s) => (typeof s === 'string' ? { sql: s } : Array.isArray(s) ? { sql: s[0], params: s[1] } : s));
        if (list.length === 0) {
            return [];
        }
        const atomic = !options || options.atomic !== false;
        const raw = await request((cb) => this.backend.batch(this.handle(), this.txId(), encodeBatch(list), atomic ? BATCH_ATOMIC : 0, cb));
        try {
            const blocks = raw.data ? decodeBatch(raw.data, decodeOptions(this.options, undefined, true)) : [];
            return blocks.map((b) => ({ changes: b.changes, lastInsertRowId: b.lastInsertRowId, rows: b.rows }));
        } finally {
            raw.release && raw.release();
        }
    }
}

class Transaction extends QueryApi implements SQLiteTransaction {
    protected backend: Backend;
    protected options: DatabaseOptions;
    constructor(
        private db: Database,
        readonly id: number
    ) {
        super();
        this.backend = db['backend'];
        this.options = db['options'];
    }
    protected handle() {
        return this.db['handle']();
    }
    protected txId() {
        return this.id;
    }
}

const TX_MODES = { deferred: TX_DEFERRED, immediate: TX_IMMEDIATE, exclusive: TX_EXCLUSIVE };

export class Database extends QueryApi implements SQLiteDatabase {
    protected backend: Backend;
    protected options: DatabaseOptions;
    readonly filePath: string;
    readonly ready: Promise<void>;
    private native: any;
    private engineHandle: any;
    private opened = false;
    private closed = false;
    /** the transaction of a running `transaction()`; calls without explicit transaction join it */
    private activeTx = 0;

    constructor(backend: Backend, resolvedPath: string, options: DatabaseOptions = {}, engines: Array<string | null> = backend.defaultEngines) {
        super();
        this.backend = backend;
        this.options = options;
        this.filePath = resolvedPath;
        const candidates = options.engine !== undefined ? [options.engine] : engines;
        this.engineHandle = loadEngine(backend, candidates);
        let flags = options.flags;
        if (flags === undefined || flags === 0) {
            flags = options.readOnly ? OPEN_READONLY : OPEN_READWRITE | OPEN_CREATE;
        }
        this.ready = new Promise<void>((resolve, reject) => {
            this.native = backend.open(
                this.engineHandle,
                resolvedPath,
                { flags, busyTimeoutMs: options.busyTimeout === undefined ? 0 : options.busyTimeout === 0 ? -1 : options.busyTimeout, wal: !!options.wal, initSql: options.initSql || null },
                (raw) => {
                    if (raw.status !== 0) {
                        reject(toError(raw));
                    } else {
                        this.opened = true;
                        resolve();
                    }
                    raw.release && raw.release();
                }
            );
        });
        // a failed open also fails the first request with the same message: do not report it twice
        this.ready.catch(() => {});
    }

    protected handle() {
        if (this.closed) {
            throw new SqliteError('database is closed', -1);
        }
        return this.native;
    }

    protected txId() {
        return this.activeTx;
    }

    get isOpen() {
        return this.opened && !this.closed;
    }

    getSqliteVersion() {
        return this.backend.engineVersion(this.engineHandle);
    }

    canLoadExtensions() {
        return this.backend.engineCanLoadExtensions(this.engineHandle);
    }

    async getVersion() {
        const row = await this.getArray('PRAGMA user_version');
        return row ? (row[0] as number) : 0;
    }

    async setVersion(version: number) {
        if (!Number.isInteger(version)) {
            throw new TypeError('version must be an integer');
        }
        await this.execute(`PRAGMA user_version = ${version}`);
    }

    async transaction<T = any>(action: (cancel: () => void, tx: SQLiteTransaction) => Promise<T> | T, options?: TransactionOptions): Promise<T> {
        let cancelled = false;
        const cancel = () => {
            cancelled = true;
        };
        if (this.activeTx) {
            // already inside a transaction: join it (cancel() rolls the whole transaction back through the outer one)
            return action(cancel, new Transaction(this, this.activeTx));
        }
        const mode = TX_MODES[(options && options.mode) || 'immediate'];
        let id = 0;
        const begun = request((cb) => {
            id = this.backend.txBegin(this.handle(), mode, cb);
            return id ? 0 : -2;
        }, 'BEGIN');
        // calls made from now on belong to the transaction (they wait for its BEGIN): a blocking call must not queue
        // outside of it, it would wait for an end that only the blocked thread can request
        this.activeTx = id;
        // the action starts now, like in 3.x (code that does not await its calls, or queries right after an un-awaited
        // transaction(), relies on it): its calls queue behind the BEGIN
        const tx = new Transaction(this, id);
        let outcome: Promise<T>;
        try {
            outcome = Promise.resolve(action(cancel, tx));
        } catch (e) {
            outcome = Promise.reject(e);
        }
        try {
            const begin = await begun;
            begin.release && begin.release();
        } catch (e) {
            this.activeTx = 0;
            outcome.catch(() => {});
            throw e;
        }
        let result: T;
        try {
            result = await outcome;
        } catch (e) {
            this.activeTx = 0;
            await this.endTransaction(id, false).catch(() => {});
            throw e;
        }
        this.activeTx = 0;
        await this.endTransaction(id, !cancelled);
        return result;
    }

    private async endTransaction(id: number, commit: boolean) {
        const raw = await request((cb) => this.backend.txEnd(this.handle(), id, commit, cb), commit ? 'COMMIT' : 'ROLLBACK');
        raw.release && raw.release();
    }

    async loadExtension(path: string, entryPoint?: string) {
        const raw = await request((cb) => this.backend.loadExtension(this.handle(), path, entryPoint || null, cb));
        raw.release && raw.release();
    }

    async close() {
        if (this.closed) {
            return;
        }
        const handle = this.native;
        // refuse new calls right away; requests already queued still run
        this.closed = true;
        this.opened = false;
        const raw = await request((cb) => this.backend.close(handle, cb));
        raw.release && raw.release();
        this.backend.release(handle);
    }
}

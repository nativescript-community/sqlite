
import { SqliteParam, SqliteParams, SqliteRow, paramsToStringArray, throwError } from './sqlite.common';

type Db = android.database.sqlite.SQLiteDatabase;

type FromCursor<T> = (cursor: android.database.Cursor) => T;

const dataFromCursor = (cursor: android.database.Cursor) => {
    const colCount = cursor.getColumnCount();
    const data: SqliteRow = {};
    for (let i = 0; i < colCount; i++) {
        const type = cursor.getType(i);
        const name = cursor.getColumnName(i);
        switch (type) {
            case android.database.Cursor.FIELD_TYPE_INTEGER:
                data[name] = cursor.getDouble(i);
                break;

            case android.database.Cursor.FIELD_TYPE_FLOAT:
                data[name] = cursor.getDouble(i);
                break;

            case android.database.Cursor.FIELD_TYPE_STRING:
                data[name] = cursor.getString(i);
                break;

            case android.database.Cursor.FIELD_TYPE_BLOB:
                data[name] = cursor.getBlob(i) as any;
                break;

            case android.database.Cursor.FIELD_TYPE_NULL:
                data[name] = null;
                break;

            default:
                throwError(`unknown.type: ${type}`);
        }
    }
    return data;
};

const arrayFromCursor = (cursor: android.database.Cursor) => {
    const colCount = cursor.getColumnCount();
    const data: SqliteParam[] = [];
    for (let i = 0; i < colCount; i++) {
        const type = cursor.getType(i);
        switch (type) {
            case android.database.Cursor.FIELD_TYPE_NULL:
                data.push(null);
                break;

            case android.database.Cursor.FIELD_TYPE_STRING:
                data.push(cursor.getString(i));
                break;

            case android.database.Cursor.FIELD_TYPE_FLOAT:
                data.push(cursor.getDouble(i));
                break;

            case android.database.Cursor.FIELD_TYPE_INTEGER:
                data.push(cursor.getDouble(i));
                break;

            default:
                throwError(`unknown.type: ${type}`);
        }
    }
    return data;
};

const rawSql = <T>(onCursor: FromCursor<T>) => (db: Db) => (sql: string, params?: SqliteParams) => {
    const parameters = paramsToStringArray(params) as string[];
    const cursor = db.rawQuery(sql, parameters);
    try {
        const result: T[] = [];
        while (cursor.moveToNext()) {
            result.push(onCursor(cursor));
        }
        return result;
    } finally {
        cursor.close();
    }
};
const eachRaw = <T>(onCursor: FromCursor<T>) => (db: Db) => (
    sql: string,
    params: SqliteParams,
    callback: (error: Error, result: T) => void,
    complete: (error: Error, count: number) => void
) => {
    const parameters = paramsToStringArray(params);
    const cursor = db.rawQuery(sql, parameters as string[]);
    return Promise.resolve()
        .then(() => {
            const count = 0;
            while (cursor.moveToNext()) {
                const result = onCursor(cursor);
                callback(null, result);
            }
            cursor.close();
            complete && complete(null, count);
            return count;
        })
        .catch((err) => {
            cursor.close();
            const errorCB = complete || callback;
            if (errorCB) {
                errorCB(err, null);
            }
            return Promise.reject(err);
        });
};

const transactionRaw = <T = any>(db: Db, action: (cancel?: () => void) => T) => {
    db.beginTransaction();
    try {
        const cancelled = { value: false };
        const cancel = () => {
            cancelled.value = true;
        };
        const result = action(cancel);
        if (!cancelled.value) {
            db.setTransactionSuccessful();
        }
        return result;
    } finally {
        db.endTransaction();
    }
};

const messagePromises: { [key: string]: { resolve: Function; reject: Function; timeoutTimer: NodeJS.Timer }[] } = {};

export class SQLiteDatabaseBase {
    db: android.database.sqlite.SQLiteDatabase;
    flags;
    constructor(public filePath: string, options?: {
        threading?: boolean;
        readOnly?: boolean;
        flags?: number;
    }) {
        this.threading = options && options.threading === true;
        this.flags = options?.flags;
    }
    _isInTransaction = false;
    threading = false;
    worker: Worker;
    onWorkerMessage(event: {
        data: {
            result?: any;
            error?: any;
            id?: number;
        };
    }) {
        const data = event.data;
        const id = data.id;
        // console.log('onWorkerMessage', id, data);

        if (id && messagePromises.hasOwnProperty(id)) {
            messagePromises[id].forEach(function (executor) {
                executor.timeoutTimer && clearTimeout(executor.timeoutTimer);
                // console.log('resolving worker message', id, data);
                if (data.error) {
                    executor.reject(data.error);
                } else {
                    executor.resolve(data.result);
                }
                // }
            });
            delete messagePromises[id];
        }
    }
    lastId: number;
    sendMessageToWorker(
        nativeData,
        messageData,
        timeout = 0
    ): Promise<{
            id: number;
            nativeDatas?: { [k: string]: any };
            [k: string]: any;
        }> {
        return new Promise((resolve, reject) => {
            let id = Date.now().valueOf();
            if (id <= this.lastId ) {
                id = this.lastId+1;
            }
            this.lastId= id;
            messagePromises[id] = messagePromises[id] || [];
            let timeoutTimer;
            if (timeout > 0) {
                timeoutTimer = setTimeout(() => {
                    // we need to try catch because the simple fact of creating a new Error actually throws.
                    // so we will get an uncaughtException
                    try {
                        reject(new Error('timeout'));
                    } catch {}
                    delete messagePromises[id];
                }, timeout);
            }
            messagePromises[id].push({ resolve, reject, timeoutTimer });

            const keys = Object.keys(nativeData);
            keys.forEach((k) => {
                (com as any).akylas.sqlite.WorkersContext.setValue(`${id}_${k}`, nativeData[k]._native || nativeData[k]);
            });
            // console.log('sending message to worker', messageData, keys);
            const mData = Object.assign(
                {
                    type: 'call',
                    id,
                    nativeDataKeys: keys,
                },
                messageData
            );
            this.worker.postMessage(mData);
        });
    }
    get isOpen() {
        return this.db && this.db.isOpen();
    }

    async close() {
        if (!this.isOpen) return;
        if (this.worker) {
            this.worker.postMessage({
                type: 'terminate',
            });
            this.worker = null;
        }
        this.db.close();
        // sqlite3_close_v2(db);
        this.db = null;
    }
    async setVersion(version: number) {
        this.db.setVersion(version);
    }
    async getVersion() {
        return this.db.getVersion();
    }
    async execute(query: string, params?: SqliteParams) {
        if (this.threading) {
            return this.sendMessageToWorker(
                {
                    db: this.db,
                },
                {
                    callName: 'execute',
                    args: [query, params],
                }
            );
        }
        return this.db.execSQL(query, paramsToStringArray(params));
    }
    async get(query: string, params?: SqliteParams) {
        if (this.threading) {
            return this.sendMessageToWorker(
                {
                    db: this.db,
                },
                {
                    callName: 'get',
                    args: [query, params],
                }
            );
        }
        return rawSql(dataFromCursor)(this.db)(query, params)[0] || null;
    }
    async getArray(query: string, params?: SqliteParams) {
        if (this.threading) {
            return this.sendMessageToWorker(
                {
                    db: this.db,
                },
                {
                    callName: 'getArray',
                    args: [query, params],
                }
            );
        }
        return rawSql(arrayFromCursor)(this.db)(query, params)[0] || null;
    }
    async select(query: string, params?: SqliteParams) {
        if (this.threading) {
            return this.sendMessageToWorker(
                {
                    db: this.db,
                },
                {
                    callName: 'select',
                    args: [query, params],
                }
            );
        }
        return rawSql(dataFromCursor)(this.db)(query, params);
    }
    async selectArray(query: string, params?: SqliteParams) {
        if (this.threading) {
            return this.sendMessageToWorker(
                {
                    db: this.db,
                },
                {
                    callName: 'selectArray',
                    args: [query, params],
                }
            );
        }
        return rawSql(arrayFromCursor)(this.db)(query, params);
    }
    async each(
        query: string,
        params: SqliteParams,
        callback: (error: Error, result: any) => void,
        complete: (error: Error, count: number) => void
    ) {
        return eachRaw(dataFromCursor)(this.db)(query, params, callback, complete);
    }
    transaction<T = any>(action: (cancel?: () => void) => T): T {
        return transactionRaw(this.db, action);
    }
}

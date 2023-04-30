
import { SqliteParam, SqliteParams, SqliteRow, paramsToStringArray, throwError } from './sqlite.common';

type Db = android.database.sqlite.SQLiteDatabase;

type FromCursor<T> = (cursor: android.database.Cursor, transformBlobs?: boolean) => T;

export function byteArrayToBuffer(value) {
    if (!value) {
        return null;
    }
    const length = value.length;
    const ret = new Uint8Array(length);
    const isString = typeof value === 'string';
    for (let i = 0; i < length; i++) {
        ret[i] = isString ? value.charCodeAt(i) : value[i];
    }
    return ret;
}

const dataFromCursor = (cursor: android.database.Cursor, transformBlobs?: boolean) => {
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
                data[name] = transformBlobs ? byteArrayToBuffer(cursor.getBlob(i)): cursor.getBlob(i);
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
const arrayFromCursor = (cursor: android.database.Cursor, transformBlobs?: boolean) => {
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
            case android.database.Cursor.FIELD_TYPE_BLOB:
                data.push(transformBlobs ? byteArrayToBuffer(cursor.getBlob(i)): cursor.getBlob(i));
                break;

            case android.database.Cursor.FIELD_TYPE_NULL:
                data.push( null);
                break;

            default:
                throwError(`unknown.type: ${type}`);
        }
    }
    return data;
};

const rawSql = <T>(onCursor: FromCursor<T>) => (db: Db, transformBlobs?: boolean) => (sql: string, params?: SqliteParams) => {
    const parameters = paramsToStringArray(params) as string[];
    const cursor = db.rawQuery(sql, parameters);
    try {
        const result: T[] = [];
        while (cursor.moveToNext()) {
            result.push(onCursor(cursor, transformBlobs));
        }
        return result;
    } finally {
        cursor.close();
    }
};
const eachRaw = <T>(onCursor: FromCursor<T>) => (db: Db, transformBlobs?: boolean) => (
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
                const result = onCursor(cursor, transformBlobs);
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

const transactionRaw = async <T = any>(db: Db, action: ( (cancel?: () => void) => Promise<T>)) => {
    db.beginTransaction();
    try {
        const cancelled = { value: false };
        const cancel = () => {
            cancelled.value = true;
        };
        const result = await action(cancel);
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
    transformBlobs: boolean;
    constructor(public filePath: string, options?: {
        threading?: boolean;
        readOnly?: boolean;
        flags?: number;
        transformBlobs?: boolean;
    }) {
        this.threading = options && options.threading === true;
        this.flags = options?.flags;
        this.transformBlobs = !options || options.transformBlobs !== false;
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

        if (id && messagePromises.hasOwnProperty(id)) {
            messagePromises[id].forEach(function (executor) {
                executor.timeoutTimer && clearTimeout(executor.timeoutTimer);
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
    ): Promise<any> {
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
            const mData = Object.assign(
                {
                    type: 'call',
                    id,
                    dbOptions: {
                        transformBlobs:this.transformBlobs
                    },
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

     close() {
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
     getVersion() {
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
    async get(query: string, params?: SqliteParams, transformBlobs?: boolean) {
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
        return rawSql(dataFromCursor)(this.db, transformBlobs ?? this.transformBlobs)(query, params)[0] || null;
    }
    async getArray(query: string, params?: SqliteParams, transformBlobs?: boolean) {
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
        return rawSql(arrayFromCursor)(this.db, transformBlobs ?? this.transformBlobs)(query, params)[0] || null;
    }
    async select(query: string, params?: SqliteParams, transformBlobs?: boolean) {
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
        return rawSql(dataFromCursor)(this.db, transformBlobs ?? this.transformBlobs)(query, params);
    }
    async selectArray(query: string, params?: SqliteParams, transformBlobs?: boolean) {
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
        return rawSql(arrayFromCursor)(this.db, transformBlobs ?? this.transformBlobs)(query, params);
    }
    async each(
        query: string,
        params: SqliteParams,
        callback: (error: Error, result: any) => void,
        complete: (error: Error, count: number) => void,
        transformBlobs?: boolean
    ) {
        return eachRaw(dataFromCursor)(this.db, transformBlobs ?? this.transformBlobs)(query, params, callback, complete);
    }
    async transaction<T = any>(action: (cancel?: () => void) => Promise<T>): Promise<T> {
        return transactionRaw(this.db, action);
    }
}

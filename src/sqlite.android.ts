import {
    SqliteRow,
    SqliteParam,
    SqliteParams,
    paramsToStringArray,
    throwError,
} from "./sqlite.common";

import * as application from "@nativescript/core/application";

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

const rawSql = <T>(onCursor: FromCursor<T>) => (
    db: Db,
    log?: typeof console.log
) => (sql: string, params?: SqliteParams) => {
    const parameters = paramsToStringArray(params);
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
const eachRaw = <T>(onCursor: FromCursor<T>) => (
    db: Db,
    log?: typeof console.log
) => (
    sql: string,
    params: SqliteParams,
    callback: (error: Error, result: T) => void,
    complete: (error: Error, count: number) => void
) => {
    const parameters = paramsToStringArray(params);
    const cursor = db.rawQuery(sql, parameters);
    return Promise.resolve()
        .then(() => {
            let count = 0;
            while (cursor.moveToNext()) {
                const result = onCursor(cursor);
                callback(null, result);
            }
            cursor.close();
            complete && complete(null, count);
            return count;
        })
        .catch(err => {
            cursor.close();
            let errorCB = complete || callback;
            if (errorCB) {
                errorCB(err, null);
            }
            return Promise.reject(err);
        });
};

const transactionRaw = <T = any>(
    db: Db,
    action: (cancel?: () => void) => T
) => {
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

function createDb(dbName: string, flags) {
    if (dbName === ":memory:") {
        //noinspection JSUnresolvedVariable
        return android.database.sqlite.SQLiteDatabase.create(flags);
    }
    if (dbName.indexOf("/") >= 0) {
        return android.database.sqlite.SQLiteDatabase.openDatabase(
            dbName,
            null,
            flags ||
                android.database.sqlite.SQLiteDatabase.CREATE_IF_NECESSARY |
                    android.database.sqlite.SQLiteDatabase
                        .NO_LOCALIZED_COLLATORS
        );
    } else {
        //noinspection JSUnresolvedVariable,JSUnresolvedFunction
        const activity =
            application.android.foregroundActivity ||
            application.android.startActivity;
        return activity.openOrCreateDatabase(
            dbName,
            flags | activity.MODE_PRIVATE,
            null
        );
    }
}

export class SQLiteDatabase {
    db: android.database.sqlite.SQLiteDatabase;
    constructor(public filePath: string, public flags?: number) {}
    get isOpen() {
        return this.db.isOpen();
    }
    async open() {
        if (!this.db) {
            this.db = createDb(this.filePath, this.flags);
        }
        // if (!this.isOpen) {
        // }
        return this.isOpen;
    }
    async close() {
        if (!this.isOpen) return;
        this.db.close();
        // sqlite3_close_v2(db);
        this.db = null;
    }
    async setVersion(version: number) {
        this.db.setVersion(version);
        // const query = "PRAGMA user_version=" + (version + 0).toString();
        // execRaw(this.db, query);
    }
    async getVersion() {
        // const query = "PRAGMA user_version";
        // const result = this.getArray(query);
        // return result && (result[0] as number);
        return this.db.getVersion();
    }
    async execute(query: string, params?: SqliteParams) {
        return this.db.execSQL(query, paramsToStringArray(params));
    }
    async get(query: string, params?: SqliteParams) {
        return rawSql(dataFromCursor)(this.db)(query, params)[0] || null;
    }
    async getArray(query: string, params?: SqliteParams) {
        return rawSql(arrayFromCursor)(this.db)(query, params)[0] || null;
    }
    async select(query: string, params?: SqliteParams) {
        return rawSql(dataFromCursor)(this.db)(query, params);
    }
    async selectArray(query: string, params?: SqliteParams) {
        return rawSql(arrayFromCursor)(this.db)(query, params);
    }
    async each(
        query: string,
        params: SqliteParams,
        callback: (error: Error, result: any[]) => void,
        complete: (error: Error, count: number) => void
    ) {
        return eachRaw(arrayFromCursor)(this.db)(
            query,
            params,
            callback,
            complete
        );
    }
    _isInTransaction = false;
    transaction<T = any>(action: (cancel?: () => void) => T): T {
        return transactionRaw(this.db, action);
    }
}

export const openOrCreate = (
    filePath: string,
    flags?: number
): SQLiteDatabase => {
    const obj = new SQLiteDatabase(filePath);
    obj.open();
    return obj;
};

export const deleteDatabase = (filePath: string) =>
    android.database.sqlite.SQLiteDatabase.deleteDatabase(
        new java.io.File(filePath)
    );

export type SqliteParam = null | number | string;

export type SqliteParams = SqliteParam | SqliteParam[];

export type SqliteRow = {
    [name: string]: SqliteParam;
};
type Db = android.database.sqlite.SQLiteDatabase;

type SqliteUpgrade = (db: Db) => void;

export interface SQLiteDatabase {
    getVersion: () => number;

    setVersion: (version: number) => void;

    isOpen: () => boolean;

    close: () => void;

    select: (query: string, params?: SqliteParams) => SqliteRow[];

    selectArray: (query: string, params?: SqliteParams) => SqliteParams[][];

    execute(query: string, params?: SqliteParams): void;

    transaction<T = any>(action: (cancel?: () => void) => T): T;
}

const isNothing = (x: any) => x === undefined || x === null;

const paramToString = (p: SqliteParam) => (isNothing(p) ? null : p.toString());

const paramsToStringArray = (params?: SqliteParams) => {
    if (isNothing(params)) {
        return [];
    }
    if (params instanceof Array) {
        return params.map(paramToString);
    }
    return [paramToString(params)];
};

type FromCursor<T> = (cursor: android.database.Cursor) => T;

const dataFromCursor = (cursor: android.database.Cursor) => {
    const colCount = cursor.getColumnCount();
    const data: SqliteRow = {};
    for (let i = 0; i < colCount; i++) {
        const type = cursor.getType(i);
        const name = cursor.getColumnName(i);
        switch (type) {
            case android.database.Cursor.FIELD_TYPE_NULL:
                data[name] = null;
                break;

            case android.database.Cursor.FIELD_TYPE_STRING:
                data[name] = cursor.getString(i);
                break;

            case android.database.Cursor.FIELD_TYPE_FLOAT:
                data[name] = cursor.getDouble(i);
                break;

            case android.database.Cursor.FIELD_TYPE_INTEGER:
                data[name] = cursor.getDouble(i);
                break;

            default:
                throw new Error("sqlite.unknown.type:" + type);
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
                throw new Error("sqlite.unknown.type:" + type);
        }
    }
    return data;
};

const rawSql = <T>(onCursor: FromCursor<T>) => (
    db: Db,
    log?: typeof console.log
) => (sql: string, params?: SqliteParams) => {
    const parameters = paramsToStringArray(params);
    // l(log)('SQL: QUERY: ', sql, capString(JSON.stringify(parameters), 240));
    const cursor = db.rawQuery(sql, parameters);
    try {
        const result: T[] = [];
        while (cursor.moveToNext()) {
            result.push(onCursor(cursor));
        }
        // l(log)(`SQL: QUERY-RESULT: ${result.length} rows`);
        return result;
    } finally {
        cursor.close();
    }
};

const transact = <T = any>(db: Db, action: (cancel?: (() => void)) => T) => {
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
    // } catch (error) {
    //     console.log("Transaction failed due to: " + error);
    } finally {
        db.endTransaction();
    }
};

export const openOrCreate = (filePath: string): SQLiteDatabase => {
    const db = android.database.sqlite.SQLiteDatabase.openOrCreateDatabase(
        filePath,
        null
    );
    const getVersion = () => db.getVersion();
    const close = () => db.close();
    const isOpen = () => db.isOpen();
    const setVersion = version => db.setVersion(version);
    const select = (query: string, params?: SqliteParams) =>
        rawSql(dataFromCursor)(db)(query, params);
    const selectArray = (query: string, params?: SqliteParams) =>
        rawSql(arrayFromCursor)(db)(query, params);
    const execute = (query: string, params?: SqliteParams) =>
        db.execSQL(query, paramsToStringArray(params));
    const transaction = <T = any>(action: (cancel?: () => void) => T) =>
        transact(db, action);

    return {
        getVersion,
        close,
        isOpen,
        setVersion,
        select,
        selectArray,
        execute,
        transaction,
    };
};

export const deleteDatabase = (filePath: string) =>
    android.database.sqlite.SQLiteDatabase.deleteDatabase(
        new java.io.File(filePath)
    );

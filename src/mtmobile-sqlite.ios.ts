import {
    SQLiteDatabase,
    SqliteParams,
    paramsToStringArray,
    SqliteRow,
} from "./mtmobile-sqlite.common";
import { SqliteParam } from ".";

declare const sqlitehelper: { getTrans: () => interop.FunctionReference<any> };

type DbPtr = interop.Reference<any>;

const throwError = (msg: string) => {
    throw `MtMobile-Sqlite-Error on ${msg}`;
};

const iosProperty = <T extends any>(_self, property: T): T => {
    if (typeof property === "function") {
        // xCode < 8
        return property.call(_self);
    } else {
        // xCode >= 8
        return property;
    }
};

const toCharPtr = (str: string) => {
    const objcStr = NSString.stringWithString(str);
    const size = strlen(objcStr.UTF8String) + 1;
    const buffer = interop.alloc(size) as any;
    objcStr.getCStringMaxLengthEncoding(buffer, size, NSUTF8StringEncoding);
    return buffer;
};

class CursorStatement {
    built: boolean;
    columns: any[];
    count: number;
    constructor(public statement, public resultType?, public valuesType?) {
        // this.statement = statement;
        // this.resultType = resultType;
        // this.valuesType = valuesType;
        this.built = false;
        this.columns = [];
    }
}

const getValues = (statement: interop.Reference<any>, column: number) => {
    const resultType = sqlite3_column_type(statement, column);
    console.log("resultType: " + resultType);
    switch (resultType) {
        case 1: // Int
            return sqlite3_column_int64(statement, column);
        case 2: // Float
            return sqlite3_column_double(statement, column);
        case 4: // Blob
            return NSData.dataWithBytesLength(
                sqlite3_column_blob(statement, column),
                sqlite3_column_bytes(statement, column)
            );
        case 5: // Null
            return null;
        case 3: // Text
        default:
            return NSString.stringWithUTF8String(
                sqlite3_column_text(statement, column)
            ).toString();
    }
};

const getValuesAsString = (
    statement: interop.Reference<any>,
    column: number
) => {
    const resultType = sqlite3_column_type(statement, column);
    console.log("resultType: " + resultType);
    switch (resultType) {
        case 4: // Blob
            return NSData.dataWithBytesLength(
                sqlite3_column_blob(statement, column),
                sqlite3_column_bytes(statement, column)
            );
        case 5: // Null
            return null;
        case 1: // Int
        case 2: // Float
        case 3: // Text
        default:
            return NSString.stringWithUTF8String(
                sqlite3_column_text(statement, column)
            ).toString();
    }
};

const getColumns = (
    statement: interop.Reference<any>,
    cursorSt: CursorStatement,
    asObject: boolean
) => {
    if (!cursorSt.built) {
        cursorSt.count = sqlite3_column_count(statement);
        if (asObject) {
            for (let index = 0; index < cursorSt.count; index++) {
                let colName = NSString.stringWithUTF8String(
                    sqlite3_column_name(statement, index)
                ).toString();
                if (!colName) {
                    colName = `column[${index}]`;
                }
                cursorSt.columns = [...cursorSt.columns, colName];
            }
        }
    }
    return cursorSt.count;
};

const getResultsAsObject = (
    statement: interop.Reference<any>,
    cursorSt: CursorStatement
): SqliteRow => {
    const count = getColumns(statement, cursorSt, true);
    if (count === 0) {
        return null;
    }
    let data = {};
    for (let index = 0; index < count; index++) {
        data[cursorSt.columns[index]] = getValues(statement, index);
    }
    console.log("Data: " + JSON.stringify(data));
    return data;
};

const getResultsAsArray = (
    statement: interop.Reference<any>,
    cursorSt: CursorStatement
): SqliteParam[] => {
    const count = getColumns(statement, cursorSt, false);
    if (count === 0) {
        return null;
    }
    let data = [];
    for (let index = 0; index < count; index++) {
        data = [...data, getValues(statement, index)];
    }
    console.log("Data: " + JSON.stringify(data));
    return data;
};

const open = (filePath: string): DbPtr => {
    const db = new interop.Reference<any>();
    const result = sqlite3_open_v2(toCharPtr(filePath), db, 65542, null);
    if (result) {
        throwError(`open: ${result}`);
    }
    return db.value;
};

const prepareStatement = (db: DbPtr, query: string) => {
    const statement = new interop.Reference<any>();
    const result = sqlite3_prepare_v2(db, query, -1, statement, null);
    if (result) {
        finalize(statement);
        throwError(`prepareStatement: ${result}`);
    }
    return statement.value as interop.Reference<any>;
};

const step = (statement: interop.Reference<any>) => {
    const result = sqlite3_step(statement);
    if (result && result !== 100 && result !== 101) {
        finalize(statement);
        throwError(`step: ${result}`);
    }
    return result;
};

const bind = (params: SqliteParams, statement: interop.Reference<any>) =>
    paramsToStringArray(params).forEach((param, i) => {
        let result;
        if (param === null) {
            result = sqlite3_bind_null(statement, i + 1);
        } else {
            result = sqlite3_bind_text(
                statement,
                i + 1,
                param,
                -1,
                sqlitehelper.getTrans()
            );
        }
        if (result) {
            finalize(statement);
            throwError(`bind: ${result}`);
        }
    });

const finalize = (statement: interop.Reference<any>) => {
    const result = sqlite3_finalize(statement);
    if (result) {
        throwError(`finalize: ${result}`);
    }
};

const getRaw = (
    db: DbPtr,
    query: string,
    params: SqliteParams,
    asObject: boolean
): SqliteRow | SqliteParam[] => {
    const statement = prepareStatement(db, query);
    bind(params, statement);
    step(statement);
    const cursorSt = new CursorStatement(statement);
    const data = asObject
        ? getResultsAsObject(statement, cursorSt)
        : getResultsAsArray(statement, cursorSt);
    finalize(statement);
    return data;
};

const selectRaw = (
    db: DbPtr,
    query: string,
    params: SqliteParams,
    asObject: boolean
): SqliteRow[] | SqliteParam[][] => {
    const statement = prepareStatement(db, query);
    bind(params, statement);
    const cursorSt = new CursorStatement(statement);
    let result;
    let rows = [];
    const getResults = asObject ? getResultsAsObject : getResultsAsArray;
    const getAll = () => {
        const result = step(statement);
        if (result === 100) {
            const row = getResults(statement, cursorSt);
            if (row) {
                rows = [...rows, row];
            }
            getAll();
        } else if (result === 101) {
            return;
        }
    };
    getAll();
    finalize(statement);
    return rows;
};

const execRaw = (db: DbPtr, query: string) => {
    const result = sqlite3_exec(db, query, null, null, null);
    if (result) {
        throwError(`exec: ${result}`);
    }
};

const transact = <T = any>(db: DbPtr, action: (cancel?: () => void) => T): T => {
    try {
        execRaw(db, "BEGIN TRANSACTION");
        const cancelled = { value: false };
        const cancel = () => {
            cancelled.value = true;
        };
        const result = action(cancel);
        if (!cancelled.value) {
            execRaw(db, "COMMIT TRANSACTION");
        }
        return result;
    } finally {
        execRaw(db, "ROLLBACK TRANSACTION");
    }
};

export const openOrCreate = (filePath: string): SQLiteDatabase => {
    let db = open(filePath);
    let _isOpen = true;

    const isOpen = () => _isOpen;
    const close = () => {
        if (!_isOpen) return;
        sqlite3_close_v2(db);
        db = null;
        _isOpen = false;
    };
    const setVersion = (version: number) => {
        const query = "PRAGMA user_version=" + (version + 0).toString();
        execute(query);
    };
    const getVersion = () => {
        const query = "PRAGMA user_version";
        const result = getArray(query);
        return result && (result[0] as number);
    };
    const execute = (query: string, params?: SqliteParams) => {
        const statement = prepareStatement(db, query);
        bind(params, statement);
        step(statement);
        finalize(statement);
    };
    const get = (query: string, params?: SqliteParams) =>
        getRaw(db, query, params, true) as SqliteRow;
    const getArray = (query: string, params?: SqliteParams) =>
        getRaw(db, query, params, false) as SqliteParam[];
    const select = (query: string, params?: SqliteParams) =>
        selectRaw(db, query, params, true) as SqliteRow[];
    const selectArray = (query: string, params?: SqliteParams) =>
        selectRaw(db, query, params, false) as SqliteParam[][];
    const transaction = <T = any>(action: (cancel?: () => void) => T): T =>
        transact(db, action);

    return {
        isOpen,
        close,
        setVersion,
        getVersion,
        execute,
        get,
        getArray,
        select,
        selectArray,
        transaction,
    };
};

export const deleteDatabase = (filePath: string) => {
    const fileManager = iosProperty(
        NSFileManager,
        NSFileManager.defaultManager
    );
    if (fileManager.fileExistsAtPath(filePath)) {
        return fileManager.removeItemAtPathError(filePath);
    }
    return true;
};

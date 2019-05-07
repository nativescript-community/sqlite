import {
    SQLiteDatabase,
    SqliteParams,
    paramsToStringArray,
    SqliteRow,
    throwError,
} from "./mtmobile-sqlite.common";
import { SqliteParam } from ".";

declare const sqlitehelper: { getTrans: () => interop.FunctionReference<any> };

type DbPtr = interop.Reference<any>;

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

interface CursorStatement {
    built: boolean;
    columns: any[];
    count: number;
    statement: interop.Reference<any>;
}

const getNewCursorStatement = (
    statement: interop.Reference<any>
): CursorStatement => ({
    statement,
    built: false,
    columns: [],
    count: undefined,
});

const getValuesAsString = (
    statement: interop.Reference<any>,
    column: number
) => {
    const type = sqlite3_column_type(statement, column);
    switch (type) {
        case 1: // Int
        case 2: // Float
        case 3: // Text
            return NSString.stringWithUTF8String(
                sqlite3_column_text(statement, column)
            ).toString();

        case 4: // Blob
            return NSData.dataWithBytesLength(
                sqlite3_column_blob(statement, column),
                sqlite3_column_bytes(statement, column)
            );

        case 5: // Null
            return null;

        default:
            throwError(`unknown.type: ${type}`);
    }
};

const getValues = (statement: interop.Reference<any>, column: number) => {
    const type = sqlite3_column_type(statement, column);
    switch (type) {
        case 1: // Int
            return sqlite3_column_int64(statement, column);

        case 2: // Float
            return sqlite3_column_double(statement, column);

        case 3: // Text
            return NSString.stringWithUTF8String(
                sqlite3_column_text(statement, column)
            ).toString();

        case 4: // Blob
            return NSData.dataWithBytesLength(
                sqlite3_column_blob(statement, column),
                sqlite3_column_bytes(statement, column)
            );

        case 5: // Null
            return null;

        default:
            throwError(`unknown.type: ${type}`);
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
                if (!colName || cursorSt.columns.indexOf(colName) >= 0) {
                    colName = `column[${index}]`;
                }
                cursorSt.columns = [...cursorSt.columns, colName];
            }
        }
        cursorSt.built = true;
    }
    return cursorSt.count;
};

const getResultsAsObject = (cursorSt: CursorStatement): SqliteRow => {
    const count = getColumns(cursorSt.statement, cursorSt, true);
    if (!count) {
        return null;
    }
    let data = {};
    for (let index = 0; index < count; index++) {
        data[cursorSt.columns[index]] = getValues(cursorSt.statement, index);
    }
    return data;
};

const getResultsAsArray = (cursorSt: CursorStatement): SqliteParam[] => {
    const count = getColumns(cursorSt.statement, cursorSt, false);
    if (count === 0) {
        return null;
    }
    let data = [];
    for (let index = 0; index < count; index++) {
        data = [...data, getValues(cursorSt.statement, index)];
    }
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
    const cursorSt = getNewCursorStatement(statement);
    bind(params, statement);
    const result = step(statement);
    let data;
    if (result === 100) {
        data = asObject
            ? getResultsAsObject(cursorSt)
            : getResultsAsArray(cursorSt);
    }
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
    const cursorSt = getNewCursorStatement(statement);
    bind(params, statement);
    let rows = [];
    const getResults = asObject ? getResultsAsObject : getResultsAsArray;
    const getAll = () => {
        const result = step(statement);
        if (result === 100) {
            const row = getResults(cursorSt);
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

const execRaw = (db: DbPtr, query: string, params?: SqliteParams) => {
    const statement = prepareStatement(db, query);
    bind(params, statement);
    step(statement);
    finalize(statement);
};

const transactionRaw = <T = any>(
    db: DbPtr,
    action: (cancel?: () => void) => T,
    isFirstTransaction: boolean,
): T => {
    try {
        if (isFirstTransaction) {
            execRaw(db, "BEGIN EXCLUSIVE TRANSACTION");
        }
        const cancelled = { value: false };
        const cancel = () => {
            cancelled.value = true;
        };
        const result = action(cancel);
        if (!cancelled.value && isFirstTransaction) {
            execRaw(db, "COMMIT TRANSACTION");
        } else if (cancelled.value && isFirstTransaction) {
            execRaw(db, "ROLLBACK TRANSACTION");
        }
        return result;
    } catch (e) {
        if (isFirstTransaction) {
            execRaw(db, "ROLLBACK TRANSACTION");
        }
        throwError(`transaction: ${e}`);
    }
};

export const openOrCreate = (filePath: string): SQLiteDatabase => {
    let db = open(filePath);
    let _isOpen = true;
    let _isInTransaction = false;

    const isOpen = () => _isOpen;
    const close = () => {
        if (!_isOpen) return;
        sqlite3_close_v2(db);
        db = null;
        _isOpen = false;
    };
    const setVersion = (version: number) => {
        const query = "PRAGMA user_version=" + (version + 0).toString();
        execRaw(db, query);
    };
    const getVersion = () => {
        const query = "PRAGMA user_version";
        const result = getArray(query);
        return result && (result[0] as number);
    };
    const execute = (query: string, params?: SqliteParams) =>
        execRaw(db, query, params);
    const get = (query: string, params?: SqliteParams) =>
        (getRaw(db, query, params, true) || null) as SqliteRow;
    const getArray = (query: string, params?: SqliteParams) =>
        (getRaw(db, query, params, false) || null) as SqliteParam[];
    const select = (query: string, params?: SqliteParams) =>
        selectRaw(db, query, params, true) as SqliteRow[];
    const selectArray = (query: string, params?: SqliteParams) =>
        selectRaw(db, query, params, false) as SqliteParam[][];
    const transaction = <T = any>(action: (cancel?: () => void) => T): T => {
        let res;
        if (!_isInTransaction) {
            _isInTransaction = true;
            res = transactionRaw(db, action, true);
            _isInTransaction = false;
        } else {
            res = transactionRaw(db, action, false);
        }
        return res;
    };

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
    return false;
};

import {
    SqliteParam,
    SqliteParams,
    paramsToStringArray,
    SqliteRow,
    throwError,
} from "./sqlite.common";
import { File, knownFolders } from "@nativescript/core/file-system";
// declare const sqlitehelper: { getTrans: () => interop.FunctionReference<any> };

// type FMDatabase = interop.Reference<any>;

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

// const getValuesAsString = (
//     statement: interop.Reference<any>,
//     column: number
// ) => {
//     const type = sqlite3_column_type(statement, column);
//     switch (type) {
//         case 1: // Int
//         case 2: // Float
//         case 3: // Text
//             return NSString.stringWithUTF8String(
//                 sqlite3_column_text(statement, column)
//             ).toString();

//         case 4: // Blob
//             return NSData.dataWithBytesLength(
//                 sqlite3_column_blob(statement, column),
//                 sqlite3_column_bytes(statement, column)
//             );

//         case 5: // Null
//             return null;

//         default:
//             throwError(`unknown.type: ${type}`);
//     }
// };

// const getValues = (statement: FMResultSet, column: number) => {
//     const type = statement.;
//     switch (type) {
//         case 1: // Int
//             return sqlite3_column_int64(statement, column);

//         case 2: // Float
//             return sqlite3_column_double(statement, column);

//         case 3: // Text
//             return NSString.stringWithUTF8String(
//                 sqlite3_column_text(statement, column)
//             ).toString();

//         case 4: // Blob
//             return NSData.dataWithBytesLength(
//                 sqlite3_column_blob(statement, column),
//                 sqlite3_column_bytes(statement, column)
//             );

//         case 5: // Null
//             return null;

//         default:
//             throwError(`unknown.type: ${type}`);
//             return null;
//     }
// };

// const getColumns = (
//     statement: interop.Reference<any>,
//     cursorSt: CursorStatement,
//     asObject: boolean
// ) => {
//     if (!cursorSt.built) {
//         cursorSt.count = sqlite3_column_count(statement);
//         if (asObject) {
//             for (let index = 0; index < cursorSt.count; index++) {
//                 let colName = NSString.stringWithUTF8String(
//                     sqlite3_column_name(statement, index)
//                 ).toString();
//                 if (!colName || cursorSt.columns.indexOf(colName) >= 0) {
//                     colName = `column[${index}]`;
//                 }
//                 cursorSt.columns = [...cursorSt.columns, colName];
//             }
//         }
//         cursorSt.built = true;
//     }
//     return cursorSt.count;
// };

const getResultsAsObject = (cursorSt: FMResultSet): SqliteRow => {
    // const count = cursorSt.columnCount;
    // if (!count) {
    //     return null;
    // }
    let data = {};
    const dict = cursorSt.resultDictionary;
    dict.enumerateKeysAndObjectsUsingBlock((key: any, value: any) => {
        data[key] = value;
    });
    // for (let index = 0; index < count; index++) {
    //     data[cursorSt.columnNameForIndex(index)] = getValues(cursorSt, index);
    // }
    return data;
};

const getResultsAsArray = (cursorSt: FMResultSet): SqliteParam[] => {
    let data = [];
    const dict = cursorSt.resultDictionary;
    dict.enumerateKeysAndObjectsUsingBlock((key: any, value: any) => {
        data.push(value);
    });
    // for (let index = 0; index < count; index++) {
    //     data[cursorSt.columnNameForIndex(index)] = getValues(cursorSt, index);
    // }
    return data;
};

function getRealPath(dbname: string, create = false) {
    if (dbname === ":memory:") {
        return null;
    }
    return dbname;
    // if (dbname !== "") {
    //     let actualPath;
    //     if (dbname.indexOf("/") === -1) {
    //         actualPath = knownFolders.documents().path;
    //         dbname = actualPath + "/" + dbname;
    //     } else {
    //         actualPath = dbname.substr(0, dbname.lastIndexOf("/") + 1);
    //     }
    //     // Create "databases" folder if it is missing.  This causes issues on Emulators if it is missing
    //     // So we create it if it is missing
    //     // try {
    //     //     // noinspection JSUnresolvedVariable
    //     //     if (!File.exists(actualPath) && create) {
    //     //         //noinspection JSUnresolvedFunction
    //     //         const fileManager = iosProperty(
    //     //             NSFileManager,
    //     //             NSFileManager.defaultManager
    //     //         );
    //     //         //noinspection JSUnresolvedFunction
    //     //         if (
    //     //             !fileManager.createDirectoryAtPathWithIntermediateDirectoriesAttributesError(
    //     //                 actualPath,
    //     //                 true,
    //     //                 null
    //     //             )
    //     //         ) {
    //     //             console.warn(
    //     //                 "SQLITE.CONSTRUCTOR - Creating DB Folder Error"
    //     //             );
    //     //         }
    //     //     }
    //     // } catch (err) {
    //     //     console.warn("SQLITE.CONSTRUCTOR - Creating DB Folder Error", err);
    //     // }
    //     return actualPath;
    // }
}

// function open(filePath: string, flags?: number, readOnly?: boolean): FMDatabase {
//     const db = new interop.Reference<any>();
//     console.log("open", filePath, flags, readOnly, getRealPath(filePath));
//     const result = sqlite3_open_v2(
//         toCharPtr(getRealPath(filePath)),
//         db,
//         (readOnly === true ? 65537 : 65542) | flags,
//         null
//     );
//     if (result) {
//         throwError(`open: ${result}`);
//     }
//     return db.value;
// }

// function prepareStatement(db: FMDatabase, query: string) {
//     const statement = new interop.Reference<any>();
//     const result = sqlite3_prepare_v2(db, query, -1, statement, null);
//     if (result) {
//         throwError(`prepareStatement: ${result}`);
//     }
//     return statement.value as interop.Reference<any>;
// }

// function step(statement: interop.Reference<any>) {
//     const result = sqlite3_step(statement);
//     if (result && result !== 100 && result !== 101) {
//         finalize(statement);
//         throwError(`step: ${result}`);
//     }
//     return result;
// }

// function bind(params: SqliteParams, statement: interop.Reference<any>) {
//     paramsToStringArray(params).forEach((param, i) => {
//         let result;
//         if (param === null) {
//             result = sqlite3_bind_null(statement, i + 1);
//         } else {
//             result = sqlite3_bind_text(
//                 statement,
//                 i + 1,
//                 param,
//                 -1,
//                 sqlitehelper.getTrans()
//             );
//         }
//         if (result) {
//             finalize(statement);
//             throwError(`bind: ${result}`);
//         }
//     });
// }

// function finalize(statement: interop.Reference<any>) {
//     const result = sqlite3_finalize(statement);
//     if (result) {
//         throwError(`finalize: ${result}`);
//     }
// }

function getRaw(
    db: FMDatabase,
    query: string,
    params: SqliteParams,
    asObject: boolean
): SqliteRow | SqliteParam[] {
    // const statement = prepareStatement(db, query);
    // const cursorSt = getNewCursorStatement(statement);
    // bind(params, statement);
    // const result = step(statement);
    // let data;
    // if (result === 100) {
    //     data = asObject
    //         ? getResultsAsObject(cursorSt)
    //         : getResultsAsArray(cursorSt);
    // }
    // finalize(statement);
    // return data;

    const s = db.executeQueryWithArgumentsInArray(
        query,
        paramsToStringArray(params)
    );
    if (s) {
        return asObject ? getResultsAsObject(s) : getResultsAsArray(s);
        // while (s.next()) {
        //     //retrieve values for each record
        //     const row = getResults(s);
        //     if (row) {
        //         rows = [...rows, row];
        //     }
        // }
    } else {
        throw db.lastError();
    }
}

function eachRaw(
    db: FMDatabase,
    query: string,
    params: SqliteParams,
    asObject: boolean,
    callback: (error: Error, result: SqliteRow | SqliteParam[]) => void,
    complete: (error: Error, count: number) => void
) {
    // const statement = prepareStatement(db, query);
    // const cursorSt = getNewCursorStatement(statement);
    // bind(params, statement);
    // let rows = [];
    const getResults = asObject ? getResultsAsObject : getResultsAsArray;

    return Promise.resolve()
        .then(() => {
            let count = 0;
            const s = db.executeQueryWithArgumentsInArray(
                query,
                paramsToStringArray(params)
            );
            if (s) {
                while (s.next()) {
                    //retrieve values for each record
                    const row = getResults(s);
                    if (row) {
                        count++;
                        callback(null, row);
                    }
                }
            } else {
                throw db.lastError();
            }

            // while (true) {
            //     const result = step(statement);
            //     if (result === 100) {
            //         const row = getResults(cursorSt);
            //         if (row) {
            //             count++;
            //             callback(null, row);
            //         }
            //     } else if (result && result !== 101) {
            //         finalize(statement);
            //         throw new Error("db_error " + result);
            //     } else {
            //         break;
            //     }
            // }
            // finalize(statement);
            complete && complete(null, count);
            return count;
        })
        .catch(err => {
            let errorCB = complete || callback;
            if (errorCB) {
                errorCB(err, null);
            }
            return Promise.reject(err);
        });

    // return rows;
}
function selectRaw(
    db: FMDatabase,
    query: string,
    params: SqliteParams,
    asObject: boolean
): SqliteRow[] | SqliteParam[][] {
    // const statement = prepareStatement(db, query);
    // const cursorSt = getNewCursorStatement(statement);
    // bind(params, statement);
    let rows = [];
    const getResults = asObject ? getResultsAsObject : getResultsAsArray;
    const s = db.executeQueryWithArgumentsInArray(
        query,
        paramsToStringArray(params)
    );
    if (s) {
        while (s.next()) {
            //retrieve values for each record
            const row = getResults(s);
            if (row) {
                rows = [...rows, row];
            }
        }
    } else {
        throw db.lastError();
    }
    // while (true) {
    //     const result = step(statement);
    //     if (result === 100) {
    //         const row = getResults(cursorSt);
    //         if (row) {
    //             rows = [...rows, row];
    //         }
    //     } else {
    //         break;
    //     }
    // }
    // finalize(statement);
    return rows;
}

function execRaw(db: FMDatabase, query: string, params?: SqliteParams) {
    // const statement = prepareStatement(db, query);
    // bind(params, statement);
    // step(statement);
    // finalize(statement);
    const s = db.executeUpdateWithArgumentsInArray(
        query,
        paramsToStringArray(params)
    );
    if (!s) {
        // while (s.next()) {
        //     //retrieve values for each record
        //     const row = getResults(s);
        //     if (row) {
        //         rows = [...rows, row];
        //     }
        // }
        // } else {
        throw db.lastError();
    }
}

function transactionRaw<T = any>(
    db: FMDatabase,
    action: (cancel?: () => void) => T,
    isFirstTransaction: boolean
): T {
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
        return null;
    }
}

export class SQLiteDatabase {
    db: FMDatabase;
    constructor(public filePath: string) {}
    isOpen = false;
    async open() {
        if (!this.db) {
            this.db = FMDatabase.databaseWithPath(getRealPath(this.filePath));
        }
        if (!this.isOpen) {
            this.isOpen = this.db.open();
        }
        return this.isOpen;
    }
    async close() {
        if (!this.isOpen) return;
        this.db.close();
        // sqlite3_close_v2(db);
        this.db = null;
        this.isOpen = false;
    }
    async setVersion(version: number) {
        this.db.userVersion = version + 0;
        // const query = "PRAGMA user_version=" + (version + 0).toString();
        // execRaw(this.db, query);
    }
    async getVersion() {
        // const query = "PRAGMA user_version";
        // const result = this.getArray(query);
        // return result && (result[0] as number);
        return this.db.userVersion;
    }
    async execute(query: string, params?: SqliteParams) {
        return execRaw(this.db, query, params);
    }
    async get(query: string, params?: SqliteParams) {
        return (getRaw(this.db, query, params, true) || null) as SqliteRow;
    }
    async getArray(query: string, params?: SqliteParams) {
        return (getRaw(this.db, query, params, false) || null) as SqliteParam[];
    }
    async select(query: string, params?: SqliteParams) {
        return selectRaw(this.db, query, params, true) as SqliteRow[];
    }
    async each(
        query: string,
        params: SqliteParams,
        callback: (error: Error, result: SqliteRow[]) => void,
        complete: (error: Error, count: number) => void
    ) {
        return eachRaw(
            this.db,
            query,
            params,
            true,
            callback as (error: Error, result: any[]) => void,
            complete
        );
    }
    async selectArray(query: string, params?: SqliteParams) {
        return selectRaw(this.db, query, params, false) as SqliteParam[][];
    }
    _isInTransaction = false;
    transaction<T = any>(action: (cancel?: () => void) => T): T {
        let res;
        if (!this._isInTransaction) {
            this._isInTransaction = true;
            res = transactionRaw(this.db, action, true);
            this._isInTransaction = false;
        } else {
            res = transactionRaw(this.db, action, false);
        }
        return res;
    }
}

export function openOrCreate(
    filePath: string,
    flags?: number,
    readOnly?: boolean
): SQLiteDatabase {
    const obj = new SQLiteDatabase(getRealPath(filePath));
    obj.open();
    return obj;

    // let db = FMDatabase.databaseWithPath(getRealPath(filePath));
    // // let db = open(filePath, flags, readOnly);
    // let _isOpen = db.open();
    // let _isInTransaction = false;

    // // const isOpen = () => _isOpen;
    // // const close = () => {
    // //     if (!_isOpen) return;
    // //     db.close();
    // //     // sqlite3_close_v2(db);
    // //     db = null;
    // //     _isOpen = false;
    // // };
    // const setVersion = (version: number) => {
    //     const query = "PRAGMA user_version=" + (version + 0).toString();
    //     execRaw(db, query);
    // };
    // const getVersion = () => {
    //     const query = "PRAGMA user_version";
    //     const result = getArray(query);
    //     return result && (result[0] as number);
    // };
    // const execute = (query: string, params?: SqliteParams) =>
    //     execRaw(db, query, params);
    // const get = (query: string, params?: SqliteParams) =>
    //     (getRaw(db, query, params, true) || null) as SqliteRow;
    // const getArray = (query: string, params?: SqliteParams) =>
    //     (getRaw(db, query, params, false) || null) as SqliteParam[];
    // const select = (query: string, params?: SqliteParams) =>
    //     selectRaw(db, query, params, true) as SqliteRow[];
    // const each = (
    //     query: string,
    //     params: SqliteParams,
    //     callback: (error: Error, result: SqliteRow[]) => void,
    //     complete: (error: Error, count: number) => void
    // ) =>
    //     eachRaw(
    //         db,
    //         query,
    //         params,
    //         true,
    //         callback as (error: Error, result: any[]) => void,
    //         complete
    //     );
    // const selectArray = (query: string, params?: SqliteParams) =>
    //     selectRaw(db, query, params, false) as SqliteParam[][];
    // const transaction = <T = any>(action: (cancel?: () => void) => T): T => {
    //     let res;
    //     if (!_isInTransaction) {
    //         _isInTransaction = true;
    //         res = transactionRaw(db, action, true);
    //         _isInTransaction = false;
    //     } else {
    //         res = transactionRaw(db, action, false);
    //     }
    //     return res;
    // };

    // return {
    //     isOpen,
    //     close,
    //     setVersion,
    //     getVersion,
    //     execute,
    //     get,
    //     getArray,
    //     select,
    //     selectArray,
    //     transaction,
    //     each,
    // };
}

export const deleteDatabase = (filePath: string) => {
    filePath = getRealPath(filePath);
    const fileManager = iosProperty(
        NSFileManager,
        NSFileManager.defaultManager
    );
    if (fileManager.fileExistsAtPath(filePath)) {
        return fileManager.removeItemAtPathError(filePath);
    }
    return false;
};

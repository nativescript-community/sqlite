export declare type SqliteParam = null | number | string;
export declare type SqliteParams = SqliteParam | SqliteParam[];
export declare type SqliteRow = {
    [name: string]: SqliteParam;
};
export declare type Db = any;
export declare type SqliteUpgrade = (db: Db) => void;
export interface SQLiteDatabase {
    getVersion: () => number;
    setVersion: (version: number) => void;
    isOpen: () => boolean;
    close: () => void;
    select: (query: string, params?: SqliteParams) => SqliteRow[];
    selectArray: (query: string, params?: SqliteParams) => SqliteParam[][];
    get: (query: string, params?: SqliteParams) => SqliteRow;
    getArray: (query: string, params?: SqliteParams) => SqliteParam[];
    execute(query: string, params?: SqliteParams): void;
    transaction<T = any>(action: (cancel?: () => void) => T): T;
    each(query: string, params: SqliteParams, callback: (error: Error, result: SqliteRow[]) => void, complete: (error: Error, count: number) => void): void;
}
export declare const paramsToStringArray: (params?: SqliteParams) => string[];
export declare const throwError: (msg: string) => never;
export declare const openOrCreate: (filePath: string) => SQLiteDatabase;
export declare const deleteDatabase: (filePath: string) => boolean;

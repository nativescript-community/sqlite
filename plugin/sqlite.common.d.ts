export declare type SqliteParam = null | number | string;
export declare type SqliteParams = SqliteParam | SqliteParam[];
export declare type SqliteRow = {
    [name: string]: SqliteParam;
};
export declare type Db = any;
export declare type SqliteUpgrade = (db: Db) => void;
export interface SQLiteDatabase {
    getVersion(): Promise<number>;
    setVersion(version: number): Promise<void>;
    isOpen(): boolean;
    close(): Promise<void>;
    select(query: string, params?: SqliteParams): Promise<SqliteRow[]>;
    selectArray(query: string, params?: SqliteParams): Promise<SqliteParam[][]>;
    get(query: string, params?: SqliteParams): Promise<SqliteRow>;
    getArray(query: string, params?: SqliteParams): Promise<SqliteParam[]>;
    execute(query: string, params?: SqliteParams): Promise<void>;
    transaction<T = any>(action: (cancel?: () => void) => T): T;
    each(query: string, params: SqliteParams, callback: (error: Error, result: SqliteRow[]) => void, complete: (error: Error, count: number) => void): Promise<void>;
}
export declare function isNothing(x: any): boolean;
export declare function paramToString(p: SqliteParam): string;
export declare function paramsToStringArray(params?: SqliteParams): string[];
export declare function throwError(msg: string): void;
export declare function openOrCreate(filePath: string, flags?: number): SQLiteDatabase;
export declare function deleteDatabase(filePath: string): boolean;

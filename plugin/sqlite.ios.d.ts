import { SqliteParam, SqliteParams, SqliteRow } from "./sqlite.common";
export declare class SQLiteDatabase {
    filePath: string;
    db: FMDatabase;
    constructor(filePath: string);
    isOpen: boolean;
    open(): Promise<boolean>;
    close(): Promise<void>;
    setVersion(version: number): Promise<void>;
    getVersion(): Promise<number>;
    execute(query: string, params?: SqliteParams): Promise<void>;
    get(query: string, params?: SqliteParams): Promise<SqliteRow>;
    getArray(query: string, params?: SqliteParams): Promise<SqliteParam[]>;
    select(query: string, params?: SqliteParams): Promise<SqliteRow[]>;
    each(query: string, params: SqliteParams, callback: (error: Error, result: SqliteRow) => void, complete: (error: Error, count: number) => void): Promise<number>;
    selectArray(query: string, params?: SqliteParams): Promise<SqliteParam[][]>;
    _isInTransaction: boolean;
    transaction<T = any>(action: (cancel?: () => void) => T): T;
}
export declare function openOrCreate(filePath: string, flags?: number, readOnly?: boolean): SQLiteDatabase;
export declare const deleteDatabase: (filePath: string) => boolean;

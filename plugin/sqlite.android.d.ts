import { SqliteRow, SqliteParam, SqliteParams } from "./sqlite.common";
export declare class SQLiteDatabase {
    filePath: string;
    flags?: number;
    db: android.database.sqlite.SQLiteDatabase;
    constructor(filePath: string, flags?: number);
    get isOpen(): boolean;
    open(): Promise<boolean>;
    close(): Promise<void>;
    setVersion(version: number): Promise<void>;
    getVersion(): Promise<number>;
    execute(query: string, params?: SqliteParams): Promise<void>;
    get(query: string, params?: SqliteParams): Promise<SqliteRow>;
    getArray(query: string, params?: SqliteParams): Promise<SqliteParam[]>;
    select(query: string, params?: SqliteParams): Promise<SqliteRow[]>;
    selectArray(query: string, params?: SqliteParams): Promise<SqliteParam[][]>;
    each(query: string, params: SqliteParams, callback: (error: Error, result: any) => void, complete: (error: Error, count: number) => void): Promise<number>;
    _isInTransaction: boolean;
    transaction<T = any>(action: (cancel?: () => void) => T): T;
}
export declare const openOrCreate: (filePath: string, flags?: number) => SQLiteDatabase;
export declare const deleteDatabase: (filePath: string) => boolean;

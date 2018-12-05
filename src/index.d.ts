export declare type SqliteParam = null | number | string;
export declare type SqliteParams = SqliteParam | SqliteParam[];
export declare type SqliteRow = {
    [name: string]: SqliteParam;
};
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
export declare const openOrCreate: (filePath: string) => SQLiteDatabase;
export declare const deleteDatabase: (filePath: string) => boolean;

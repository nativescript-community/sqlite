export type SqliteParam = null | number | string;

export type SqliteParams = SqliteParam | SqliteParam[];

export type SqliteRow = {
    [name: string]: SqliteParam;
};

export type Db = any;

export type SqliteUpgrade = (db: Db) => void;

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

    each(
        query: string,
        params: SqliteParams,
        callback: (error: Error, result: SqliteRow[]) => void,
        complete: (error: Error, count: number) => void
    ): Promise<void>;
}

export function isNothing(x: any) {
    return x === undefined || x === null;
}

export function paramToString(p: SqliteParam) {
    return isNothing(p) ? null : p.toString();
}

export function paramsToStringArray(params?: SqliteParams) {
    if (isNothing(params)) {
        return [];
    }
    if (params instanceof Array) {
        return params.map(paramToString);
    }
    return [paramToString(params)];
}

export function throwError(msg: string) {
    throw new Error(`NSqlite Error: ${msg}`);
}
export function openOrCreate(filePath: string, flags?: number): SQLiteDatabase {
    return null;
}
export function deleteDatabase(filePath: string) {
    return false;
}

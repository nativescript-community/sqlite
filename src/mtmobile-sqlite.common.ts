export type SqliteParam = null | number | string;

export type SqliteParams = SqliteParam | SqliteParam[];

export type SqliteRow = {
    [name: string]: SqliteParam;
};

export type Db = any;

export type SqliteUpgrade = (db: Db) => void;

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
}

const isNothing = (x: any) => x === undefined || x === null;

const paramToString = (p: SqliteParam) => (isNothing(p) ? null : p.toString());

export const paramsToStringArray = (params?: SqliteParams) => {
    if (isNothing(params)) {
        return [];
    }
    if (params instanceof Array) {
        return params.map(paramToString);
    }
    return [paramToString(params)];
};

export const throwError = (msg: string) => {
    throw new Error(`MtMobileSqlite Error: ${msg}`);
};

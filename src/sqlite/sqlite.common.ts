export type SqliteParam = null | number | string | ArrayBuffer | any;

export type SqliteParams = SqliteParam | SqliteParam[];

export interface SqliteRow {
    [name: string]: SqliteParam;
}

export type Db = any;

export type SqliteUpgrade = (db: Db) => void;

export interface SQLiteDatabase {
    getVersion();

    setVersion(version: number);

    isOpen: boolean;

    close();

    select(query: string, params?: SqliteParams): Promise<SqliteRow[]>;

    selectArray(query: string, params?: SqliteParams): Promise<SqliteParam[][]>;

    get(query: string, params?: SqliteParams): Promise<SqliteRow>;

    getArray(query: string, params?: SqliteParams): Promise<SqliteParam[]>;

    execute(query: string, params?: SqliteParams): Promise<void>;

    transaction<T = any>(action: (cancel?: () => void) => Promise<T>): Promise<T>;

    each(query: string, params: SqliteParams, callback: (error: Error, result: SqliteRow) => void, complete: (error: Error, count: number) => void): Promise<number>;
}

export function isNothing(x: any) {
    return x === undefined || x === null;
}
export function arrayToNativeByteArray(val) {
    const length = val.length;
    const result = Array.create('byte', length);
    for (let i = 0; i < length; i++) {
        result[i] = val[i];
    }
    return result;
}

export function paramToString(p: SqliteParam) {
    if (isNothing(p)) {
        return null;
    }
    if (global.isAndroid) {
        if (p instanceof java.nio.ByteBuffer) {
            return p.array();
        }
        if (p instanceof java.io.ByteArrayOutputStream) {
            return p.toByteArray();
        }
        if (p instanceof java.lang.Object) {
            return p;
        }
        if (p instanceof ArrayBuffer) {
            return arrayToNativeByteArray(new Uint8Array(p));
        } else if (p.buffer) {
            return arrayToNativeByteArray(p);
        } else if (Array.isArray(p)) {
            return arrayToNativeByteArray(p);
        }
    } else {
        if (p instanceof NSData) {
            return p;
        }
        if (p instanceof NSObject) {
            return p;
        }
        if (p instanceof ArrayBuffer) {
            return NSData.dataWithData(p as any);
        }
        if (p.buffer) {
            return NSData.dataWithData(p.buffer);
        }
        if (Array.isArray(p)) {
            return NSData.dataWithData(new Uint8Array(p).buffer as any);
        }
    }
    if (p.hasOwnProperty('length') && !Array.isArray(p)) {
        // native array
        return p;
    }

    if (p['toString']) {
        return p['toString']();
    }
    return p;
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

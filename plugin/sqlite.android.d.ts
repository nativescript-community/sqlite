import { SQLiteDatabase } from "./sqlite.common";
export declare const openOrCreate: (filePath: string) => SQLiteDatabase;
export declare const deleteDatabase: (filePath: string) => boolean;

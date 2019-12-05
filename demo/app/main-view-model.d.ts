import { Observable } from "@nativescript/core/data/observable";
import { SQLiteDatabase } from "nativescript-akylas-sqlite";
declare type DataExample = {
    id: number;
    name: string;
};
export declare class HelloWorldModel extends Observable {
    message: string;
    sqlite: SQLiteDatabase;
    constructor();
    resetDb(): void;
    insert(data: DataExample[]): void;
    onInsert(): void;
    onInsertWithTrans(): void;
    onSelect(): void;
    onReset(): void;
}
export {};

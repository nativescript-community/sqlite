import { ObjectLiteral } from '@nativescript-community/typeorm/browser/common/ObjectLiteral';
import { AbstractSqliteQueryRunner } from '@nativescript-community/typeorm/browser/driver/sqlite-abstract/AbstractSqliteQueryRunner';
import { NativescriptDriver } from './NativescriptDriver';
export declare class NativescriptQueryRunner extends AbstractSqliteQueryRunner {
    driver: NativescriptDriver;
    constructor(driver: NativescriptDriver);
    query(query: string, parameters?: any[]): Promise<void | {
        [k: string]: any;
        id: number;
        nativeDatas?: {
            [k: string]: any;
        };
    } | import("../sqlite.common").SqliteRow[]>;
    protected parametrize(objectLiteral: ObjectLiteral, startIndex?: number): string[];
}

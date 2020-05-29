import { ObjectLiteral } from "typeorm/browser/common/ObjectLiteral";
import { AbstractSqliteQueryRunner } from "typeorm/browser/driver/sqlite-abstract/AbstractSqliteQueryRunner";
import { NativescriptDriver } from "./NativescriptDriver";
import * as NSQlite from "../sqlite";
export declare class NativescriptQueryRunner extends AbstractSqliteQueryRunner {
    driver: NativescriptDriver;
    constructor(driver: NativescriptDriver);
    query(query: string, parameters?: any[]): Promise<void | NSQlite.SqliteRow[]>;
    protected parametrize(objectLiteral: ObjectLiteral, startIndex?: number): string[];
}

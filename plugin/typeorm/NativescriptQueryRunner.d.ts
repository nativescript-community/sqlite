import { ObjectLiteral } from "typeorm/browser/common/ObjectLiteral";
import { AbstractSqliteQueryRunner } from "typeorm/browser/driver/sqlite-abstract/AbstractSqliteQueryRunner";
import { NativescriptDriver } from "./NativescriptDriver";
import * as NSQlite from "../sqlite";
/**
 * Runs queries on a single sqlite database connection.
 */
export declare class NativescriptQueryRunner extends AbstractSqliteQueryRunner {
    /**
     * Database driver used by connection.
     */
    driver: NativescriptDriver;
    constructor(driver: NativescriptDriver);
    /**
     * Executes a given SQL query.
     */
    query(query: string, parameters?: any[]): Promise<void | NSQlite.SqliteRow[]>;
    /**
     * Parametrizes given object of values. Used to create column=value queries.
     */
    protected parametrize(objectLiteral: ObjectLiteral, startIndex?: number): string[];
}

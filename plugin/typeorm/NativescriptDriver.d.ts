import { AbstractSqliteDriver } from "typeorm/browser/driver/sqlite-abstract/AbstractSqliteDriver";
import { QueryRunner } from "typeorm/browser/query-runner/QueryRunner";
import { Connection } from "typeorm/browser/connection/Connection";
import { ColumnType } from "typeorm/browser/driver/types/ColumnTypes";
import { NativescriptConnectionOptions } from "./index";
import * as NSQlite from "../sqlite";
/**
 * Organizes communication with sqlite DBMS within Nativescript.
 */
export declare class NativescriptDriver extends AbstractSqliteDriver {
    /**
     * Connection options.
     */
    options: NativescriptConnectionOptions;
    /**
     * Nativescript driver module
     * this is most likely `nativescript-sqlite`
     * but user can pass his own
     */
    driver: any;
    constructor(connection: Connection);
    /**
     * Closes connection with database.
     */
    disconnect(): Promise<any>;
    /**
     * Creates a query runner used to execute database queries.
     */
    createQueryRunner(mode?: "master" | "slave"): QueryRunner;
    normalizeType(column: {
        type?: ColumnType;
        length?: number | string;
        precision?: number | null;
        scale?: number;
    }): string;
    /**
     * Creates connection with the database.
     *
     * nativescript-sqlite driver constructor and execSQL()/all() methods return Promise
     * Also as mentioned in nativescript-sqlite documentation:
     *
     * "You should choose either to use a promise or a callback;
     *  you can use whichever you are most comfortable with
     *  however, you CAN use both if you want;
     *  but side effects WILL occur with some functions."
     *
     *  We choose Promise. So we should use Promises, when create connection and when make query
     *  Let's use async/await
     */
    sqlite: typeof NSQlite;
    protected createDatabaseConnection(): Promise<NSQlite.SQLiteDatabase>;
    /**
     * If driver dependency is not given explicitly, then try to load it via "require".
     */
    protected loadDependencies(): void;
}
export declare class MongoDriver {
}
export declare class SqljsDriver {
}
export declare class PostgresDriver {
}
export declare class CockroachDriver {
}
export declare class MysqlDriver {
}
export declare class AuroraDataApiDriver {
}
export declare class OracleDriver {
}
export declare class SqlServerDriver {
}

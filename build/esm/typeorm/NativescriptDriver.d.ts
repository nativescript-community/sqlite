import { AbstractSqliteDriver } from "typeorm/browser/driver/sqlite-abstract/AbstractSqliteDriver";
import { QueryRunner } from "typeorm/browser/query-runner/QueryRunner";
import { Connection } from "typeorm/browser/connection/Connection";
import { ColumnType } from "typeorm/browser/driver/types/ColumnTypes";
import { NativescriptConnectionOptions } from "./index";
import * as NSQlite from "../sqlite";
export declare class NativescriptDriver extends AbstractSqliteDriver {
    options: NativescriptConnectionOptions;
    driver: any;
    constructor(connection: Connection);
    disconnect(): Promise<any>;
    createQueryRunner(mode?: "master" | "slave"): QueryRunner;
    normalizeType(column: {
        type?: ColumnType;
        length?: number | string;
        precision?: number | null;
        scale?: number;
    }): string;
    sqlite: typeof NSQlite;
    protected createDatabaseConnection(): Promise<NSQlite.SQLiteDatabase>;
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

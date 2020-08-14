import { Connection } from '@akylas/typeorm/browser/connection/Connection';
import { AbstractSqliteDriver } from '@akylas/typeorm/browser/driver/sqlite-abstract/AbstractSqliteDriver';
import { ColumnType } from '@akylas/typeorm/browser/driver/types/ColumnTypes';
import { QueryRunner } from '@akylas/typeorm/browser/query-runner/QueryRunner';
import * as NSQlite from '../sqlite';
import { NativescriptConnectionOptions } from './index';
export declare class NativescriptDriver extends AbstractSqliteDriver {
    options: NativescriptConnectionOptions;
    driver: any;
    constructor(connection: Connection);
    disconnect(): Promise<any>;
    createQueryRunner(mode?: 'master' | 'slave'): QueryRunner;
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

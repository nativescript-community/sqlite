import { Connection } from '@nativescript-community/typeorm/browser/connection/Connection';
import { AbstractSqliteDriver } from '@nativescript-community/typeorm/browser/driver/sqlite-abstract/AbstractSqliteDriver';
import { ColumnType } from '@nativescript-community/typeorm/browser/driver/types/ColumnTypes';
import { QueryRunner } from '@nativescript-community/typeorm/browser/query-runner/QueryRunner';
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

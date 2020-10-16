import { Connection } from '@nativescript-community/typeorm/browser/connection/Connection';
import { AbstractSqliteDriver } from '@nativescript-community/typeorm/browser/driver/sqlite-abstract/AbstractSqliteDriver';
import { ColumnType } from '@nativescript-community/typeorm/browser/driver/types/ColumnTypes';
import { DriverOptionNotSetError } from '@nativescript-community/typeorm/browser/error/DriverOptionNotSetError';
import { DriverPackageNotInstalledError } from '@nativescript-community/typeorm/browser/error/DriverPackageNotInstalledError';
import { QueryRunner } from '@nativescript-community/typeorm/browser/query-runner/QueryRunner';
import * as NSQlite from '../sqlite';
import { NativescriptConnectionOptions } from './index';
import { NativescriptQueryRunner } from './NativescriptQueryRunner';
/**
 * Organizes communication with sqlite DBMS within Nativescript.
 */
export class NativescriptDriver extends AbstractSqliteDriver {
    // -------------------------------------------------------------------------
    // Public Properties
    // -------------------------------------------------------------------------
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
    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------
    constructor(connection: Connection) {
        super(connection);
        this.connection = connection;
        this.options = connection.options as NativescriptConnectionOptions;
        this.database = this.options.database;
        this.driver = this.options.driver;
        // validate options to make sure everything is set
        if (!this.options.database) {
            throw new DriverOptionNotSetError('database');
        }
        // load sqlite package
        this.loadDependencies();
    }
    // -------------------------------------------------------------------------
    // Public Methods
    // -------------------------------------------------------------------------
    /**
     * Closes connection with database.
     */
    async disconnect() {
        this.queryRunner = undefined;
        return this.databaseConnection.close();
    }
    /**
     * Creates a query runner used to execute database queries.
     */
    createQueryRunner(mode: 'master' | 'slave' = 'master'): QueryRunner {
        if (!this.queryRunner) {
            this.queryRunner = new NativescriptQueryRunner(this);
        }
        return this.queryRunner;
    }
    normalizeType(column: { type?: ColumnType; length?: number | string; precision?: number | null; scale?: number }): string {
        if ((column.type as any) === Buffer) {
            return 'blob';
        }
        return super.normalizeType(column);
    }
    // -------------------------------------------------------------------------
    // Protected Methods
    // -------------------------------------------------------------------------
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
    protected async createDatabaseConnection() {
        try {
            const db = this.sqlite.openOrCreate(this.options.database, this.options.extra? { ... this.options.extra}: {});
            // use object mode to work with TypeORM
            // db.resultType(this.sqlite.RESULTSASOBJECT);
            // we need to enable foreign keys in sqlite to make sure all foreign key related features
            // working properly. this also makes onDelete work with sqlite.
            await db.execute('PRAGMA foreign_keys = ON;', []);
            return db;
        } catch (err) {
            throw new Error(err);
        }
    }
    /**
     * If driver dependency is not given explicitly, then try to load it via "require".
     */
    protected loadDependencies(): void {
        try {
            this.sqlite = this.options.driver || require('@akylas/nativescript-sqlite');
        } catch (e) {
            throw new DriverPackageNotInstalledError('Nativescript', '@akylas/nativescript-sqlite');
        }
    }
}

// fake export class for webpack clean up with aliases
export class MongoDriver {}
export class SqljsDriver {}
export class PostgresDriver {}
export class CockroachDriver {}
export class MysqlDriver {}
export class AuroraDataApiDriver {}
export class OracleDriver {}
export class SqlServerDriver {}

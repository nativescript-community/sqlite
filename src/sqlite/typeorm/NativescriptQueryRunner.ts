import { ObjectLiteral, QueryFailedError, QueryResult, QueryRunner, QueryRunnerAlreadyReleasedError } from 'typeorm/browser';
import { AbstractSqliteQueryRunner } from 'typeorm/browser/driver/sqlite-abstract/AbstractSqliteQueryRunner';
import { Broadcaster } from 'typeorm/browser/subscriber/Broadcaster';
import { NativescriptDriver } from './NativescriptDriver';
import * as NSQlite from '../sqlite';

/**
 * Runs queries on a single sqlite database connection.
 */
export class NativescriptQueryRunner extends AbstractSqliteQueryRunner implements QueryRunner {
    /**
     * Database driver used by connection.
     */
    driver: NativescriptDriver;
    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------
    constructor(driver: NativescriptDriver) {
        super();
        this.driver = driver;
        this.connection = driver.connection;
        this.broadcaster = new Broadcaster(this);
    }
    /**
     * Executes a given SQL query.
     */
    async query(query: string, parameters?: any[], useStructuredResult?: boolean): Promise<any> {
        if (this.isReleased) {
            throw new QueryRunnerAlreadyReleasedError();
        }

        const connection = this.driver.connection;
        // writes go through execute (they have no rows): TypeORM reads the id of an INSERT and `affected` from the result
        const kind = /^\s*(INSERT|REPLACE|UPDATE|DELETE)\b/i.exec(query);
        const isInsert = !!kind && /^(INSERT|REPLACE)$/i.test(kind[1]);
        connection.logger.logQuery(query, parameters, this);

        try {
            const db: NSQlite.SQLiteDatabase = await this.connect();
            const queryStartTime = +new Date();
            let result: any;
            let affected: number | undefined;
            if (kind) {
                const res = await db.execute(query, parameters);
                affected = res.changes;
                // the id of an INSERT, the number of changed rows of an UPDATE / DELETE
                result = isInsert ? res.lastInsertRowId : res.changes;
            } else {
                result = await db.select(query, parameters);
            }
            const queryEndTime = +new Date();
            const queryExecutionTime = queryEndTime - queryStartTime;
            const maxQueryExecutionTime = connection.options.maxQueryExecutionTime;
            // log slow queries if maxQueryExecution time is set
            if (maxQueryExecutionTime && queryExecutionTime > maxQueryExecutionTime) {
                connection.logger.logQuerySlow(queryExecutionTime, query, parameters, this);
            }

            if (useStructuredResult) {
                return { records: kind ? [] : result, raw: result, affected } as QueryResult;
            } else {
                return result;
            }
        } catch (err) {
            connection.logger.logQueryError(err, query, parameters, this);
            throw new QueryFailedError(query, parameters, err);
        }
    }
    // -------------------------------------------------------------------------
    // Protected Methods
    // -------------------------------------------------------------------------
    /**
     * Parametrizes given object of values. Used to create column=value queries.
     */
    protected parametrize(objectLiteral: ObjectLiteral, startIndex: number = 0): string[] {
        return Object.keys(objectLiteral).map((key, index) => `"${key}"` + '=?');
    }
}

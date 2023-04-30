import { InanoSQLInstance, InanoSQLPlugin, InanoSQLTable, SQLiteAbstractFns } from '@nano-sql/core/lib/interfaces';
import { nanoSQLMemoryIndex } from '@nano-sql/core/lib/adapters/memoryIndex';
import { SQLiteAbstract } from '@nano-sql/core/lib/adapters/webSQL';

import * as NSSqlite from '../sqlite';

export class NativeSQLite extends nanoSQLMemoryIndex {
    plugin: InanoSQLPlugin = {
        name: 'Akylas NativeScript SQLite Adapter',
        version: 2.37
    };

    nSQL: InanoSQLInstance;

    public _id: string;
    public _db: NSSqlite.SQLiteDatabase;
    public _ai: { [table: string]: number };
    public _sqlite: SQLiteAbstractFns;
    public _tables: {
        [tableName: string]: InanoSQLTable;
    };

    constructor(private filePath: string, private options?: { flags?: number; threading?: boolean }) {
        super(false, true);
        this._ai = {};
        this._query = this._query.bind(this);
        this._tables = {};
        this._sqlite = SQLiteAbstract(this._query, 500);
    }

    connect(id: string, complete: () => void, error: (err: any) => void) {
        this._id = id;
        try {
            this._db = NSSqlite.openOrCreate(this.filePath && this.filePath.length ? this.filePath : id, this.options || {});
            this._sqlite.createAI(() => {
                // this._db.resultType(NSSQLite.RESULTSASOBJECT);
                complete();
            }, error);
        } catch (err) {
            error(err);
        }
    }

    createTable(tableName: string, tableData: InanoSQLTable, complete: () => void, error: (err: any) => void) {
        this._tables[tableName] = tableData;
        this._sqlite.createTable(tableName, tableData, this._ai, complete, error);
    }

    async _query(allowWrite: boolean, sql: string, args: any[], onRow: (row: any, i: number) => void, complete: () => void, error: (err: any) => void) {
        if (allowWrite) {
            try {
                await this._db.execute(sql, args);
                complete();
            } catch (err) {
                error(err);
            }
        } else {
            try {
                let count = 0;
                await this._db.each(
                    sql,
                    args,
                    (err, row) => {
                        if (err) {
                            error(err);
                            return;
                        }
                        onRow(row, count);
                        count++;
                    },
                    (err) => {
                        if (err) {
                            error(err);
                            return;
                        }
                        complete();
                    }
                );
            } catch (err) {
                error(err);
            }
        }
    }

    dropTable(table: string, complete: () => void, error: (err: any) => void) {
        this._sqlite.dropTable(table, complete, error);
    }

    disconnect(complete: () => void, error: (err: any) => void) {
        complete();
    }

    write(table: string, pk: any, row: { [key: string]: any }, complete: (pk: any) => void, error: (err: any) => void) {
        this._sqlite.write(this._tables[table].pkType, this._tables[table].pkCol, table, pk, row, this._tables[table].ai, this._ai, complete, error);
    }

    read(table: string, pk: any, complete: (row: { [key: string]: any } | undefined) => void, error: (err: any) => void) {
        this._sqlite.read(table, pk, complete, error);
    }

    delete(table: string, pk: any, complete: () => void, error: (err: any) => void) {
        this._sqlite.remove(table, pk, complete, error);
    }

    readMulti(
        table: string,
        type: 'range' | 'offset' | 'all',
        offsetOrLow: any,
        limitOrHigh: any,
        reverse: boolean,
        onRow: (row: { [key: string]: any }, i: number) => void,
        complete: () => void,
        error: (err: any) => void
    ) {
        this._sqlite.readMulti(table, type, offsetOrLow, limitOrHigh, reverse, onRow, complete, error);
    }

    getTableIndex(table: string, complete: (index: any[]) => void, error: (err: any) => void) {
        this._sqlite.getIndex(table, complete, error);
    }

    getTableIndexLength(table: string, complete: (length: number) => void, error: (err: any) => void) {
        this._sqlite.getNumberOfRecords(table, complete, error);
    }
}

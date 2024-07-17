import { SQLiteDatabase as ISQLiteDatabase, SqliteParam, SqliteParams, SqliteRow, paramsToStringArray, throwError } from './sqlite.common';

import { Application } from '@nativescript/core';
import { SQLiteDatabaseBase } from './sqlitedatabase.android';

function createDb(dbName: string, flags) {
    if (dbName === ':memory:') {
        //noinspection JSUnresolvedVariable
        return android.database.sqlite.SQLiteDatabase.create(flags);
    }
    if (dbName.indexOf('/') >= 0) {
        return android.database.sqlite.SQLiteDatabase.openDatabase(
            dbName,
            null,
            flags !== undefined ? flags : android.database.sqlite.SQLiteDatabase.CREATE_IF_NECESSARY | android.database.sqlite.SQLiteDatabase.NO_LOCALIZED_COLLATORS
        );
    } else {
        const activity: android.app.Activity = Application.android.foregroundActivity || Application.android.startActivity;
        return activity.openOrCreateDatabase(dbName, flags !== undefined ? flags : android.app.Activity.MODE_PRIVATE, null);
    }
}

export class SQLiteDatabase extends SQLiteDatabaseBase implements ISQLiteDatabase {

    open() {
        if (!this.db) {
            this.db = createDb(this.filePath, this.flags);
            if (this.threading && !this.worker) {
                this.worker = new Worker('./worker');
                this.worker.onmessage = this.onWorkerMessage;
            }
        }
        return this.isOpen;
    }
}

export function wrapDb(
    db: android.database.sqlite.SQLiteDatabase,
    options?: {
        readOnly?: boolean;
        transformBlobs?: boolean;
        threading?: boolean;
    }
): SQLiteDatabase {
    const obj = new SQLiteDatabase(db, options);
    obj.open();
    return obj;
}

export const openOrCreate = (
    filePath: string,
    options?: {
        threading?: boolean;
        transformBlobs?: boolean;
        flags?: number;
    }
): SQLiteDatabase => {
    const obj = new SQLiteDatabase(filePath, options);
    obj.open();
    return obj;
};

export const deleteDatabase = (filePath: string) => android.database.sqlite.SQLiteDatabase.deleteDatabase(new java.io.File(filePath));

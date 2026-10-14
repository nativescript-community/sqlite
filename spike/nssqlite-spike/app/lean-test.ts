/* A lean app: sqlite-core + sqlite-napi + sqlite-default-engine (androidx on Android), no bridges. */
import { File, knownFolders } from '@nativescript/core';
import '@nativescript-community/sqlite-default-engine';
import { SqliteError, configure, openOrCreate } from '@nativescript-community/sqlite-core';
import { messageOf } from './util';

declare const __ANDROID__: boolean;
const log = (...args: any[]) => console.log('[LEAN]', ...args);

export async function runLeanTests() {
    let passed = 0;
    let failed = 0;
    const check = async (name: string, fn: () => Promise<void> | void) => {
        try {
            await fn();
            passed++;
        } catch (error) {
            failed++;
            log('FAIL', name, messageOf(error));
        }
    };
    await check('default engine and options come from the package', async () => {
        const file = `${knownFolders.documents().path}/lean.db`;
        for (const suffix of ['', '-wal', '-shm']) if (File.exists(file + suffix)) File.fromPath(file + suffix).removeSync();
        const db = openOrCreate(file);
        await db.ready;
        log('SQLite', db.getSqliteVersion());
        const mode = (await db.getArray('PRAGMA journal_mode'))[0];
        if (mode !== (__ANDROID__ ? 'wal' : 'delete')) throw new Error('journal mode ' + mode);
        await db.execute('CREATE TABLE t(a)');
        await db.execute('INSERT INTO t VALUES (?)', [41]);
        if (db.getSync('SELECT a + 1 AS n FROM t').n !== 42) throw new Error('sync');
        await db.close();
    });
    await check('no bridge installed: reported by name', () => {
        configure({ backend: 'bridge' });
        try {
            openOrCreate(':memory:');
        } catch (error) {
            if (!/bridge is not available.*sqlite-bridge/.test(messageOf(error))) throw error;
            return;
        } finally {
            configure({ backend: 'napi' });
        }
        throw new Error('did not throw');
    });
    await check('errors are SqliteError', async () => {
        const db = openOrCreate(':memory:');
        let err: any;
        try {
            await db.execute('NOPE');
        } catch (error) {
            err = error;
        }
        if (!(err instanceof SqliteError)) throw new Error('not a SqliteError');
        await db.close();
    });
    log(`RESULT passed ${passed} failed ${failed}`);
}

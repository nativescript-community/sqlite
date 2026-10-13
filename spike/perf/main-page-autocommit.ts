/* Autocommit inserts are bound by the journal / sync work of every commit: which engine and journal settings. */
import { EventData, File, Page, knownFolders } from '@nativescript/core';
import { openOrCreate } from '@nativescript-community/sqlite';
import { FRAMEWORK_ENGINE, loadFrameworkEngine } from '@nativescript-community/sqlite-android-framework';

const variants: Array<[string, any]> = [
    ['androidx default (journal DELETE, sync FULL)', { engine: 'libsqliteJni.so' }],
    ['androidx journal TRUNCATE', { engine: 'libsqliteJni.so', initSql: 'PRAGMA journal_mode=TRUNCATE' }],
    ['androidx WAL', { engine: 'libsqliteJni.so', wal: true }],
    ['androidx WAL + synchronous NORMAL', { engine: 'libsqliteJni.so', wal: true, initSql: 'PRAGMA synchronous=NORMAL' }],
    ['platform SQLite default', { engine: FRAMEWORK_ENGINE }],
    ['platform SQLite WAL', { engine: FRAMEWORK_ENGINE, wal: true }]
];

export function navigatingTo(args: EventData) {
    const page = <Page>args.object;
    setTimeout(async () => {
        loadFrameworkEngine();
        for (const [label, options] of variants) {
            const times: number[] = [];
            let mode = '';
            let sync = '';
            for (let run = 0; run < 4; run++) {
                const file = `${knownFolders.documents().path}/autocommit.db`;
                for (const s of ['', '-wal', '-shm', '-journal']) if (File.exists(file + s)) File.fromPath(file + s).removeSync();
                const db = openOrCreate(file, options);
                await db.execute('CREATE TABLE ins(id INTEGER PRIMARY KEY, a TEXT, b REAL)');
                mode = (await db.getArray('PRAGMA journal_mode'))[0];
                sync = (await db.getArray('PRAGMA synchronous'))[0];
                const t0 = performance.now();
                for (let i = 0; i < 500; i++) await db.execute('INSERT INTO ins(a, b) VALUES (?, ?)', ['row ' + i, i * 0.5]);
                if (run) times.push(performance.now() - t0);
                await db.close();
            }
            times.sort((a, b) => a - b);
            console.log('[PERF] autocommit', label, `journal=${mode} synchronous=${sync}`, JSON.stringify({ ms: +times[1].toFixed(0), min: +times[0].toFixed(0) }));
        }
        console.log('[PERF] done');
    }, 500);
}

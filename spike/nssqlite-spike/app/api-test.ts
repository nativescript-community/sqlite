/* Exercises the plugin through its public TypeScript API on a device: every binding available on the runtime. */
import { SqliteError, configure, openOrCreate, openOrCreateAsync, deleteDatabase } from '@nativescript-community/sqlite';
import { BackendName, messageOf, stackOf, statement } from './util';

declare const __ANDROID__: boolean;

const log = (...args: any[]) => console.log('[API]', ...args);

let passed = 0;
let failed = 0;

async function check(name: string, fn: () => Promise<void> | void) {
    try {
        await fn();
        passed++;
    } catch (error) {
        failed++;
        log('FAIL', name, messageOf(error));
    }
}

function eq(actual: any, expected: any, what = '') {
    const actualJson = JSON.stringify(actual, (_k, value) => (typeof value === 'bigint' ? value.toString() + 'n' : value instanceof Uint8Array ? Array.from(value) : value));
    const expectedJson = JSON.stringify(expected, (_k, value) => (typeof value === 'bigint' ? value.toString() + 'n' : value instanceof Uint8Array ? Array.from(value) : value));
    if (actualJson !== expectedJson) {
        throw new Error(`${what} expected ${expectedJson} got ${actualJson}`);
    }
}

async function rejects(promise: Promise<any>, test: (error: any) => boolean, what: string) {
    try {
        await promise;
    } catch (error) {
        if (!test(error)) {
            throw new Error(`${what}: unexpected error ${error}`);
        }
        return;
    }
    throw new Error(`${what}: did not reject`);
}


async function suite(backend: BackendName) {
    configure({ backend });
    const db = openOrCreate(':memory:');
    await db.ready;
    log(backend, 'sqlite', db.getSqliteVersion());

    await check(backend + ' types', async () => {
        await db.execute('CREATE TABLE t(i, r, s, b, n)');
        const res = await db.execute('INSERT INTO t VALUES (?,?,?,?,?)', [123456, 2.5, 'héllo € 😀', new Uint8Array([0, 7, 255]), null]);
        eq(res, { changes: 1, lastInsertRowId: 1 });
        const row = await db.get('SELECT * FROM t');
        eq(row, { i: 123456, r: 2.5, s: 'héllo € 😀', b: [0, 7, 255], n: null });
        eq(row.b instanceof Uint8Array, true);
    });
    await check(backend + ' int64', async () => {
        eq((await db.get('SELECT ? AS v', 9007199254740993n, { int64: 'auto' })).v, 9007199254740993n);
        eq((await db.get('SELECT 3000000000 AS v')).v, 3000000000);
    });
    await check(backend + ' text edge cases', async () => {
        const long = 'x'.repeat(5000);
        eq(await db.getArray('SELECT ?, ?, ?', ['', long, 'a'.repeat(50) + 'é' + 'b'.repeat(50)]), ['', long, 'a'.repeat(50) + 'é' + 'b'.repeat(50)]);
    });
    await check(backend + ' errors', async () => {
        await rejects(db.execute('SELEKT 1'), (error) => error instanceof SqliteError && error.code === 1 && /syntax/.test(error.message), 'syntax');
        await rejects(db.get('SELECT ?, ?', [1]), (error) => error instanceof SqliteError && error.code === -2, 'param count');
        eq((await db.get('SELECT 1 AS one')).one, 1);
    });
    await check(backend + ' batch', async () => {
        await db.execute('CREATE TABLE b(a INTEGER PRIMARY KEY, v)');
        const res = await db.batch([['INSERT INTO b VALUES (?, ?)', [1, 'one']], ['INSERT INTO b VALUES (?, ?)', [2, 'two']], 'SELECT a, v FROM b ORDER BY a']);
        eq(res[2].rows, [{ a: 1, v: 'one' }, { a: 2, v: 'two' }]);
        await rejects(db.batch([['INSERT INTO b VALUES (?, ?)', [3, 'x']], ['INSERT INTO b VALUES (?, ?)', [1, 'dup']]]), (error) => error.code === 19, 'atomic');
        eq((await db.get('SELECT COUNT(*) AS n FROM b')).n, 2);
    });
    await check(backend + ' each', async () => {
        await db.execute('CREATE TABLE e(a)');
        await db.batch(Array.from({ length: 1000 }, (_, index) => statement('INSERT INTO e VALUES (?)', index)));
        let sum = 0;
        const count = await db.each('SELECT a FROM e', [], (_err, row) => (sum += row.a));
        eq([count, sum], [1000, 499500]);
    });
    await check(backend + ' transactions', async () => {
        await db.execute('CREATE TABLE x(a)');
        await db.transaction(async (_cancel, tx) => {
            await tx.execute('INSERT INTO x VALUES (1)');
        });
        await db.transaction(async (cancel) => {
            await db.execute('INSERT INTO x VALUES (2)'); // joins
            cancel();
        });
        await rejects(
            db.transaction(async () => {
                await db.execute('INSERT INTO x VALUES (3)');
                throw new Error('boom');
            }),
            (error) => /boom/.test(error.message),
            'rollback on throw'
        );
        eq((await db.selectArray('SELECT a FROM x')).map((row) => row[0]), [1]);
    });
    await check(backend + ' concurrency', async () => {
        await db.execute('CREATE TABLE c(a)');
        await Promise.all(Array.from({ length: 300 }, (_, index) => db.execute('INSERT INTO c VALUES (?)', index)));
        eq((await db.get('SELECT COUNT(*) AS n, SUM(a) AS s FROM c')), { n: 300, s: 44850 });
    });
    await check(backend + ' version', async () => {
        await db.setVersion(7);
        eq(await db.getVersion(), 7);
    });
    await check(backend + ' file database', async () => {
        const name = 'api-test-' + backend + '.db';
        deleteDatabase(name);
        const created = await openOrCreateAsync(name, { wal: true });
        await created.execute('CREATE TABLE t(a)');
        await created.execute('INSERT INTO t VALUES (1)');
        eq(created.filePath.indexOf('/') === 0, true);
        await created.close();
        const reopened = openOrCreate(name);
        eq((await reopened.get('SELECT COUNT(*) AS n FROM t')).n, 1);
        await reopened.close();
        eq(deleteDatabase(name), true);
    });
    await check(backend + ' journal mode default: WAL on Android, SQLite default on iOS; options win', async () => {
        const name = 'api-test-journal-' + backend + '.db';
        deleteDatabase(name);
        const mode = async (options?: any) => {
            const database = openOrCreate(name, options);
            const journalMode = (await database.getArray('PRAGMA journal_mode'))[0];
            await database.close();
            return journalMode;
        };
        eq(await mode(), __ANDROID__ ? 'wal' : 'delete', 'default');
        deleteDatabase(name);
        eq(await mode({ wal: false }), 'delete', 'wal: false');
        deleteDatabase(name);
        const database = openOrCreate(name);
        await database.execute('CREATE TABLE t(a)');
        await database.close();
        const ro = openOrCreate(name, { readOnly: true });
        eq((await ro.getArray('SELECT count(*) FROM t'))[0], 0, 'read-only with the default');
        await ro.close();
        const mem = openOrCreate(':memory:');
        eq((await mem.getArray('PRAGMA journal_mode'))[0], 'memory');
        await mem.close();
        deleteDatabase(name);
    });
    await check(backend + ' open failure', async () => {
        const bad = openOrCreate('/nonexistent-dir-xyz/a/b.db', { flags: 0x2 }); // no CREATE: the folder cannot be created either
        await rejects(bad.ready, (error) => error instanceof SqliteError, 'ready');
        await bad.close();
    });
    await check(backend + ' closed', async () => {
        await db.close();
        await rejects(db.get('SELECT 1'), (error) => error instanceof SqliteError && error.code === -1, 'closed');
    });
}

export async function runApiTests(backends: BackendName[]) {
    try {
        for (const backend of backends) {
            passed = 0;
            failed = 0;
            const t0 = Date.now();
            try {
                await suite(backend);
            } catch (error) {
                failed++;
                log(backend, 'SUITE ERROR', messageOf(error), stackOf(error, 4));
            }
            log(backend, 'RESULT passed', passed, 'failed', failed, 'in', Date.now() - t0, 'ms');
        }
        log('done');
    } catch (error) {
        log('ERROR', String(error));
    }
}

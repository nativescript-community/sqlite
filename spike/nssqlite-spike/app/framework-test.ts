/* The platform SQLite (android.database.sqlite) as an engine, through @nativescript-community/sqlite-android-framework. */
import { File, knownFolders } from '@nativescript/core';
import { SqliteError, configure, openOrCreate } from '@nativescript-community/sqlite';
import { FRAMEWORK_ENGINE, loadFrameworkEngine } from '@nativescript-community/sqlite-android-framework';
import { messageOf, statement } from './util';

const log = (...args: any[]) => console.log('[FW]', ...args);
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
    if (actualJson !== expectedJson) throw new Error(`${what} expected ${expectedJson} got ${actualJson}`);
}

async function rejects(promise: Promise<any>, test: (error: any) => boolean, what: string) {
    try {
        await promise;
    } catch (error) {
        if (!test(error)) throw new Error(`${what}: unexpected error ${error}`);
        return;
    }
    throw new Error(`${what}: did not reject`);
}

function removeDb(file: string) {
    for (const suffix of ['', '-wal', '-shm', '-journal']) {
        try {
            if (File.exists(file + suffix)) File.fromPath(file + suffix).removeSync();
        } catch (error) {
            // ignore
        }
    }
}

const mem = (options = {}) => openOrCreate(':memory:', { engine: FRAMEWORK_ENGINE, ...options });
const now = () => performance.now();

export async function runFrameworkTests() {
    for (const backend of ['napi', 'bridge'] as const) {
        configure({ backend });
        log('backend', backend);
        await runSuite(backend === 'napi');
    }
}

async function runSuite(withPerf: boolean) {
    passed = failed = 0;
    loadFrameworkEngine();
    const dir = knownFolders.documents().path;

    await check('version, no extension loading', async () => {
        const db = mem();
        await db.ready;
        log('platform SQLite', db.getSqliteVersion());
        eq(db.canLoadExtensions(), false);
        await rejects(db.loadExtension('/x/libx.so'), (error) => error instanceof SqliteError, 'loadExtension');
        await db.close();
    });
    await check('types', async () => {
        const db = mem();
        await db.execute('CREATE TABLE t(i, r, s, b, n)');
        const res = await db.execute('INSERT INTO t VALUES (?,?,?,?,?)', [123456, 2.5, 'héllo € 😀', new Uint8Array([0, 7, 255]), null]);
        eq(res, { changes: 1, lastInsertRowId: 1 });
        eq(await db.get('SELECT * FROM t'), { i: 123456, r: 2.5, s: 'héllo € 😀', b: [0, 7, 255], n: null });
        eq((await db.get('SELECT ? AS v', 9007199254740993n, { int64: 'auto' })).v, 9007199254740993n);
        eq((await db.get('SELECT 3000000000 AS v')).v, 3000000000);
        eq((await db.get('SELECT ?1 + ?1 AS v', [21])).v, 42);
        eq(await db.getArray('SELECT ?, ?, ?', [true, false, new Date('2026-10-13T10:00:00.000Z')]), [1, 0, '2026-10-13T10:00:00.000Z']);
        await db.close();
    });
    await check('execute results', async () => {
        const db = mem();
        await db.execute('CREATE TABLE t(id INTEGER PRIMARY KEY, v)');
        eq(await db.execute('INSERT INTO t(v) VALUES (1),(2),(3)'), { changes: 3, lastInsertRowId: 3 });
        eq((await db.execute('UPDATE t SET v = v + 1')).changes, 3);
        eq((await db.execute('DELETE FROM t WHERE id > 1')).changes, 2);
        eq((await db.execute('INSERT INTO t(v) SELECT v FROM t')).changes, 1);
        await db.close();
    });
    await check('errors carry the SQLite codes', async () => {
        const db = mem();
        await db.execute('CREATE TABLE t(id INTEGER PRIMARY KEY, u TEXT UNIQUE)');
        await db.execute("INSERT INTO t(u) VALUES ('a')");
        await rejects(db.execute("INSERT INTO t(u) VALUES ('a')"), (error) => error instanceof SqliteError && error.code === 19 && error.extendedCode === 2067, 'unique');
        await rejects(db.select('SELECT * FROM nope'), (error) => error instanceof SqliteError && /no such table/.test(error.message), 'no table');
        await rejects(db.execute('NOT SQL'), (error) => error instanceof SqliteError && error.code === 1, 'syntax');
        eq((await db.getArray('SELECT count(*) FROM t'))[0], 1);
        await db.close();
    });
    await check('blob, empty and unicode text, many columns', async () => {
        const db = mem();
        await db.execute('CREATE TABLE t(a, b, c)');
        const big = new Uint8Array(100000).map((_v, index) => index % 251);
        await db.execute('INSERT INTO t VALUES (?, ?, ?)', [big, '', 'x'.repeat(50000) + '😀']);
        const row = await db.get('SELECT * FROM t');
        eq(row.a.length, 100000);
        eq(row.a[99999], 99999 % 251);
        eq(row.b, '');
        eq(row.c.length, 50002);
        await db.close();
    });
    await check('a row bigger than the platform cursor window (2 MB)', async () => {
        const file = `${dir}/fw-bigrow.db`;
        removeDb(file);
        const db = openOrCreate(file, { engine: FRAMEWORK_ENGINE });
        const big = 'é€x'.repeat(1200000); // ~ 7 MB of UTF-8
        await db.execute('CREATE TABLE t(a TEXT)');
        await db.execute('INSERT INTO t VALUES (?)', [big]);
        // default window (16 MB): reads
        eq((await db.get('SELECT a FROM t')).a === big, true, 'default window');
        // a window smaller than the row: a clear error
        loadFrameworkEngine({ cursorWindowSize: 1 << 20 });
        await rejects(db.get('SELECT a FROM t'), (error) => /cursorWindowSize/.test(String(error.message)), 'small window');
        loadFrameworkEngine({ cursorWindowSize: 8 << 20 });
        eq((await db.get('SELECT length(a) AS n FROM t')).n, big.length);
        eq((await db.get('SELECT a FROM t')).a === big, true, '8 MB window');
        loadFrameworkEngine({ cursorWindowSize: 16 << 20 });
        await db.close();
        removeDb(file);
    });
    await check('batch is atomic, non atomic keeps going', async () => {
        const db = mem();
        await db.execute('CREATE TABLE t(id INTEGER PRIMARY KEY)');
        await rejects(db.batch(['INSERT INTO t VALUES (1)', 'INSERT INTO t VALUES (1)']), (error) => error instanceof SqliteError, 'atomic');
        eq((await db.getArray('SELECT count(*) FROM t'))[0], 0);
        const results = await db.batch([['INSERT INTO t VALUES (?)', [5]], 'SELECT id FROM t'], { atomic: true });
        eq(results[1].rows, [{ id: 5 }]);
        await db.close();
    });
    await check('transactions: commit, rollback, cancel, savepoint inside', async () => {
        const db = mem();
        await db.execute('CREATE TABLE t(id INTEGER PRIMARY KEY)');
        await db.transaction(async (_c, tx) => {
            await tx.execute('INSERT INTO t VALUES (1)');
            // a batch inside a transaction uses a savepoint
            await rejects(tx.batch(['INSERT INTO t VALUES (2)', 'INSERT INTO t VALUES (1)']), (error) => error instanceof SqliteError, 'inner batch');
            await tx.execute('INSERT INTO t VALUES (3)');
        });
        eq(await db.selectArray('SELECT id FROM t ORDER BY id'), [[1], [3]]);
        await rejects(
            db.transaction(async (_c, tx) => {
                await tx.execute('INSERT INTO t VALUES (9)');
                throw new Error('boom');
            }),
            (error) => /boom/.test(error.message),
            'rollback'
        );
        await db.transaction(async (cancel, tx) => {
            await tx.execute('INSERT INTO t VALUES (10)');
            cancel();
        });
        eq((await db.getArray('SELECT count(*) FROM t'))[0], 2);
        await db.close();
    });
    await check('each streams, big selects', async () => {
        const db = mem();
        await db.execute('CREATE TABLE t(id INTEGER PRIMARY KEY, name TEXT, score REAL)');
        await db.execute(`WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c WHERE x < 20000) INSERT INTO t SELECT x, 'name_' || x, x * 0.25 FROM c`);
        let rowCount = 0;
        let sum = 0;
        const count = await db.each('SELECT * FROM t', [], (_e, row) => {
            rowCount++;
            sum += row.id;
        });
        eq([count, rowCount, sum], [20000, 20000, 200010000]);
        const rows = await db.select('SELECT * FROM t');
        eq(rows.length, 20000);
        eq(rows[19999], { id: 20000, name: 'name_20000', score: 5000 });
        await db.close();
    });
    await check('scripts, triggers, multiple statements are refused', async () => {
        const db = mem();
        await db.executeScript(`
            CREATE TABLE a(x); CREATE TABLE log(m);
            CREATE TRIGGER ta AFTER INSERT ON a BEGIN INSERT INTO log VALUES ('inserted ' || new.x); INSERT INTO log VALUES ('twice'); END;
            INSERT INTO a VALUES (1); -- comment; with semicolon
            INSERT INTO a VALUES (';');`);
        eq((await db.getArray('SELECT count(*) FROM log'))[0], 4);
        await rejects(db.execute('INSERT INTO a VALUES (2); INSERT INTO a VALUES (3)'), (error) => /multiple statements/.test(error.message), 'multi');
        await db.close();
    });
    await check('files: wal, reopen, user_version, parallel databases', async () => {
        const file = `${dir}/fw-test.db`;
        removeDb(file);
        const db = openOrCreate(file, { engine: FRAMEWORK_ENGINE, wal: true });
        eq((await db.getArray('PRAGMA journal_mode'))[0], 'wal');
        await db.execute('CREATE TABLE t(x)');
        await db.setVersion(7);
        await db.execute("INSERT INTO t VALUES ('kept')");
        await db.close();
        const again = openOrCreate(file, { engine: FRAMEWORK_ENGINE });
        eq([await again.getVersion(), (await again.getArray('SELECT x FROM t'))[0]], [7, 'kept']);
        await again.close();
        const ro = openOrCreate(file, { engine: FRAMEWORK_ENGINE, readOnly: true });
        eq((await ro.getArray('SELECT count(*) FROM t'))[0], 1);
        await rejects(ro.execute('INSERT INTO t VALUES (1)'), (error) => error instanceof SqliteError, 'readonly');
        await ro.close();
        removeDb(file);
        const dbs = [0, 1, 2, 3].map((index) => openOrCreate(`${dir}/fw-par-${index}.db`, { engine: FRAMEWORK_ENGINE }));
        await Promise.all(dbs.map((database) => database.execute('CREATE TABLE t(i)')));
        await Promise.all(dbs.map((database) => Promise.all(Array.from({ length: 200 }, (_x, index) => database.execute('INSERT INTO t VALUES (?)', [index])))));
        const counts = await Promise.all(dbs.map((database) => database.getArray('SELECT count(*), sum(i) FROM t')));
        counts.forEach((row) => eq(row, [200, 19900]));
        await Promise.all(dbs.map((database) => database.close()));
        [0, 1, 2, 3].forEach((index) => removeDb(`${dir}/fw-par-${index}.db`));
    });
    await check('RETURNING when the platform SQLite has it', async () => {
        const db = mem();
        const [maj, min] = db.getSqliteVersion().split('.').map(Number);
        if (maj > 3 || (maj === 3 && min >= 35)) {
            await db.execute('CREATE TABLE t(id INTEGER PRIMARY KEY, v)');
            eq(await db.select('INSERT INTO t(v) VALUES (5) RETURNING id, v'), [{ id: 1, v: 5 }]);
        }
        await db.close();
    });
    if (withPerf) await perf();
    log(`RESULT passed ${passed} failed ${failed}`);
}

/** The same work on the platform SQLite and on androidx sqlite-bundled (when the app has it). */
async function perf() {
    const engines: Array<[string, string]> = [
        ['androidx', 'libsqliteJni.so'],
        ['framework', FRAMEWORK_ENGINE],
        ['androidx again', 'libsqliteJni.so'],
        ['framework again', FRAMEWORK_ENGINE]
    ];
    for (const [label, engine] of engines) {
        try {
            const db = openOrCreate(`${knownFolders.documents().path}/fw-perf-${label.replace(' ', '')}.db`, { engine });
            await db.ready;
            await db.execute('DROP TABLE IF EXISTS narrow');
            await db.execute('CREATE TABLE narrow(id INTEGER PRIMARY KEY, name TEXT, score REAL)');
            await db.execute(`WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c WHERE x < 20000) INSERT INTO narrow SELECT x, 'name_' || x, x * 0.25 FROM c`);
            await db.execute('DROP TABLE IF EXISTS ins');
            await db.execute('CREATE TABLE ins(id INTEGER PRIMARY KEY, a TEXT, b REAL)');
            const med = async (fn: () => Promise<any>, runs = 5) => {
                const times: number[] = [];
                for (let index = 0; index < runs + 1; index++) {
                    const t0 = now();
                    await fn();
                    if (index) times.push(now() - t0);
                }
                return +times.sort((left, right) => left - right)[Math.floor(times.length / 2)].toFixed(1);
            };
            const out: Record<string, number> = {};
            out['select 20000x3'] = await med(() => db.select('SELECT * FROM narrow'));
            out['1000 point lookups awaited'] = await med(async () => {
                for (let index = 1; index <= 1000; index++) await db.get('SELECT * FROM narrow WHERE id = ?', [index]);
            });
            const clear = () => db.execute('DELETE FROM ins');
            out['5000 inserts tx, all at once'] = await med(async () => {
                await clear();
                await db.transaction(async () => {
                    await Promise.all(Array.from({ length: 5000 }, (_x, index) => db.execute('INSERT INTO ins(a, b) VALUES (?, ?)', ['row ' + index, index * 0.5])));
                });
            });
            const items = Array.from({ length: 5000 }, (_x, index) => statement('INSERT INTO ins(a, b) VALUES (?, ?)', 'row ' + index, index * 0.5));
            out['5000 inserts batch()'] = await med(async () => {
                await clear();
                await db.batch(items);
            });
            log('PERF', label, JSON.stringify(out));
            await db.close();
            removeDb(`${knownFolders.documents().path}/fw-perf-${label.replace(' ', '')}.db`);
        } catch (error) {
            log('PERF', label, 'unavailable:', String(error).slice(0, 100));
        }
    }
}

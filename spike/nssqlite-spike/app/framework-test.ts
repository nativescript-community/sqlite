/* The platform SQLite (android.database.sqlite) as an engine, through @nativescript-community/sqlite-android-framework. */
import { File, knownFolders } from '@nativescript/core';
import { SqliteError, configure, openOrCreate } from '@nativescript-community/sqlite';
import { FRAMEWORK_ENGINE, loadFrameworkEngine } from '@nativescript-community/sqlite-android-framework';

const log = (...a: any[]) => console.log('[FW]', ...a);
let passed = 0;
let failed = 0;

async function check(name: string, fn: () => Promise<void> | void) {
    try {
        await fn();
        passed++;
    } catch (e) {
        failed++;
        log('FAIL', name, String((e && (e as any).message) || e));
    }
}

function eq(actual: any, expected: any, what = '') {
    const a = JSON.stringify(actual, (_k, v) => (typeof v === 'bigint' ? v.toString() + 'n' : v instanceof Uint8Array ? Array.from(v) : v));
    const b = JSON.stringify(expected, (_k, v) => (typeof v === 'bigint' ? v.toString() + 'n' : v instanceof Uint8Array ? Array.from(v) : v));
    if (a !== b) throw new Error(`${what} expected ${b} got ${a}`);
}

async function rejects(p: Promise<any>, test: (e: any) => boolean, what: string) {
    try {
        await p;
    } catch (e) {
        if (!test(e)) throw new Error(`${what}: unexpected error ${e}`);
        return;
    }
    throw new Error(`${what}: did not reject`);
}

function removeDb(file: string) {
    for (const s of ['', '-wal', '-shm', '-journal']) {
        try {
            if (File.exists(file + s)) File.fromPath(file + s).removeSync();
        } catch (e) {
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
        await rejects(db.loadExtension('/x/libx.so'), (e) => e instanceof SqliteError, 'loadExtension');
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
        await rejects(db.execute("INSERT INTO t(u) VALUES ('a')"), (e) => e instanceof SqliteError && e.code === 19 && e.extendedCode === 2067, 'unique');
        await rejects(db.select('SELECT * FROM nope'), (e) => e instanceof SqliteError && /no such table/.test(e.message), 'no table');
        await rejects(db.execute('NOT SQL'), (e) => e instanceof SqliteError && e.code === 1, 'syntax');
        eq((await db.getArray('SELECT count(*) FROM t'))[0], 1);
        await db.close();
    });
    await check('blob, empty and unicode text, many columns', async () => {
        const db = mem();
        await db.execute('CREATE TABLE t(a, b, c)');
        const big = new Uint8Array(100000).map((_v, i) => i % 251);
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
        await rejects(db.get('SELECT a FROM t'), (e) => /cursorWindowSize/.test(String(e.message)), 'small window');
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
        await rejects(db.batch(['INSERT INTO t VALUES (1)', 'INSERT INTO t VALUES (1)']), (e) => e instanceof SqliteError, 'atomic');
        eq((await db.getArray('SELECT count(*) FROM t'))[0], 0);
        const r = await db.batch([['INSERT INTO t VALUES (?)', [5]], 'SELECT id FROM t'], { atomic: true });
        eq(r[1].rows, [{ id: 5 }]);
        await db.close();
    });
    await check('transactions: commit, rollback, cancel, savepoint inside', async () => {
        const db = mem();
        await db.execute('CREATE TABLE t(id INTEGER PRIMARY KEY)');
        await db.transaction(async (_c, tx) => {
            await tx.execute('INSERT INTO t VALUES (1)');
            // a batch inside a transaction uses a savepoint
            await rejects(tx.batch(['INSERT INTO t VALUES (2)', 'INSERT INTO t VALUES (1)']), (e) => e instanceof SqliteError, 'inner batch');
            await tx.execute('INSERT INTO t VALUES (3)');
        });
        eq(await db.selectArray('SELECT id FROM t ORDER BY id'), [[1], [3]]);
        await rejects(
            db.transaction(async (_c, tx) => {
                await tx.execute('INSERT INTO t VALUES (9)');
                throw new Error('boom');
            }),
            (e) => /boom/.test(e.message),
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
        let n = 0;
        let sum = 0;
        const count = await db.each('SELECT * FROM t', [], (_e, row) => {
            n++;
            sum += row.id;
        });
        eq([count, n, sum], [20000, 20000, 200010000]);
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
        await rejects(db.execute('INSERT INTO a VALUES (2); INSERT INTO a VALUES (3)'), (e) => /multiple statements/.test(e.message), 'multi');
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
        await rejects(ro.execute('INSERT INTO t VALUES (1)'), (e) => e instanceof SqliteError, 'readonly');
        await ro.close();
        removeDb(file);
        const dbs = [0, 1, 2, 3].map((i) => openOrCreate(`${dir}/fw-par-${i}.db`, { engine: FRAMEWORK_ENGINE }));
        await Promise.all(dbs.map((d) => d.execute('CREATE TABLE t(i)')));
        await Promise.all(dbs.map((d) => Promise.all(Array.from({ length: 200 }, (_x, i) => d.execute('INSERT INTO t VALUES (?)', [i])))));
        const counts = await Promise.all(dbs.map((d) => d.getArray('SELECT count(*), sum(i) FROM t')));
        counts.forEach((c) => eq(c, [200, 19900]));
        await Promise.all(dbs.map((d) => d.close()));
        [0, 1, 2, 3].forEach((i) => removeDb(`${dir}/fw-par-${i}.db`));
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
                const t: number[] = [];
                for (let i = 0; i < runs + 1; i++) {
                    const t0 = now();
                    await fn();
                    if (i) t.push(now() - t0);
                }
                return +t.sort((a, b) => a - b)[Math.floor(t.length / 2)].toFixed(1);
            };
            const out: Record<string, number> = {};
            out['select 20000x3'] = await med(() => db.select('SELECT * FROM narrow'));
            out['1000 point lookups awaited'] = await med(async () => {
                for (let i = 1; i <= 1000; i++) await db.get('SELECT * FROM narrow WHERE id = ?', [i]);
            });
            const clear = () => db.execute('DELETE FROM ins');
            out['5000 inserts tx, all at once'] = await med(async () => {
                await clear();
                await db.transaction(async () => {
                    await Promise.all(Array.from({ length: 5000 }, (_x, i) => db.execute('INSERT INTO ins(a, b) VALUES (?, ?)', ['row ' + i, i * 0.5])));
                });
            });
            const items = Array.from({ length: 5000 }, (_x, i) => ['INSERT INTO ins(a, b) VALUES (?, ?)', ['row ' + i, i * 0.5]]) as any;
            out['5000 inserts batch()'] = await med(async () => {
                await clear();
                await db.batch(items);
            });
            log('PERF', label, JSON.stringify(out));
            await db.close();
            removeDb(`${knownFolders.documents().path}/fw-perf-${label.replace(' ', '')}.db`);
        } catch (e) {
            log('PERF', label, 'unavailable:', String(e).slice(0, 100));
        }
    }
}

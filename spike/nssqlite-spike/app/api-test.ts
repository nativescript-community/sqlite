/* Exercises the plugin through its public TypeScript API on a device: every binding available on the runtime. */
import { SqliteError, configure, openOrCreate, openOrCreateAsync, deleteDatabase } from '@nativescript-community/sqlite';

declare const __ANDROID__: boolean;

const log = (...a: any[]) => console.log('[API]', ...a);

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
    if (a !== b) {
        throw new Error(`${what} expected ${b} got ${a}`);
    }
}

async function rejects(p: Promise<any>, test: (e: any) => boolean, what: string) {
    try {
        await p;
    } catch (e) {
        if (!test(e)) {
            throw new Error(`${what}: unexpected error ${e}`);
        }
        return;
    }
    throw new Error(`${what}: did not reject`);
}

type Backends = 'auto' | 'napi' | 'bridge';

async function suite(backend: Backends) {
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
        await rejects(db.execute('SELEKT 1'), (e) => e instanceof SqliteError && e.code === 1 && /syntax/.test(e.message), 'syntax');
        await rejects(db.get('SELECT ?, ?', [1]), (e) => e instanceof SqliteError && e.code === -2, 'param count');
        eq((await db.get('SELECT 1 AS one')).one, 1);
    });
    await check(backend + ' batch', async () => {
        await db.execute('CREATE TABLE b(a INTEGER PRIMARY KEY, v)');
        const res = await db.batch([['INSERT INTO b VALUES (?, ?)', [1, 'one']], ['INSERT INTO b VALUES (?, ?)', [2, 'two']], 'SELECT a, v FROM b ORDER BY a']);
        eq(res[2].rows, [{ a: 1, v: 'one' }, { a: 2, v: 'two' }]);
        await rejects(db.batch([['INSERT INTO b VALUES (?, ?)', [3, 'x']], ['INSERT INTO b VALUES (?, ?)', [1, 'dup']]]), (e) => e.code === 19, 'atomic');
        eq((await db.get('SELECT COUNT(*) AS n FROM b')).n, 2);
    });
    await check(backend + ' each', async () => {
        await db.execute('CREATE TABLE e(a)');
        await db.batch(Array.from({ length: 1000 }, (_, i) => ['INSERT INTO e VALUES (?)', [i]] as [string, any[]]));
        let sum = 0;
        const n = await db.each('SELECT a FROM e', [], (_err, row) => (sum += row.a));
        eq([n, sum], [1000, 499500]);
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
            (e) => /boom/.test(e.message),
            'rollback on throw'
        );
        eq((await db.selectArray('SELECT a FROM x')).map((r) => r[0]), [1]);
    });
    await check(backend + ' concurrency', async () => {
        await db.execute('CREATE TABLE c(a)');
        await Promise.all(Array.from({ length: 300 }, (_, i) => db.execute('INSERT INTO c VALUES (?)', i)));
        eq((await db.get('SELECT COUNT(*) AS n, SUM(a) AS s FROM c')), { n: 300, s: 44850 });
    });
    await check(backend + ' version', async () => {
        await db.setVersion(7);
        eq(await db.getVersion(), 7);
    });
    await check(backend + ' file database', async () => {
        const name = 'api-test-' + backend + '.db';
        deleteDatabase(name);
        const f = await openOrCreateAsync(name, { wal: true });
        await f.execute('CREATE TABLE t(a)');
        await f.execute('INSERT INTO t VALUES (1)');
        eq(f.filePath.indexOf('/') === 0, true);
        await f.close();
        const g = openOrCreate(name);
        eq((await g.get('SELECT COUNT(*) AS n FROM t')).n, 1);
        await g.close();
        eq(deleteDatabase(name), true);
    });
    await check(backend + ' open failure', async () => {
        const bad = openOrCreate('/nonexistent-dir-xyz/a/b.db', { flags: 0x2 }); // no CREATE: the folder cannot be created either
        await rejects(bad.ready, (e) => e instanceof SqliteError, 'ready');
        await bad.close();
    });
    await check(backend + ' closed', async () => {
        await db.close();
        await rejects(db.get('SELECT 1'), (e) => e instanceof SqliteError && e.code === -1, 'closed');
    });
}

export async function runApiTests(backends: Backends[]) {
    try {
        for (const b of backends) {
            passed = 0;
            failed = 0;
            const t0 = Date.now();
            try {
                await suite(b);
            } catch (e) {
                failed++;
                log(b, 'SUITE ERROR', String(e), (e as any) && (e as any).stack ? String((e as any).stack).split('\n').slice(0, 4).join(' | ') : '');
            }
            log(b, 'RESULT passed', passed, 'failed', failed, 'in', Date.now() - t0, 'ms');
        }
        log('done');
    } catch (e) {
        log('ERROR', String(e));
    }
}

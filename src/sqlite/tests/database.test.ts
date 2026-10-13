import { strict as assert } from 'assert';
import { after, describe, it } from 'node:test';
import { SqliteError } from '../sqlite.common';
import { open, tmpDb } from './support';

async function withDb<T>(fn: (db: ReturnType<typeof open>) => Promise<T>, file = ':memory:', options = {}) {
    const db = open(file, options);
    try {
        return await fn(db);
    } finally {
        await db.close();
    }
}

describe('values', () => {
    it('round trips every type', () =>
        withDb(async (db) => {
            await db.execute('CREATE TABLE t(i, r, s, b, n)');
            const blob = new Uint8Array([0, 7, 255]);
            const res = await db.execute('INSERT INTO t VALUES (?,?,?,?,?)', [123456, 2.5, 'héllo € 😀', blob, null]);
            assert.deepEqual(res, { changes: 1, lastInsertRowId: 1 });
            const row = await db.get('SELECT * FROM t');
            assert.equal(row.i, 123456);
            assert.equal(row.r, 2.5);
            assert.equal(row.s, 'héllo € 😀');
            assert.ok(row.b instanceof Uint8Array);
            assert.deepEqual(Array.from(row.b), [0, 7, 255]);
            assert.equal(row.n, null);
        }));

    it('binds booleans, dates, bigint, array buffers, typed arrays, byte arrays, undefined', () =>
        withDb(async (db) => {
            const date = new Date('2026-10-13T10:00:00.000Z');
            const r = await db.getArray('SELECT ?, ?, ?, ?, ?, ?, ?, ?', [true, false, date, 12345678901234567n, new Uint8Array([1, 2]).buffer, new Uint16Array([1, 2]), [9, 8, 7], undefined]);
            assert.equal(r[0], 1);
            assert.equal(r[1], 0);
            assert.equal(r[2], '2026-10-13T10:00:00.000Z');
            assert.equal(r[3], 12345678901234567); // number by default
            assert.deepEqual(Array.from(r[4]), [1, 2]);
            assert.deepEqual(Array.from(r[5]), [1, 0, 2, 0]);
            assert.deepEqual(Array.from(r[6]), [9, 8, 7]);
            assert.equal(r[7], null);
        }));

    it('keeps 64 bit integers exact with int64 modes', () =>
        withDb(async (db) => {
            const big = 9007199254740993n;
            const q = 'SELECT ? AS big, 5 AS small, 3000000000 AS mid';
            const num = await db.get(q, big);
            assert.equal(num.big, 9007199254740992); // beyond 2^53 a number cannot hold it
            const auto = await db.get(q, big, { int64: 'auto' });
            assert.equal(auto.big, big);
            assert.equal(auto.mid, 3000000000);
            assert.equal(auto.small, 5);
            const all = await db.get(q, big, { int64: 'bigint' });
            assert.equal(all.big, big);
            assert.equal(all.mid, 3000000000n);
            assert.equal(all.small, 5); // INT32 values stay numbers
            assert.equal((await db.get('SELECT ?', -9007199254740993n, { int64: 'auto' }))['?'], -9007199254740993n);
            assert.equal((await db.get('SELECT ? AS v', -5000000000)).v, -5000000000);
        }));

    it('returns blobs as ArrayBuffer with transformBlobs false', () =>
        withDb(async (db) => {
            const row = await db.get('SELECT x\'0102\' AS b', undefined, { transformBlobs: false });
            assert.ok(row.b instanceof ArrayBuffer);
            assert.deepEqual(Array.from(new Uint8Array(row.b)), [1, 2]);
        }));

    it('handles text edge cases', () =>
        withDb(async (db) => {
            const long = 'x'.repeat(5000);
            const mixed = 'a'.repeat(100) + 'é' + 'b'.repeat(100);
            const emoji = '😀'.repeat(50);
            const r = await db.getArray('SELECT ?, ?, ?, ?, ?', ['', long, mixed, emoji, 'quote " \\ \n \u0000 end']);
            assert.deepEqual(r, ['', long, mixed, emoji, 'quote " \\ \n \u0000 end']);
        }));

    it('rejects unsupported parameters', () =>
        withDb(async (db) => {
            await assert.rejects(db.get('SELECT ?', { a: 1 } as any), TypeError);
            await assert.rejects(db.get('SELECT ?', (() => 1) as any), TypeError);
            await assert.rejects(db.get('SELECT ?', Symbol('x') as any), TypeError);
            assert.equal((await db.get('SELECT 1 AS one')).one, 1); // still usable
        }));

    it('accepts a single non array parameter', () =>
        withDb(async (db) => {
            assert.equal((await db.get('SELECT ? AS v', 'single')).v, 'single');
            assert.equal((await db.get('SELECT 7 AS v', null)).v, 7);
        }));

    it('returns objects, arrays, first row helpers and null for no row', () =>
        withDb(async (db) => {
            await db.execute('CREATE TABLE t(a, b)');
            await db.execute('INSERT INTO t VALUES (1, "x"), (2, "y")');
            assert.deepEqual(await db.select('SELECT a, b FROM t ORDER BY a'), [{ a: 1, b: 'x' }, { a: 2, b: 'y' }]);
            assert.deepEqual(await db.selectArray('SELECT a, b FROM t ORDER BY a'), [[1, 'x'], [2, 'y']]);
            assert.deepEqual(await db.get('SELECT a, b FROM t ORDER BY a DESC'), { a: 2, b: 'y' });
            assert.deepEqual(await db.getArray('SELECT a, b FROM t ORDER BY a'), [1, 'x']);
            assert.equal(await db.get('SELECT a FROM t WHERE a = 99'), null);
            assert.equal(await db.getArray('SELECT a FROM t WHERE a = 99'), null);
            assert.deepEqual(await db.select('SELECT a FROM t WHERE a = 99'), []);
        }));
});

describe('errors', () => {
    it('reports SQLite errors with codes and the statement', () =>
        withDb(async (db) => {
            await assert.rejects(db.execute('SELEKT 1'), (e: SqliteError) => {
                assert.ok(e instanceof SqliteError);
                assert.equal(e.code, 1);
                assert.match(e.message, /syntax error/);
                assert.equal(e.sql, 'SELEKT 1');
                return true;
            });
            await db.execute('CREATE TABLE t(a PRIMARY KEY, b NOT NULL)');
            await db.execute('INSERT INTO t VALUES (1, 2)');
            await assert.rejects(db.execute('INSERT INTO t VALUES (1, 3)'), (e: SqliteError) => e.code === 19 && e.extendedCode === 1555);
            await assert.rejects(db.execute('INSERT INTO t VALUES (2, NULL)'), (e: SqliteError) => e.code === 19 && e.extendedCode === 1299);
            assert.deepEqual(await db.select('SELECT * FROM t'), [{ a: 1, b: 2 }]);
        }));

    it('checks the parameter count', () =>
        withDb(async (db) => {
            await assert.rejects(db.get('SELECT ?, ?', [1]), (e: SqliteError) => e.code === -2 && /expected 2/.test(e.message));
            await assert.rejects(db.get('SELECT 1', [1]), (e: SqliteError) => e.code === -2);
        }));

    it('refuses several statements outside of scripts', () =>
        withDb(async (db) => {
            await assert.rejects(db.execute('SELECT 1; SELECT 2'), (e: SqliteError) => e.code === -2);
            await db.executeScript('CREATE TABLE a(x); INSERT INTO a VALUES (1); INSERT INTO a VALUES (2);');
            assert.equal((await db.get('SELECT COUNT(*) AS n FROM a')).n, 2);
            await assert.rejects(db.executeScript('CREATE TABLE a(x)'), SqliteError);
        }));

    it('fails the open and the first request with the same error', async () => {
        const db = open('/nonexistent-dir/x/y.db');
        await assert.rejects(db.ready, (e: SqliteError) => e.code === 14);
        assert.equal(db.isOpen, false);
        await assert.rejects(db.get('SELECT 1'), (e: SqliteError) => /unable to open/.test(e.message));
        await db.close();
    });

    it('opens read only and fails writes', async () => {
        const file = tmpDb();
        await withDb(async (db) => db.execute('CREATE TABLE t(a)'), file);
        await withDb(async (db) => {
            await db.ready;
            assert.deepEqual(await db.select('SELECT * FROM t'), []);
            await assert.rejects(db.execute('INSERT INTO t VALUES (1)'), (e: SqliteError) => e.code === 8);
        }, file, { readOnly: true });
    });

    it('runs initSql, wal and user_version', async () => {
        const file = tmpDb();
        await withDb(async (db) => {
            await db.ready;
            assert.equal((await db.get('PRAGMA journal_mode'))['journal_mode'], 'wal');
            assert.equal((await db.get('PRAGMA foreign_keys'))['foreign_keys'], 1);
            assert.equal(await db.getVersion(), 0);
            await db.setVersion(42);
            assert.equal(await db.getVersion(), 42);
            await assert.rejects(db.setVersion(1.5), TypeError);
        }, file, { wal: true, initSql: 'PRAGMA foreign_keys = ON' });
    });

    it('fails the open when initSql fails', async () => {
        const db = open(':memory:', { initSql: 'NOT SQL' });
        await assert.rejects(db.ready, SqliteError);
        await db.close();
    });

    it('explains an unusable engine', () => {
        assert.throws(() => open(':memory:', { engine: '/no/such/library.so' }), /No usable SQLite library/);
    });
});

describe('close', () => {
    it('rejects calls after close and closes twice', async () => {
        const db = open();
        await db.execute('CREATE TABLE t(a)');
        await db.close();
        assert.equal(db.isOpen, false);
        await assert.rejects(db.execute('SELECT 1'), (e: SqliteError) => e.code === -1);
        await db.close();
    });

    it('lets queued requests finish before closing', async () => {
        const db = open();
        await db.execute('CREATE TABLE t(a)');
        const inserts = [];
        for (let i = 0; i < 50; i++) {
            inserts.push(db.execute('INSERT INTO t VALUES (?)', i));
        }
        const closing = db.close();
        await Promise.all(inserts);
        await closing;
    });

    it('reports the SQLite library version and extension support', () =>
        withDb(async (db) => {
            assert.match(db.getSqliteVersion(), /^3\.\d+\.\d+/);
            await assert.rejects(db.loadExtension('/nope.so'), (e: SqliteError) => e.code === -5 || e.code > 0);
        }));
});

describe('each', () => {
    it('streams all rows in order', () =>
        withDb(async (db) => {
            await db.execute('CREATE TABLE t(a)');
            await db.batch(Array.from({ length: 1000 }, (_, i) => ['INSERT INTO t VALUES (?)', [i]] as [string, any[]]));
            const seen: number[] = [];
            let completed = -1;
            const count = await db.each(
                'SELECT a FROM t ORDER BY a',
                [],
                (err, row) => {
                    assert.equal(err, null);
                    seen.push(row.a);
                },
                (err, n) => {
                    assert.equal(err, null);
                    completed = n;
                }
            );
            assert.equal(count, 1000);
            assert.equal(completed, 1000);
            assert.deepEqual(seen, Array.from({ length: 1000 }, (_, i) => i));
        }));

    it('works with an exact multiple of the chunk size and with no rows', () =>
        withDb(async (db) => {
            await db.execute('CREATE TABLE t(a)');
            await db.batch(Array.from({ length: 512 }, (_, i) => ['INSERT INTO t VALUES (?)', [i]] as [string, any[]]));
            assert.equal(await db.each('SELECT a FROM t', [], () => {}), 512);
            assert.equal(await db.each('SELECT a FROM t WHERE a < 0', [], () => {}), 0);
        }));

    it('reports errors to the callbacks and rejects', () =>
        withDb(async (db) => {
            let cbError: Error = null;
            let completeError: Error = null;
            await assert.rejects(
                db.each('SELECT * FROM nope', [], (e) => (cbError = e), (e) => (completeError = e)),
                SqliteError
            );
            assert.equal(cbError, null);
            assert.ok(completeError instanceof SqliteError);
            // without complete the callback gets the error
            await assert.rejects(db.each('SELECT * FROM nope', [], (e) => (cbError = e)), SqliteError);
            assert.ok(cbError instanceof SqliteError);
        }));

    it('stops and rejects when the callback throws', () =>
        withDb(async (db) => {
            await db.execute('CREATE TABLE t(a)');
            await db.batch(Array.from({ length: 600 }, (_, i) => ['INSERT INTO t VALUES (?)', [i]] as [string, any[]]));
            let calls = 0;
            await assert.rejects(
                db.each('SELECT a FROM t', [], () => {
                    calls++;
                    throw new Error('boom');
                }),
                /boom/
            );
            assert.equal(calls, 1);
            assert.equal((await db.get('SELECT COUNT(*) AS n FROM t')).n, 600); // the connection is fine
        }));
});

describe('batch', () => {
    it('runs statements atomically and returns every result', () =>
        withDb(async (db) => {
            await db.execute('CREATE TABLE t(a INTEGER PRIMARY KEY, b)');
            const res = await db.batch([
                { sql: 'INSERT INTO t VALUES (?, ?)', params: [1, 'one'] },
                ['INSERT INTO t VALUES (?, ?)', [2, 'two']],
                'SELECT a, b FROM t ORDER BY a'
            ]);
            assert.equal(res.length, 3);
            assert.equal(res[0].changes, 1);
            assert.equal(res[1].lastInsertRowId, 2);
            assert.deepEqual(res[2].rows, [{ a: 1, b: 'one' }, { a: 2, b: 'two' }]);
        }));

    it('rolls everything back when one statement fails', () =>
        withDb(async (db) => {
            await db.execute('CREATE TABLE t(a INTEGER PRIMARY KEY)');
            await assert.rejects(db.batch([['INSERT INTO t VALUES (?)', [1]], ['INSERT INTO t VALUES (?)', [1]]]), (e: SqliteError) => e.code === 19);
            assert.equal((await db.get('SELECT COUNT(*) AS n FROM t')).n, 0);
            await db.execute('BEGIN'); // the connection is not left inside a transaction
            await db.execute('ROLLBACK');
        }));

    it('keeps earlier statements when not atomic', () =>
        withDb(async (db) => {
            await db.execute('CREATE TABLE t(a INTEGER PRIMARY KEY)');
            await assert.rejects(db.batch([['INSERT INTO t VALUES (?)', [1]], ['INSERT INTO t VALUES (?)', [1]]], { atomic: false }), SqliteError);
            assert.equal((await db.get('SELECT COUNT(*) AS n FROM t')).n, 1);
        }));

    it('handles an empty batch and big batches', () =>
        withDb(async (db) => {
            assert.deepEqual(await db.batch([]), []);
            await db.execute('CREATE TABLE t(a, b)');
            const n = 20000;
            const res = await db.batch(Array.from({ length: n }, (_, i) => ['INSERT INTO t VALUES (?, ?)', [i, 'row ' + i]] as [string, any[]]));
            assert.equal(res.length, n);
            assert.equal((await db.get('SELECT COUNT(*) AS n, MAX(a) AS m FROM t')).m, n - 1);
        }));
});

describe('transactions', () => {
    it('commits', () =>
        withDb(async (db) => {
            await db.execute('CREATE TABLE t(a)');
            const out = await db.transaction(async (cancel, tx) => {
                await tx.execute('INSERT INTO t VALUES (1)');
                assert.equal((await tx.get('SELECT COUNT(*) AS n FROM t')).n, 1);
                return 'done';
            });
            assert.equal(out, 'done');
            assert.equal((await db.get('SELECT COUNT(*) AS n FROM t')).n, 1);
        }));

    it('rolls back when the action throws and rethrows', () =>
        withDb(async (db) => {
            await db.execute('CREATE TABLE t(a)');
            await assert.rejects(
                db.transaction(async (cancel, tx) => {
                    await tx.execute('INSERT INTO t VALUES (1)');
                    throw new Error('nope');
                }),
                /nope/
            );
            assert.equal((await db.get('SELECT COUNT(*) AS n FROM t')).n, 0);
        }));

    it('rolls back on cancel', () =>
        withDb(async (db) => {
            await db.execute('CREATE TABLE t(a)');
            await db.transaction(async (cancel, tx) => {
                await tx.execute('INSERT INTO t VALUES (1)');
                cancel();
            });
            assert.equal((await db.get('SELECT COUNT(*) AS n FROM t')).n, 0);
        }));

    it('lets plain db calls join a running transaction (compatibility)', () =>
        withDb(async (db) => {
            await db.execute('CREATE TABLE t(a)');
            await db.transaction(async (cancel) => {
                await db.execute('INSERT INTO t VALUES (1)'); // through db, not tx
                cancel();
            });
            assert.equal((await db.get('SELECT COUNT(*) AS n FROM t')).n, 0);
        }));

    it('joins nested transactions', () =>
        withDb(async (db) => {
            await db.execute('CREATE TABLE t(a)');
            await db.transaction(async () => {
                await db.transaction(async () => {
                    await db.execute('INSERT INTO t VALUES (1)');
                });
                await db.execute('INSERT INTO t VALUES (2)');
            });
            assert.equal((await db.get('SELECT COUNT(*) AS n FROM t')).n, 2);
        }));

    it('makes requests started before it wait their turn, and outsiders wait for the end', () =>
        withDb(async (db) => {
            await db.execute('CREATE TABLE t(a)');
            const order: string[] = [];
            const before = db.execute('INSERT INTO t VALUES (0)').then(() => order.push('before'));
            const tx = db.transaction(async (cancel, t) => {
                order.push('begin');
                await t.execute('INSERT INTO t VALUES (1)');
                await new Promise((r) => setTimeout(r, 50));
                order.push('end');
            });
            await new Promise((r) => setTimeout(r, 10)); // the transaction is open, activeTx is set: this would join
            await Promise.all([before, tx]);
            assert.deepEqual(order, ['before', 'begin', 'end']);
        }));

    it('supports transaction modes', () =>
        withDb(async (db) => {
            for (const mode of ['deferred', 'immediate', 'exclusive'] as const) {
                await db.transaction(async () => {}, { mode });
            }
        }));

    it('two connections to a file: the second waits on the busy timeout', async () => {
        const file = tmpDb();
        const a = open(file, { wal: true });
        const b = open(file, { busyTimeout: 20 });
        try {
            await a.execute('CREATE TABLE t(a)');
            await b.ready;
            await a.transaction(async (cancel, tx) => {
                await tx.execute('INSERT INTO t VALUES (1)');
                await assert.rejects(b.execute('INSERT INTO t VALUES (2)'), (e: SqliteError) => e.code === 5); // SQLITE_BUSY
            });
            await b.execute('INSERT INTO t VALUES (3)');
            assert.equal((await a.get('SELECT COUNT(*) AS n FROM t')).n, 2);
        } finally {
            await a.close();
            await b.close();
        }
    });
});

describe('concurrency', () => {
    it('keeps the order of requests', () =>
        withDb(async (db) => {
            await db.execute('CREATE TABLE t(a)');
            const jobs = [];
            for (let i = 0; i < 500; i++) {
                jobs.push(db.execute('INSERT INTO t VALUES (?)', i));
            }
            await Promise.all(jobs);
            const rows = await db.selectArray('SELECT a FROM t ORDER BY rowid');
            assert.deepEqual(rows.map((r) => r[0]), Array.from({ length: 500 }, (_, i) => i));
        }));

    it('serves several databases in parallel', async () => {
        const dbs = [open(tmpDb()), open(tmpDb()), open(tmpDb())];
        try {
            await Promise.all(
                dbs.map(async (db, k) => {
                    await db.execute('CREATE TABLE t(a)');
                    await db.batch(Array.from({ length: 2000 }, (_, i) => ['INSERT INTO t VALUES (?)', [i * (k + 1)]] as [string, any[]]));
                    return db.get('SELECT SUM(a) AS s FROM t');
                })
            ).then((res) => assert.deepEqual(res.map((r) => r.s), [0, 1, 2].map((k) => (1999 * 2000 / 2) * (k + 1))));
        } finally {
            await Promise.all(dbs.map((d) => d.close()));
        }
    });

    it('returns big results', () =>
        withDb(async (db) => {
            const rows = await db.selectArray(
                `WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c WHERE x < 50000) SELECT x, printf('%.100d', x), zeroblob(16) FROM c`
            );
            assert.equal(rows.length, 50000);
            assert.equal(rows[49999][0], 50000);
            assert.equal(rows[49999][1].length, 100);
            assert.equal(rows[0][2].length, 16);
        }));
});

after(() => {
    // all databases are closed by the tests: nothing left to do, this only makes the intent explicit
});

describe('blocking calls', () => {
    it('run statements on the calling thread', () =>
        withDb(async (db) => {
            assert.deepEqual(db.executeSync('CREATE TABLE t(a, b)'), { changes: 0, lastInsertRowId: 0 });
            assert.deepEqual(db.executeSync('INSERT INTO t VALUES (?, ?)', [1, 'x']), { changes: 1, lastInsertRowId: 1 });
            db.executeSync('INSERT INTO t VALUES (?, ?)', [2, 'y']);
            assert.deepEqual(db.selectSync('SELECT * FROM t ORDER BY a'), [{ a: 1, b: 'x' }, { a: 2, b: 'y' }]);
            assert.deepEqual(db.selectArraySync('SELECT a FROM t ORDER BY a'), [[1], [2]]);
            assert.deepEqual(db.getSync('SELECT b FROM t WHERE a = ?', 2), { b: 'y' });
            assert.deepEqual(db.getArraySync('SELECT b FROM t WHERE a = ?', 1), ['x']);
            assert.equal(db.getSync('SELECT * FROM t WHERE a = 99'), null);
            assert.equal(db.getSync('SELECT ? AS big', 9007199254740993n, { int64: 'auto' }).big, 9007199254740993n);
            // and they see what the asynchronous calls wrote
            await db.execute('INSERT INTO t VALUES (3, "z")');
            assert.equal(db.getSync('SELECT COUNT(*) AS n FROM t').n, 3);
        }));

    it('throw SqliteError', () =>
        withDb(async (db) => {
            assert.throws(() => db.selectSync('SELEKT 1'), (e: SqliteError) => e instanceof SqliteError && e.code === 1 && e.sql === 'SELEKT 1');
            assert.throws(() => db.getSync('SELECT ?, ?', [1]), (e: SqliteError) => e.code === -2);
            assert.equal(db.getSync('SELECT 1 AS one').one, 1);
        }));

    it('join a transaction instead of waiting for its end', () =>
        withDb(async (db) => {
            db.executeSync('CREATE TABLE t(a)');
            const tx = db.transaction(async (cancel) => {
                db.executeSync('INSERT INTO t VALUES (1)'); // the BEGIN is not even done: must not deadlock
                assert.equal(db.getSync('SELECT COUNT(*) AS n FROM t').n, 1);
                cancel();
            });
            await tx;
            assert.equal(db.getSync('SELECT COUNT(*) AS n FROM t').n, 0);
        }));

    it('fail on a closed database', async () => {
        const db = open();
        await db.close();
        assert.throws(() => db.getSync('SELECT 1'), (e: SqliteError) => e.code === -1);
    });
});

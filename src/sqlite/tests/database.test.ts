import { strict as assert } from 'assert';
import { describe, it } from 'node:test';
import { SqliteError } from '../sqlite.common';
import { createNapiBackend } from '../backend.napi';
import { Database } from '../database';
import { translateAndroidFlags } from '../platform.common';
import { loadAddon, open, statement, tmpDb } from './support';

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
            const values = await db.getArray('SELECT ?, ?, ?, ?, ?, ?, ?, ?', [true, false, date, 12345678901234567n, new Uint8Array([1, 2]).buffer, new Uint16Array([1, 2]), [9, 8, 7], undefined]);
            assert.equal(values[0], 1);
            assert.equal(values[1], 0);
            assert.equal(values[2], '2026-10-13T10:00:00.000Z');
            assert.equal(values[3], 12345678901234567); // number by default
            assert.deepEqual(Array.from(values[4]), [1, 2]);
            assert.deepEqual(Array.from(values[5]), [1, 0, 2, 0]);
            assert.deepEqual(Array.from(values[6]), [9, 8, 7]);
            assert.equal(values[7], null);
        }));

    it('keeps 64 bit integers exact with int64 modes', () =>
        withDb(async (db) => {
            const big = 9007199254740993n;
            const query = 'SELECT ? AS big, 5 AS small, 3000000000 AS mid';
            const num = await db.get(query, big);
            assert.equal(num.big, 9007199254740992); // beyond 2^53 a number cannot hold it
            const auto = await db.get(query, big, { int64: 'auto' });
            assert.equal(auto.big, big);
            assert.equal(auto.mid, 3000000000);
            assert.equal(auto.small, 5);
            const all = await db.get(query, big, { int64: 'bigint' });
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
            const values = await db.getArray('SELECT ?, ?, ?, ?, ?', ['', long, mixed, emoji, 'quote " \\ \n \u0000 end']);
            assert.deepEqual(values, ['', long, mixed, emoji, 'quote " \\ \n \u0000 end']);
        }));

    it('rejects unsupported parameters', () =>
        withDb(async (db) => {
            // @ts-expect-error unsupported on purpose
            await assert.rejects(db.get('SELECT ?', { a: 1 }), TypeError);
            // @ts-expect-error unsupported on purpose
            await assert.rejects(db.get('SELECT ?', () => 1), TypeError);
            // @ts-expect-error unsupported on purpose
            await assert.rejects(db.get('SELECT ?', Symbol('x')), TypeError);
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
            await assert.rejects(db.execute('SELEKT 1'), (error: SqliteError) => {
                assert.ok(error instanceof SqliteError);
                assert.equal(error.code, 1);
                assert.match(error.message, /syntax error/);
                assert.equal(error.sql, 'SELEKT 1');
                return true;
            });
            await db.execute('CREATE TABLE t(a PRIMARY KEY, b NOT NULL)');
            await db.execute('INSERT INTO t VALUES (1, 2)');
            await assert.rejects(db.execute('INSERT INTO t VALUES (1, 3)'), (error: SqliteError) => error.code === 19 && error.extendedCode === 1555);
            await assert.rejects(db.execute('INSERT INTO t VALUES (2, NULL)'), (error: SqliteError) => error.code === 19 && error.extendedCode === 1299);
            assert.deepEqual(await db.select('SELECT * FROM t'), [{ a: 1, b: 2 }]);
        }));

    it('checks the parameter count', () =>
        withDb(async (db) => {
            await assert.rejects(db.get('SELECT ?, ?', [1]), (error: SqliteError) => error.code === -2 && /expected 2/.test(error.message));
            await assert.rejects(db.get('SELECT 1', [1]), (error: SqliteError) => error.code === -2);
        }));

    it('refuses several statements outside of scripts', () =>
        withDb(async (db) => {
            await assert.rejects(db.execute('SELECT 1; SELECT 2'), (error: SqliteError) => error.code === -2);
            await db.executeScript('CREATE TABLE a(x); INSERT INTO a VALUES (1); INSERT INTO a VALUES (2);');
            assert.equal((await db.get('SELECT COUNT(*) AS n FROM a')).n, 2);
            await assert.rejects(db.executeScript('CREATE TABLE a(x)'), SqliteError);
        }));

    it('fails the open and the first request with the same error', async () => {
        const db = open('/nonexistent-dir/x/y.db');
        await assert.rejects(db.ready, (error: SqliteError) => error.code === 14);
        assert.equal(db.isOpen, false);
        await assert.rejects(db.get('SELECT 1'), (error: SqliteError) => /unable to open/.test(error.message));
        await db.close();
    });

    it('opens read only and fails writes', async () => {
        const file = tmpDb();
        await withDb(async (db) => db.execute('CREATE TABLE t(a)'), file);
        await withDb(async (db) => {
            await db.ready;
            assert.deepEqual(await db.select('SELECT * FROM t'), []);
            await assert.rejects(db.execute('INSERT INTO t VALUES (1)'), (error: SqliteError) => error.code === 8);
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

    it('has no default engine: it asks for one', () => {
        assert.throws(() => new Database(createNapiBackend(loadAddon(), []), ':memory:'), /No SQLite engine chosen/);
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
        await assert.rejects(db.execute('SELECT 1'), (error: SqliteError) => error.code === -1);
        await db.close();
    });

    it('lets queued requests finish before closing', async () => {
        const db = open();
        await db.execute('CREATE TABLE t(a)');
        const inserts = [];
        for (let index = 0; index < 50; index++) {
            inserts.push(db.execute('INSERT INTO t VALUES (?)', index));
        }
        const closing = db.close();
        await Promise.all(inserts);
        await closing;
    });

    it('reports the SQLite library version and extension support', () =>
        withDb(async (db) => {
            assert.match(db.getSqliteVersion(), /^3\.\d+\.\d+/);
            await assert.rejects(db.loadExtension('/nope.so'), (error: SqliteError) => error.code === -5 || error.code > 0);
        }));
});

describe('each', () => {
    it('streams all rows in order', () =>
        withDb(async (db) => {
            await db.execute('CREATE TABLE t(a)');
            await db.batch(Array.from({ length: 1000 }, (_, index) => statement('INSERT INTO t VALUES (?)', index)));
            const seen: number[] = [];
            let completed = -1;
            const count = await db.each(
                'SELECT a FROM t ORDER BY a',
                [],
                (err, row) => {
                    assert.equal(err, null);
                    seen.push(row.a);
                },
                (err, eachCount) => {
                    assert.equal(err, null);
                    completed = eachCount;
                }
            );
            assert.equal(count, 1000);
            assert.equal(completed, 1000);
            assert.deepEqual(seen, Array.from({ length: 1000 }, (_, index) => index));
        }));

    it('works with an exact multiple of the chunk size and with no rows', () =>
        withDb(async (db) => {
            await db.execute('CREATE TABLE t(a)');
            await db.batch(Array.from({ length: 512 }, (_, index) => statement('INSERT INTO t VALUES (?)', index)));
            assert.equal(await db.each('SELECT a FROM t', [], () => {}), 512);
            assert.equal(await db.each('SELECT a FROM t WHERE a < 0', [], () => {}), 0);
        }));

    it('reports errors to the callbacks and rejects', () =>
        withDb(async (db) => {
            let cbError: Error = null;
            let completeError: Error = null;
            await assert.rejects(
                db.each('SELECT * FROM nope', [], (error) => (cbError = error), (error) => (completeError = error)),
                SqliteError
            );
            assert.equal(cbError, null);
            assert.ok(completeError instanceof SqliteError);
            // without complete the callback gets the error
            await assert.rejects(db.each('SELECT * FROM nope', [], (error) => (cbError = error)), SqliteError);
            assert.ok(cbError instanceof SqliteError);
        }));

    it('stops and rejects when the callback throws', () =>
        withDb(async (db) => {
            await db.execute('CREATE TABLE t(a)');
            await db.batch(Array.from({ length: 600 }, (_, index) => statement('INSERT INTO t VALUES (?)', index)));
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
            await assert.rejects(db.batch([['INSERT INTO t VALUES (?)', [1]], ['INSERT INTO t VALUES (?)', [1]]]), (error: SqliteError) => error.code === 19);
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
            const rowCount = 20000;
            const res = await db.batch(Array.from({ length: rowCount }, (_, index) => statement('INSERT INTO t VALUES (?, ?)', index, 'row ' + index)));
            assert.equal(res.length, rowCount);
            assert.equal((await db.get('SELECT COUNT(*) AS n, MAX(a) AS m FROM t')).m, rowCount - 1);
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
            const before = db.execute('INSERT INTO t VALUES (0)');
            const tx = db.transaction(async (cancel, transaction) => {
                order.push('begin');
                await transaction.execute('INSERT INTO t VALUES (1)');
                await new Promise((resolve) => setTimeout(resolve, 50));
                order.push('end');
            });
            await new Promise((resolve) => setTimeout(resolve, 10)); // the transaction is open, activeTx is set: this would join
            await Promise.all([before, tx]);
            // the order the database ran them in (independent of how many promise hops each result takes to reach JS)
            assert.deepEqual(await db.selectArray('SELECT a FROM t ORDER BY rowid'), [[0], [1]]);
            assert.deepEqual(order, ['begin', 'end']);
        }));

    it('supports transaction modes', () =>
        withDb(async (db) => {
            for (const mode of ['deferred', 'immediate', 'exclusive'] as const) {
                await db.transaction(async () => {}, { mode });
            }
        }));

    it('two connections to a file: the second waits on the busy timeout', async () => {
        const file = tmpDb();
        const first = open(file, { wal: true });
        const second = open(file, { busyTimeout: 20 });
        try {
            await first.execute('CREATE TABLE t(a)');
            await second.ready;
            await first.transaction(async (cancel, tx) => {
                await tx.execute('INSERT INTO t VALUES (1)');
                await assert.rejects(second.execute('INSERT INTO t VALUES (2)'), (error: SqliteError) => error.code === 5); // SQLITE_BUSY
            });
            await second.execute('INSERT INTO t VALUES (3)');
            assert.equal((await first.get('SELECT COUNT(*) AS n FROM t')).n, 2);
        } finally {
            await first.close();
            await second.close();
        }
    });
});

describe('concurrency', () => {
    it('keeps the order of requests', () =>
        withDb(async (db) => {
            await db.execute('CREATE TABLE t(a)');
            const jobs = [];
            for (let index = 0; index < 500; index++) {
                jobs.push(db.execute('INSERT INTO t VALUES (?)', index));
            }
            await Promise.all(jobs);
            const rows = await db.selectArray('SELECT a FROM t ORDER BY rowid');
            assert.deepEqual(rows.map((row) => row[0]), Array.from({ length: 500 }, (_, index) => index));
        }));

    it('serves several databases in parallel', async () => {
        const dbs = [open(tmpDb()), open(tmpDb()), open(tmpDb())];
        try {
            await Promise.all(
                dbs.map(async (db, dbIndex) => {
                    await db.execute('CREATE TABLE t(a)');
                    await db.batch(Array.from({ length: 2000 }, (_, index) => statement('INSERT INTO t VALUES (?)', index * (dbIndex + 1))));
                    return db.get('SELECT SUM(a) AS s FROM t');
                })
            ).then((res) => assert.deepEqual(res.map((row) => row.s), [0, 1, 2].map((dbIndex) => (1999 * 2000 / 2) * (dbIndex + 1))));
        } finally {
            await Promise.all(dbs.map((database) => database.close()));
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
            assert.throws(() => db.selectSync('SELEKT 1'), (error: SqliteError) => error instanceof SqliteError && error.code === 1 && error.sql === 'SELEKT 1');
            assert.throws(() => db.getSync('SELECT ?, ?', [1]), (error: SqliteError) => error.code === -2);
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
        assert.throws(() => db.getSync('SELECT 1'), (error: SqliteError) => error.code === -1);
    });
});

describe('a Node-API module that did not load its functions', () => {
    it('reports the reason the module gave', () => {
        assert.throws(() => createNapiBackend({ error: 'the runtime does not provide the Node-API function napi_x' }, []), /does not provide the Node-API function napi_x/);
        assert.throws(() => createNapiBackend({}, []), /did not export its functions/);
    });
});

describe('long text', () => {
    it('round trips long mixed-script text through the native utf-8 conversion', () =>
        withDb(async (db) => {
            const long = 'ligne é € 😀 漢字 — '.repeat(20000);
            await db.execute('CREATE TABLE t(a TEXT, b TEXT)');
            await db.execute('INSERT INTO t VALUES (?, ?)', [long, 'short é']);
            const row = await db.get('SELECT * FROM t');
            assert.equal(row.a, long);
            assert.equal(row.b, 'short é');
        }));
});

describe('3.x flags', () => {
    it('translates the android.database.sqlite flags, leaves SQLITE_OPEN flags alone', () => {
        assert.deepEqual(translateAndroidFlags({}), {});
        assert.deepEqual(translateAndroidFlags({ flags: 1 }), { flags: 1 }); // OPEN_READONLY is the same
        assert.deepEqual(translateAndroidFlags({ flags: 6 }), { flags: 6 }); // SQLITE_OPEN_READWRITE | CREATE
        assert.deepEqual(translateAndroidFlags({ flags: 0x10000000 }), { flags: 0x6 }); // CREATE_IF_NECESSARY
        assert.deepEqual(translateAndroidFlags({ flags: 0x10000000 | 0x10 | 1 }), { flags: 0x1 }); // read only wins
        assert.deepEqual(translateAndroidFlags({ flags: 0x20000000 | 0x10000000 }), { flags: 0x6, wal: true });
        assert.deepEqual(translateAndroidFlags({ flags: 0x20000000, wal: false }), { flags: 0x2, wal: false });
    });
});

describe('the 3.x README sample', () => {
    it('works as written: nothing awaited, a synchronous transaction callback', () =>
        withDb(async (db) => {
            const names = ['a', 'b', 'c'];
            db.execute('CREATE TABLE names (id INT, name TEXT)');
            db.transaction((_cancelTransaction) => {
                names.forEach((name, id) => {
                    db.execute('INSERT INTO names (id, name) VALUES (?, ?)', [id, name]);
                });
            });
            assert.deepEqual(await db.select('SELECT * FROM names ORDER BY id'), [
                { id: 0, name: 'a' },
                { id: 1, name: 'b' },
                { id: 2, name: 'c' }
            ]);
        }));
    it('cancelTransaction rolls back', () =>
        withDb(async (db) => {
            db.execute('CREATE TABLE t (id INT)');
            await db.transaction((cancel) => {
                db.execute('INSERT INTO t VALUES (1)');
                cancel();
            });
            assert.deepEqual(await db.select('SELECT * FROM t'), []);
        }));
});

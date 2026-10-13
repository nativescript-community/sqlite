import { strict as assert } from 'assert';
import { describe, it } from 'node:test';
import { SqliteError } from '../sqlite.common';
import { open, tmpDb } from './support';

// needs a SQLite that can load extensions (native/build-ext.sh): Homebrew's on macOS, the distribution's on Linux
const ENGINE = process.env.NSSQLITE_EXT_ENGINE || '';
const EXT = process.env.NSSQLITE_EXT_LIB || '';
const skip = !ENGINE || !EXT;

describe('extensions', { skip: skip && 'no SQLite with extension loading on this host' }, () => {
    it('the engine reports it can load extensions', async () => {
        const db = open(':memory:', { engine: ENGINE });
        await db.ready;
        assert.match(db.getSqliteVersion(), /^3\./);
        assert.equal(db.canLoadExtensions(), true);
        await db.close();
    });

    it('loads a dynamic extension and uses its functions', async () => {
        const db = open(':memory:', { engine: ENGINE });
        await db.loadExtension(EXT, 'sqlite3_nsext_init');
        assert.equal((await db.getArray('SELECT ns_double(21)'))[0], 42);
        assert.equal((await db.getArray("SELECT ns_hello('é€')"))[0], 'hello é€');
        assert.equal((await db.getArray('SELECT ns_ext_version()'))[0], 'ns_ext 1.0');
        await db.execute('CREATE TABLE t(x)');
        await db.batch(['INSERT INTO t VALUES (1)', 'INSERT INTO t VALUES (2)', 'INSERT INTO t VALUES (3)']);
        assert.equal((await db.getArray('SELECT ns_sumsq(x) FROM t'))[0], 14);
        await db.close();
    });

    it('guesses the entry point from the file name', async () => {
        const db = open(':memory:', { engine: ENGINE });
        await db.loadExtension(EXT);
        assert.equal((await db.getArray('SELECT ns_double(4)'))[0], 8);
        await db.close();
    });

    it('is per connection', async () => {
        const file = tmpDb();
        const a = open(file, { engine: ENGINE });
        const b = open(file, { engine: ENGINE });
        await a.loadExtension(EXT);
        assert.equal((await a.getArray('SELECT ns_double(1)'))[0], 2);
        await assert.rejects(b.get('SELECT ns_double(1)'), (e: SqliteError) => /no such function/.test(e.message));
        await a.close();
        await b.close();
    });

    it('loads while other requests are queued and from inside a transaction', async () => {
        const db = open(':memory:', { engine: ENGINE });
        await db.execute('CREATE TABLE t(x)');
        const pending = Promise.all([1, 2, 3].map((i) => db.execute('INSERT INTO t VALUES (?)', [i])));
        const loaded = db.loadExtension(EXT);
        await Promise.all([pending, loaded]);
        const sum = await db.transaction(async (_cancel, tx) => (await tx.getArray('SELECT ns_sumsq(x) FROM t'))[0]);
        assert.equal(sum, 14);
        await db.close();
    });

    it('rejects a missing library and a wrong entry point with a SqliteError', async () => {
        const db = open(':memory:', { engine: ENGINE });
        await assert.rejects(db.loadExtension('/nope/libnope.so'), (e: SqliteError) => e instanceof SqliteError && e.message.length > 0);
        await assert.rejects(db.loadExtension(EXT, 'sqlite3_nothing_init'), (e: SqliteError) => e instanceof SqliteError);
        // the database still works
        assert.equal((await db.getArray('SELECT 1'))[0], 1);
        await db.close();
    });
});

describe('engine without extension loading', () => {
    it('reports a clear error (system SQLite)', async () => {
        const db = open(':memory:');
        await db.ready;
        if (process.platform === 'darwin') {
            assert.equal(db.canLoadExtensions(), false);
        }
        if (process.platform !== 'darwin') {
            return; // distribution SQLite can usually load them
        }
        await assert.rejects(db.loadExtension('/x/libx.dylib'), (e: SqliteError) => e instanceof SqliteError && /extension/i.test(e.message));
        await db.close();
    });
});

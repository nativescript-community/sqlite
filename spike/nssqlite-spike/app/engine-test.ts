/* Custom SQLite engines and extensions on a device: the app picks the SQLite library, the plugin ships none.
 * Android: androidx sqlite-bundled, a custom amalgamation build (libsqlite_custom.so, FTS5 + a compiled-in extension),
 * SQLCipher (libsqlcipher.so), the loadable extension libns_ext.so, all in the same process.
 * iOS: whatever the app linked as the process SQLite: system (no extension loading), a static custom build, SQLCipher. */
import { File, knownFolders } from '@nativescript/core';
import { SqliteError, configure, openOrCreate } from '@nativescript-community/sqlite';

declare const __ANDROID__: boolean;
declare const NSBundle: any;

const log = (...a: any[]) => console.log('[ENGINE]', ...a);

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
    const a = JSON.stringify(actual);
    const b = JSON.stringify(expected);
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

function removeDb(file: string) {
    for (const s of ['', '-wal', '-shm', '-journal']) {
        try {
            if (File.exists(file + s)) File.fromPath(file + s).removeSync();
        } catch (e) {
            // ignore
        }
    }
}

const ANDROIDX = 'libsqliteJni.so';
const CUSTOM = 'libsqlite_custom.so';
const CIPHER = 'libsqlcipher.so';
const EXT = 'libns_ext.so';

/** The tests that apply to any engine that supports them (`engine` is what to pass as the `engine` option). */
async function cipherTests(tag: string, engine: string | null) {
    const file = `${knownFolders.documents().path}/engine-cipher-${tag}.db`;
    removeDb(file);
    const opts = { engine };
    await check(tag + ' cipher: encrypts the file', async () => {
        const db = openOrCreate(file, { ...opts, initSql: "PRAGMA key = 'secret'" });
        await db.execute('CREATE TABLE secrets(id INTEGER PRIMARY KEY, v TEXT)');
        await db.execute('INSERT INTO secrets(v) VALUES (?)', ['top secret']);
        const version = await db.get('PRAGMA cipher_version');
        log(tag, 'cipher_version', JSON.stringify(version));
        if (!version || !Object.values(version)[0]) throw new Error('no cipher_version');
        await db.close();
        // an encrypted file is not even valid UTF-8 on iOS: the read then gives nothing
        const text = File.fromPath(file).readTextSync();
        if (text && text.startsWith('SQLite format 3')) throw new Error('file is not encrypted');
        if (text && text.indexOf('top secret') >= 0) throw new Error('plain text found in the file');
    });
    await check(tag + ' cipher: no key / wrong key fail with NOTADB', async () => {
        const nokey = openOrCreate(file, opts);
        await rejects(nokey.select('SELECT * FROM secrets'), (e) => e instanceof SqliteError && e.code === 26, 'no key');
        await nokey.close();
        const wrong = openOrCreate(file, { ...opts, initSql: "PRAGMA key = 'nope'" });
        await rejects(wrong.select('SELECT * FROM secrets'), (e) => e instanceof SqliteError && e.code === 26, 'wrong key');
        await wrong.close();
    });
    await check(tag + ' cipher: right key reads, WAL works', async () => {
        const db = openOrCreate(file, { ...opts, initSql: "PRAGMA key = 'secret'", wal: true });
        eq(await db.select('SELECT id, v FROM secrets'), [{ id: 1, v: 'top secret' }]);
        await db.transaction(async (_c, tx) => {
            for (let i = 0; i < 100; i++) await tx.execute('INSERT INTO secrets(v) VALUES (?)', ['row ' + i]);
        });
        eq((await db.getArray('SELECT count(*) FROM secrets'))[0], 101);
        eq((await db.getArray('PRAGMA journal_mode'))[0], 'wal');
        await db.close();
    });
    removeDb(file);
}

async function extensionTests(tag: string, engine: string | null, extPath: string | null, staticExt: boolean, entry?: string) {
    const opts = { engine };
    await check(tag + ' extension: ' + (staticExt ? 'compiled in, no load needed' : 'missing before loadExtension'), async () => {
        const db = openOrCreate(':memory:', opts);
        if (staticExt) {
            eq((await db.getArray('SELECT ns_double(21), ns_hello(?), ns_ext_version()', 'é€')), [42, 'hello é€', 'ns_ext 1.0']);
        } else {
            await rejects(db.get('SELECT ns_double(21)'), (e) => /no such function/.test(e.message), 'before load');
        }
        await db.close();
    });
    if (extPath) {
        await check(tag + ' extension: loadExtension', async () => {
            const db = openOrCreate(':memory:', opts);
            if (!db.canLoadExtensions()) throw new Error('canLoadExtensions() is false');
            await db.loadExtension(extPath, entry);
            eq(await db.getArray('SELECT ns_double(21), ns_hello(?), ns_ext_version()', 'x'), [42, 'hello x', 'ns_ext 1.0']);
            await db.execute('CREATE TABLE t(x)');
            await db.batch(['INSERT INTO t VALUES (1)', 'INSERT INTO t VALUES (2)', 'INSERT INTO t VALUES (3)']);
            eq((await db.getArray('SELECT ns_sumsq(x) FROM t'))[0], 14);
            // other connection of the same engine did not get it
            const other = openOrCreate(':memory:', opts);
            if (!staticExt) {
                await rejects(other.get('SELECT ns_double(1)'), (e) => /no such function/.test(e.message), 'other connection');
            }
            await other.close();
            await db.close();
        });
        await check(tag + ' extension: errors', async () => {
            const db = openOrCreate(':memory:', opts);
            await rejects(db.loadExtension('/nope/libnope.so'), (e) => e instanceof SqliteError && e.message.length > 0, 'missing');
            await rejects(db.loadExtension(extPath, 'sqlite3_nothing_init'), (e) => e instanceof SqliteError, 'entry point');
            eq((await db.getArray('SELECT 1'))[0], 1);
            await db.close();
        });
    }
}

async function androidSuite(backend: string) {
    configure({ backend: backend as any });
    const tag = backend;
    let versions: Record<string, string> = {};
    await check(tag + ' engines report their version', async () => {
        for (const [name, lib] of [['androidx', ANDROIDX], ['custom', CUSTOM], ['cipher', CIPHER]]) {
            const db = openOrCreate(':memory:', { engine: lib });
            await db.ready;
            versions[name] = db.getSqliteVersion();
            eq((await db.getArray('SELECT sqlite_version()'))[0], versions[name], name + ' sqlite_version()');
            eq(db.canLoadExtensions(), true, name + ' canLoadExtensions');
            await db.close();
        }
        log(tag, 'versions', JSON.stringify(versions));
        eq(versions.custom, '3.53.4');
        if (versions.androidx === versions.custom) throw new Error('androidx and custom report the same version');
    });
    await check(tag + ' custom build: compile options, FTS5, JSON, RTREE', async () => {
        const db = openOrCreate(':memory:', { engine: CUSTOM });
        const opts = (await db.selectArray('PRAGMA compile_options')).map((r) => r[0]);
        for (const o of ['ENABLE_FTS5', 'DQS=0', 'TEMP_STORE=3', 'DEFAULT_MEMSTATUS=0']) {
            if (opts.indexOf(o) < 0) throw new Error('missing compile option ' + o + ' in ' + opts.join(','));
        }
        await db.execute('CREATE VIRTUAL TABLE docs USING fts5(title, body)');
        await db.execute("INSERT INTO docs VALUES ('native threads', 'sqlite on a worker'), ('other', 'nothing here')");
        eq((await db.select("SELECT title FROM docs WHERE docs MATCH 'worker'")), [{ title: 'native threads' }]);
        eq((await db.getArray(`SELECT json_extract('{"a":[1,2,{"b":7}]}', '$.a[2].b')`))[0], 7);
        await db.execute('CREATE VIRTUAL TABLE idx USING rtree(id, x0, x1)');
        await db.execute('INSERT INTO idx VALUES (1, 0, 10), (2, 20, 30)');
        eq((await db.select('SELECT id FROM idx WHERE x0 >= 15')), [{ id: 2 }]);
        // DQS=0: double quoted string literals are an error
        await rejects(db.select('SELECT "not a column"'), (e) => e instanceof SqliteError, 'DQS=0');
        await db.close();
    });
    await extensionTests(tag + ' custom', CUSTOM, EXT, true);
    await extensionTests(tag + ' androidx', ANDROIDX, EXT, false);
    await cipherTests(tag, CIPHER);
    await check(tag + ' configure({engine}) sets the default', async () => {
        configure({ engine: CUSTOM });
        const db = openOrCreate(':memory:');
        eq(db.getSqliteVersion(), '3.53.4');
        eq((await db.getArray('SELECT ns_double(2)'))[0], 4);
        await db.close();
        configure({ engine: ANDROIDX });
        const db2 = openOrCreate(':memory:');
        eq(db2.getSqliteVersion() === '3.53.4', false);
        await db2.close();
    });
    await check(tag + ' unknown engine throws with its name', async () => {
        let err: any;
        try {
            openOrCreate(':memory:', { engine: 'libnope_sqlite.so' });
        } catch (e) {
            err = e;
        }
        if (!err || String(err.message).indexOf('libnope_sqlite.so') < 0) throw new Error('unexpected: ' + err);
    });
    await check(tag + ' three engines at once, in parallel', async () => {
        const dir = knownFolders.documents().path;
        const engines = [ANDROIDX, CUSTOM, CIPHER];
        const files = engines.map((_e, i) => `${dir}/engine-multi-${tag}-${i}.db`);
        files.forEach(removeDb);
        const dbs = engines.map((engine, i) => openOrCreate(files[i], { engine, initSql: engine === CIPHER ? "PRAGMA key = 'k'" : undefined, wal: true }));
        await Promise.all(dbs.map((d) => d.execute('CREATE TABLE t(i INTEGER, v TEXT)')));
        await Promise.all(
            dbs.map(async (d) => {
                await d.transaction(async (_c, tx) => {
                    for (let i = 0; i < 300; i++) await tx.execute('INSERT INTO t VALUES (?, ?)', [i, 'v' + i]);
                });
            })
        );
        const counts = await Promise.all(dbs.map((d) => d.getArray('SELECT count(*), sum(i), sqlite_version() FROM t')));
        counts.forEach((c) => eq([c[0], c[1]], [300, 44850]));
        eq(new Set(counts.map((c) => c[2])).size >= 2, true, 'engine versions differ');
        await Promise.all(dbs.map((d) => d.close()));
        files.forEach(removeDb);
    });
}

/** The custom build, an embedded dynamic framework (native/build-custom-sqlite.sh ios) */
/** The SQLite of iOS itself, whatever else the app links */
const IOS_SYSTEM = '/usr/lib/libsqlite3.dylib';
/** A SQLite linked statically into the app, registered by native/provider/NSSqliteStaticProvider.m */
const IOS_STATIC = '@static';
const IOS_CUSTOM = '@rpath/NSCustomSqlite.framework/NSCustomSqlite';

async function iosSuite(backend: string) {
    configure({ backend: backend as any });
    const tag = backend;
    const probe = openOrCreate(':memory:', { engine: null });
    await probe.ready;
    const version = probe.getSqliteVersion();
    let hasExt = false;
    let isCipher = false;
    try {
        await probe.get('SELECT ns_ext_version()');
        hasExt = true;
    } catch (e) {
        // not the custom build
    }
    try {
        const r = await probe.getArray('PRAGMA cipher_version');
        isCipher = !!(r && r[0]);
    } catch (e) {
        // no
    }
    const canLoad = probe.canLoadExtensions();
    await probe.close();
    log(tag, 'process SQLite', version, 'static extension:', hasExt, 'sqlcipher:', isCipher, 'canLoadExtensions:', canLoad);

    if (!hasExt && !isCipher) {
        await check(tag + ' system SQLite: no extension loading, clear error', async () => {
            const db = openOrCreate(':memory:');
            eq(db.canLoadExtensions(), false);
            await rejects(db.loadExtension('/x/libx.dylib'), (e) => e instanceof SqliteError && /extension/i.test(e.message), 'loadExtension');
            eq((await db.getArray('SELECT 1'))[0], 1);
            await db.close();
        });
    }
    if (hasExt) {
        // linked into the process: the default engine is the custom build
        await check(tag + ' custom static build: version, FTS5, static extension', async () => {
            const db = openOrCreate(':memory:');
            eq(db.getSqliteVersion(), '3.53.4');
            await db.execute('CREATE VIRTUAL TABLE docs USING fts5(title, body)');
            await db.execute("INSERT INTO docs VALUES ('native threads', 'sqlite on a worker')");
            eq((await db.select("SELECT title FROM docs WHERE docs MATCH 'worker'")), [{ title: 'native threads' }]);
            await db.close();
        });
        await extensionTests(tag + ' custom', null, null, true);
    }
    if (isCipher) {
        await cipherTests(tag, null);
    }

    // an embedded dynamic framework, and a statically linked SQLite registered by its glue, picked with `engine`
    const candidates: Array<{ label: string; engine: string; ext: string | null }> = [
        { label: 'framework', engine: IOS_CUSTOM, ext: NSBundle.mainBundle.privateFrameworksPath + '/NSSampleExt.framework/NSSampleExt' },
        { label: 'static', engine: IOS_STATIC, ext: null }
    ];
    for (const c of candidates) {
        let available = false;
        try {
            const d = openOrCreate(':memory:', { engine: c.engine });
            await d.ready;
            available = true;
            await d.close();
        } catch (e) {
            log(tag, 'no', c.label, 'engine in this app:', String(e).slice(0, 100));
        }
        if (available) {
            await customEngineTests(tag + ' ' + c.label, c.engine, c.ext);
        }
    }
}

async function customEngineTests(tag: string, engine: string, ext: string | null) {
    await check(tag + ' engine: version, compile options, FTS5/JSON/RTREE', async () => {
        const db = openOrCreate(':memory:', { engine });
        eq(db.getSqliteVersion(), '3.53.4');
        const opts = (await db.selectArray('PRAGMA compile_options')).map((r) => r[0]);
        for (const o of ['ENABLE_FTS5', 'DQS=0', 'DEFAULT_MEMSTATUS=0']) {
            if (opts.indexOf(o) < 0) throw new Error('missing compile option ' + o);
        }
        await db.execute('CREATE VIRTUAL TABLE docs USING fts5(title, body)');
        await db.execute("INSERT INTO docs VALUES ('native threads', 'sqlite on a worker')");
        eq((await db.select("SELECT title FROM docs WHERE docs MATCH 'worker'")), [{ title: 'native threads' }]);
        eq((await db.getArray(`SELECT json_extract('{"a":[1,2,{"b":7}]}', '$.a[2].b')`))[0], 7);
        await db.close();
    });
    await extensionTests(tag, engine, ext, true, 'sqlite3_nsext_init');
    await check(tag + ' engine + system SQLite at once, in parallel', async () => {
        const dir = knownFolders.documents().path;
        const files = [0, 1].map((i) => `${dir}/engine-ios-multi-${tag.replace(/\W/g, '')}-${i}.db`);
        files.forEach(removeDb);
        const a = openOrCreate(files[0], { engine, wal: true });
        const b = openOrCreate(files[1], { engine: IOS_SYSTEM, wal: true });
        await Promise.all([a, b].map((d) => d.execute('CREATE TABLE t(i INTEGER)')));
        await Promise.all(
            [a, b].map((d) =>
                d.transaction(async (_c, tx) => {
                    for (let i = 0; i < 300; i++) await tx.execute('INSERT INTO t VALUES (?)', [i]);
                })
            )
        );
        const r = await Promise.all([a, b].map((d) => d.getArray('SELECT sum(i), sqlite_version() FROM t')));
        eq(r[0][0], 44850);
        eq(r[1][0], 44850);
        if (r[0][1] !== '3.53.4') throw new Error('engine is not the custom build: ' + r[0][1]);
        if (r[1][1] === '3.53.4') throw new Error('system engine is the custom build');
        eq(b.canLoadExtensions(), false);
        await Promise.all([a.close(), b.close()]);
        files.forEach(removeDb);
    });
}

export async function runEngineTests(backends: string[]) {
    passed = 0;
    failed = 0;
    for (const backend of backends) {
        try {
            if (__ANDROID__) await androidSuite(backend);
            else await iosSuite(backend);
        } catch (e) {
            failed++;
            log('SUITE ERROR', backend, String(e));
        }
    }
    log(`done passed=${passed} failed=${failed}`);
}

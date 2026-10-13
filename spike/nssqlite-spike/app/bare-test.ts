/* The bare package (@nativescript-community/sqlite-core): no SQLite, no dependency, the app chooses.
 * Run with an app that depends on sqlite-core only (see spike/README.md). */
import { SqliteError, configure, openOrCreate } from '@nativescript-community/sqlite-core';

declare const __ANDROID__: boolean;

const log = (...a: any[]) => console.log('[BARE]', ...a);

/** which bindings the app installed: 'napi' (sqlite-napi only), 'bridge' (sqlite-bridge only), 'none' (sqlite-core only) */
export async function runBareTests(installed: 'napi' | 'bridge' | 'none') {
    let passed = 0;
    let failed = 0;
    const check = async (name: string, fn: () => Promise<void> | void) => {
        try {
            await fn();
            passed++;
        } catch (e) {
            failed++;
            log('FAIL', name, String((e && (e as any).message) || e));
        }
    };
    const throws = (fn: () => any, re: RegExp) => {
        try {
            fn();
        } catch (e) {
            if (!re.test(String((e as any).message))) throw new Error('unexpected error: ' + e);
            return;
        }
        throw new Error('did not throw');
    };

    if (installed === 'none') {
        await check('no binding installed: says what to install', () => throws(() => openOrCreate(':memory:', { engine: 'x' }), /No native binding found/));
        log(`RESULT passed ${passed} failed ${failed}`);
        return;
    }
    if (installed === 'napi') {
        configure({ backend: 'bridge' });
        await check('napi only: the bridge is reported missing', () => throws(() => openOrCreate(':memory:', { engine: 'x' }), /bridge is not available.*sqlite-bridge/));
    } else {
        configure({ backend: 'napi' });
        await check('bridge only: Node-API is reported missing', () => throws(() => openOrCreate(':memory:', { engine: 'x' }), /Node-API binding is not available.*sqlite-napi/));
    }
    configure({ backend: installed === 'napi' ? 'napi' : 'auto' }); // 'auto' falls back to the bridge
    await check('no engine chosen: asks for one', () => throws(() => openOrCreate(':memory:'), /No SQLite engine chosen/));
    if (__ANDROID__) {
        await check('androidx is not there unless the app adds it', () => throws(() => openOrCreate(':memory:', { engine: 'libsqliteJni.so' }), /No usable SQLite library/));
    }
    configure({ engine: __ANDROID__ ? 'libsqlcipher.so' : null });
    await check('configure({engine}) then everything works', async () => {
        const db = openOrCreate(':memory:');
        await db.execute('CREATE TABLE t(a)');
        await db.batch([['INSERT INTO t VALUES (?)', [1]], ['INSERT INTO t VALUES (?)', [2]]]);
        const r = await db.getArray('SELECT sum(a), sqlite_version() FROM t');
        log('engine version', r[1]);
        if (r[0] !== 3) throw new Error('bad sum ' + r[0]);
        await db.close();
    });
    await check('errors are SqliteError', async () => {
        const db = openOrCreate(':memory:');
        let err: any;
        try {
            await db.execute('NOPE');
        } catch (e) {
            err = e;
        }
        if (!(err instanceof SqliteError)) throw new Error('not a SqliteError');
        await db.close();
    });
    log(`RESULT passed ${passed} failed ${failed}`);
}

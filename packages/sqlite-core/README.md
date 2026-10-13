<!-- ⚠️ This README has been generated from the file(s) "blueprint.md" ⚠️-->
<!--  !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
      !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
      !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
      !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
      !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
      !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
      !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
      !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
      !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
      DO NOT EDIT THIS READEME DIRECTLY! Edit "bluesprint.md" instead.
      !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
      !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
      !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
      !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
      !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
      !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
      !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
      !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
      !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!! -->
<h1 align="center">@nativescript-community/sqlite-core</h1>
<p align="center">
		<a href="https://npmcharts.com/compare/@nativescript-community/sqlite-core?minimal=true"><img alt="Downloads per month" src="https://img.shields.io/npm/dm/@nativescript-community/sqlite-core.svg" height="20"/></a>
<a href="https://www.npmjs.com/package/@nativescript-community/sqlite-core"><img alt="NPM Version" src="https://img.shields.io/npm/v/@nativescript-community/sqlite-core.svg" height="20"/></a>
	</p>

<p align="center">
  <b>SQLite for NativeScript without a SQLite library: you provide the engine (SQLCipher, a custom build...). Use @nativescript-community/sqlite for the ready-to-use setup.</b></br>
  <sub><sub>
</p>

<br />



[](#table-of-contents)

## Table of Contents

* [Which package](#which-package)
* [Installation](#installation)
	* [Choose the SQLite library](#choose-the-sqlite-library)
* [Usage](#usage)
	* [Async and sync](#async-and-sync)
	* [SQLCipher and other `PRAGMA key` setups](#sqlcipher-and-other-pragma-key-setups)
	* [Extensions](#extensions)
* [Bindings: Node-API, JNI, Objective-C](#bindings-node-api-jni-objective-c)
	* [If your runtime has Node-API: ignore the JNI and Objective-C parts](#if-your-runtime-has-node-api-ignore-the-jni-and-objective-c-parts)
	* [Using the Node-API binding directly](#using-the-node-api-binding-directly)
	* [Using the bridges directly](#using-the-bridges-directly)
	* [TypeORM](#typeorm)
	* [nano-sql](#nano-sql)
* [Migrating from 3.x](#migrating-from-3x)


[](#which-package)

## Which package

* **`@nativescript-community/sqlite-core`** (this one): the API and the native core. It depends on nothing and ships **no SQLite**: you choose the engine (`engine` option or `configure`), so there is nothing to patch out when you want SQLCipher or your own build.
* **[`@nativescript-community/sqlite`](../sqlite)**: this package plus a default engine: androidx sqlite-bundled on Android (it adds the gradle dependency, and opens databases in WAL mode) and the SQLite of the process on iOS. Pick it if you just want SQLite.
* **[`@nativescript-community/sqlite-android-framework`](../sqlite-android-framework)** (prototype): the SQLite of Android itself (`android.database.sqlite`) as the engine, for apps that want no SQLite library at all.


[](#installation)

## Installation
Run the following command from the root of your project:

`ns plugin add @nativescript-community/sqlite-core`

### Choose the SQLite library

This package opens a database only once an engine is chosen, with `configure({ engine })` (all databases) or `openOrCreate(file, { engine })` (one database). Without one it throws "No SQLite engine chosen".

* **Android**: add a library that exports the `sqlite3_*` C API to your app and name it as `engine`: `libsqlcipher.so` (`net.zetetic:sqlcipher-android`), `libsqliteJni.so` (androidx `sqlite-bundled`), your own build in `jniLibs`...
* **Android, no SQLite library at all**: [`@nativescript-community/sqlite-android-framework`](../sqlite-android-framework) uses the platform's `android.database.sqlite` as the engine (prototype).
* **iOS**: `engine: null` is the SQLite of the process: the system one, unless your app links another (a CocoaPods `SQLCipher`, or your own dynamic framework: it is found first). Explicit choices: `'/usr/lib/libsqlite3.dylib'` (system), `'@rpath/MySqlite.framework/MySqlite'` (an embedded framework).
* **iOS, SQLite linked statically** (a `.a`, static pod): symbols of static libraries are not reliably visible to `dlsym`, so the plugin cannot look them up. Build `native/provider/NSSqliteStaticProvider.m` into the same library (it registers the SQLite under a name at startup) and use `engine: '@static'`.

```typescript
import { isAndroid } from '@nativescript/core';
import { configure, openOrCreate } from '@nativescript-community/sqlite-core';

configure({ engine: isAndroid ? 'libsqlcipher.so' : null }); // before opening databases (null: the SQLite of the process, iOS)
const db = openOrCreate('secure.db', { initSql: "PRAGMA key = 'secret'" });
```

`engine` is per database, so several SQLites can live in one app: `openOrCreate('a.db', { engine: 'libsqliteJni.so' })` next to `openOrCreate('b.db', { engine: 'libsqlcipher.so' })`. An unusable engine throws at once, naming the library it tried.

Tested with: androidx sqlite-bundled (3.50.1), SQLCipher (`net.zetetic:sqlcipher-android` on Android, the `SQLCipher` pod on iOS), a vanilla SQLite amalgamation built with your own options (FTS5, `DQS=0`...; Android `.so`, iOS dynamic framework and iOS static library), and several of them in the same app at the same time.


[](#usage)

## Usage

Every call runs on a native thread and returns a promise: the JS thread is never blocked.

```typescript
import { openOrCreate } from '@nativescript-community/sqlite-core'; // or '@nativescript-community/sqlite'

const db = openOrCreate('my.db'); // a bare name goes to the databases folder (Android) / documents folder (iOS)
await db.execute('CREATE TABLE names (id INTEGER PRIMARY KEY, name TEXT)');

// one native call for many statements, all or nothing
await db.batch(names.map((name, id) => ['INSERT INTO names (id, name) VALUES (?, ?)', [id, name]]));

const rows = await db.select('SELECT * FROM names WHERE id > ?', [10]); // [{ id: 11, name: '...' }, ...]
const first = await db.get('SELECT * FROM names');
await db.each('SELECT * FROM names', [], (err, row) => {}); // streams big results

await db.transaction(async (cancel, tx) => {
    // `cancel()` rolls back, throwing too
    await tx.execute('INSERT INTO names (id, name) VALUES (?, ?)', [1, 'a']);
});

await db.close();
```

* Parameters: `null`/`undefined`, numbers, booleans, bigint, strings, `Date` (ISO string), `ArrayBuffer`/typed arrays (blob).
* Results: integers beyond 2^53 are numbers unless you ask for `{ int64: 'auto' | 'bigint' }`; blobs are `Uint8Array` (`{ transformBlobs: false }` for `ArrayBuffer`).
* Options of `openOrCreate`: `readOnly`, `flags`, `engine`, `busyTimeout`, `wal` (write-ahead logging, ignored for `:memory:` and read-only), `initSql` (runs first, e.g. `PRAGMA key = ...`). `configure({ defaultOptions })` sets options every database starts from.
* A database opens in the background: `await db.ready` (or `openOrCreate`'s async twin `openOrCreateAsync`) to wait for it and get the open error. A failed open also fails the first request, with the same `SqliteError`.
* Errors are `SqliteError`: `code` (primary SQLite code, e.g. 19 for a constraint), `extendedCode` (2067 for UNIQUE), `message`, `sql`.
* `db.getVersion()` / `db.setVersion(n)` read and write `PRAGMA user_version`; `db.getSqliteVersion()` is the version of the engine in use.

### Async and sync

The asynchronous methods never block. The `*Sync` twins (`executeSync`, `selectSync`, `selectArraySync`, `getSync`, `getArraySync`) block the calling thread until the database thread answers, which saves the event loop round trip of an awaited call. They exist for tiny statements in a loop; use the asynchronous methods for anything that can take long, a slow statement blocks the UI like any synchronous code. They need the Node-API binding (NativeScript 9.1+); with the bridge they throw.

```typescript
const db = openOrCreate('app.db');
await db.ready;

// asynchronous: concurrent, never blocks the JS thread
const [a, b] = await Promise.all([db.get('SELECT * FROM names WHERE id = ?', [1]), db.get('SELECT * FROM names WHERE id = ?', [2])]);
await db.batch(items); // 5000 inserts in one native call, atomic

// synchronous: a loop of tiny statements, e.g. 5000 inserts in a transaction or point lookups while building a screen
await db.transaction(async () => {
    for (let i = 0; i < 5000; i++) db.executeSync('INSERT INTO names (id, name) VALUES (?, ?)', [i, 'n' + i]); // joins the transaction
});
const row = db.getSync('SELECT * FROM names WHERE id = ?', [5]);
const [count] = db.getArraySync('SELECT count(*) FROM names');

// feature test, when the same code also runs on NativeScript 8
const hasSync = (() => { try { db.getSync('SELECT 1'); return true; } catch (e) { return false; } })();
```

Notes: a synchronous call queues behind the requests already sent on that database (order is kept); inside `db.transaction` it belongs to the transaction. On a phone (Android 14), 1000 awaited point lookups took 153 ms against 40 ms with `getSync`, and 5000 awaited inserts in a transaction 313 ms against 91 ms with `executeSync`; for bulk writes `batch()` is faster still (56 ms for 5000 inserts on that phone).

### SQLCipher and other `PRAGMA key` setups

`initSql` runs first on the new connection (before `wal`), so the key is the first statement SQLCipher sees:

```typescript
const db = openOrCreate('secure.db', { engine: 'libsqlcipher.so', initSql: "PRAGMA key = 'secret'", wal: true });
```

A wrong or missing key is reported by the first query (`SqliteError`, `code === 26`, "file is not a database").

### Extensions

SQLite extensions come in two forms, and the engine decides whether the second is possible: `db.canLoadExtensions()` is true for androidx, SQLCipher and your own builds, false for Apple's system SQLite and for the Android platform SQLite.

* **Compiled in**: build the extension into your SQLite (`-DSQLITE_EXTRA_INIT=...` calling `sqlite3_auto_extension`; `native/ext/custom_init.c` and `native/ext/ns_ext.c` in the repository are a working example, `native/build-custom-sqlite.sh` builds it for Android and iOS). Every connection has it, no JS call needed.
* **Loadable**: ship the extension as a shared library next to your SQLite and load it per connection:

```typescript
const db = openOrCreate('my.db', { engine: 'libsqliteJni.so' });
if (db.canLoadExtensions()) {
    await db.loadExtension('libmyext.so'); // entry point guessed from the file name: libmyext.so -> sqlite3_myext_init
    await db.loadExtension('libother.so', 'sqlite3_other_init'); // or given
}
const rows = await db.select("SELECT my_function('x')");
```

  * **Android**: put `libmyext.so` for each ABI in a folder of your app and add it to `App_Resources/Android/app.gradle` (the NativeScript template replaces the default `jniLibs` folders, so `src/main/jniLibs` is ignored):

    ```gradle
    android {
        sourceSets { main { jniLibs.srcDir "${rootProject.projectDir}/../../App_Resources/Android/native-libs" } } // native-libs/<abi>/libmyext.so
    }
    ```

  * **iOS**: only with an engine that supports it (your own SQLite as a dynamic framework) and the extension as an embedded, signed framework: `await db.loadExtension(NSBundle.mainBundle.privateFrameworksPath + '/MyExt.framework/MyExt', 'sqlite3_myext_init')`.
  * Errors (missing file, wrong entry point, engine without support) reject with a `SqliteError` and leave the database usable.


[](#bindings-node-api-jni-objective-c)

## Bindings: Node-API, JNI, Objective-C

The TypeScript API above is the same whatever runs underneath; this section is for knowing what is used, and for calling the bindings yourself.

| runtime | binding | what to know |
|---|---|---|
| NativeScript 9.1+ | **Node-API**, used directly from JS | the default; `*Sync` methods; works from Workers (each Worker has its own environment) |
| NativeScript 8 | **JNI** (Android) / **Objective-C** (iOS) bridge | the fallback; same native core, same API, no `*Sync` |

`configure({ backend: 'napi' | 'bridge' | 'auto' })` picks one (`'auto'`: Node-API when the runtime has it); it applies to databases opened afterwards.

### If your runtime has Node-API: ignore the JNI and Objective-C parts

On NativeScript 9.1+ you never touch, load or configure the bridges: the JNI class (`NativeSqlite.java`) and the Objective-C class (`NSSqliteBridge`) are only used when the Node-API binding is unavailable or when you force `backend: 'bridge'`. Nothing about them appears in your code, the limits of the bridges (no `*Sync`, the Android JNI reference limit the bridge works around) do not apply to you, and you can skip the *bridges* subsection below. `configure({ backend: 'napi' })` makes a missing Node-API an explicit error instead of a silent fallback.

What this costs: the bridge code is still packaged, because it shares a library with the C core (about 32 KB in `libnssqlite.so` per Android ABI, next to the 22 KB `libnssqlite_napi.so`; on iOS the static `NSSqlite` / `NSSqliteNapi` xcframeworks add 48 KB / 28 KB per architecture). It is never called.

### Using the Node-API binding directly

The addon exchanges bytes in the wire format of `core/nssqlite_wire.h` (also documented in the repository): you encode the parameters and decode the rows block yourself (`src/sqlite/codec.ts` is a reference implementation). In NativeScript get the addon with `require('nssqlite')` (on Android the first load goes through `require('system_lib://libnssqlite_napi.so')`); the example below is from a Node test, where `process.dlopen` loads the same module.

```javascript
const m = { exports: {} };
process.dlopen(m, '/path/to/nssqlite.node');
const ns = m.exports;

// params block: count:u32, then per value a tag byte + payload (0 NULL, 1 INT32, 3 DOUBLE, 4 TEXT = len:u32 + utf8)
function params(...values) {
    const enc = new TextEncoder();
    const chunks = [];
    const count = new Uint8Array(4);
    new DataView(count.buffer).setUint32(0, values.length, true);
    chunks.push(count);
    for (const v of values) {
        let b;
        if (v === null) b = Uint8Array.of(0);
        else if (typeof v === 'string') {
            const t = enc.encode(v);
            b = new Uint8Array(5 + t.length);
            b[0] = 4;
            new DataView(b.buffer).setUint32(1, t.length, true);
            b.set(t, 5);
        } else if (Number.isInteger(v)) {
            b = new Uint8Array(5);
            b[0] = 1;
            new DataView(b.buffer).setInt32(1, v, true);
        } else {
            b = new Uint8Array(9);
            b[0] = 3;
            new DataView(b.buffer).setFloat64(1, v, true);
        }
        chunks.push(b);
    }
    const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
    let o = 0;
    for (const c of chunks) { out.set(c, o); o += c.length; }
    return out.buffer;
}

const engine = ns.engine('libsqliteJni.so'); // null = the SQLite of the process; throws if unusable
console.log(ns.engineVersion(engine), ns.engineCanLoadExtensions(engine));

// open returns the handle at once; callbacks get (status, done, data, message, changes, lastInsertRowId) on the calling thread
const db = ns.open(engine, '/path/app.db', 0x6 /* READWRITE | CREATE */, 5000, /* wal */ true, /* initSql */ null,
    (status, _done, _data, message) => console.log(status === 0 ? 'open ok' : message));

const run = (sql, p) => new Promise((resolve, reject) => {
    // exec(db, tx = 0 (none), sql, params | null, flags = 0, chunkRows = 0 (no streaming), callback)
    const rc = ns.exec(db, 0, sql, p || null, 0, 0, (status, _done, data, message, changes, rowid) =>
        status ? reject(new Error(`${status}: ${message}`)) : resolve({ data, changes, rowid }));
    if (rc) reject(new Error('refused ' + rc)); // the callback is not called when the request is refused
});

await run('CREATE TABLE t(a INTEGER, b TEXT)');
const { changes, rowid } = await run('INSERT INTO t VALUES (?, ?)', params(7, 'seven'));
const { data } = await run('SELECT * FROM t'); // ArrayBuffer holding a rows block, starting with the magic 'NSR1'
const view = new DataView(data);
console.log(view.getUint32(4, true), 'columns', view.getUint32(8, true), 'rows');

// blocking: returns [status, data, message, changes, lastInsertRowId], no callback, no event loop round trip
const [status, blocked] = ns.execSync(db, 0, 'SELECT count(*) FROM t', null, 0);

ns.close(db, () => console.log('closed'));
```

Other exports: `batch(db, tx, request, flags, cb)`, `txBegin(db, mode, cb)` (returns the transaction id, 0 when refused), `txEnd(db, tx, commit, cb)`, `loadExtension(db, path, entry, cb)`, `apiVersion()`. Pass `chunkRows > 0` to `exec` to receive big results in several `done = false` chunks.

### Using the bridges directly

Only for NativeScript 8 (or when you force `backend: 'bridge'`). The calls map one to one to the Node-API ones; results are the same rows blocks. Prefer the TypeScript API, which does this for you (`platform.android.ts` / `platform.ios.ts`).

**iOS**: `NSSqliteBridge` (Objective-C), callbacks run on the run loop of the thread that made the call.

```typescript
declare const NSSqliteBridge: any, NSData: any, interop: any;
const B = NSSqliteBridge;

const engine = B.engineError(null); // nil = the SQLite of the process
const db = B.openPathFlagsBusyMsWalInitSqlCallback(engine, path, 0x6, 5000, true, null, (status, done, data, message) => {});
const onResult = (status, done, data, message, changes, rowid) => {
    const rows = data ? interop.bufferFromData(data) : null; // ArrayBuffer, the rows block
};
// exec(db, tx, sql, NSData | null, flags, chunkRows, callback): 0 = queued, negative = refused
B.execTxSqlParamsFlagsChunkRowsCallback(db, 0, 'SELECT * FROM t', NSData.dataWithData(params(1)), 0, 0, onResult);
B.closeCallback(db, () => B.releaseDb(db));
```

**Android**: `com.akylas.sqlite.NativeSqlite` (JNI). The NativeScript Android runtime keeps a global reference for every Java object or JS buffer it converts and aborts at 51200, so only numbers cross per request: the SQL and the parameters go through a request arena (one direct `ByteBuffer`, wrapped once) and results come back as numbers with their bytes in a result arena.

```typescript
declare const com: any;
const N = com.akylas.sqlite.NativeSqlite;
const resultBuffer = (ArrayBuffer as any).from(N.resultArena());
const request = new Uint8Array((ArrayBuffer as any).from(N.requestArena(64 * 1024)));
const pending = new Map<number, (r: any) => void>();
let nextId = 1;

N.setCallback(new N.Callback({
    onResult(id, status, done, dataLen, changes, rowid) {
        const callback = pending.get(Number(id));
        if (done) pending.delete(Number(id));
        const data = dataLen >= 0 ? resultBuffer.slice(0, dataLen) // copy it now: the arena is reused
            : dataLen === -2 ? (ArrayBuffer as any).from(N.takeBigData()).slice(0) : null; // bigger than the arena
        callback && callback({ status, done, data, message: status ? N.takeMessage() : null, changes: Number(changes), rowid: Number(rowid) });
    }
}));

const engine = N.engine('libsqliteJni.so');
let id = nextId++;
pending.set(id, (r) => console.log('open', r.status));
const db = N.open(engine, path, 0x6, 5000, true, null, id);

// exec: the SQL (UTF-8) at the start of the request arena, then the params block
const sql = new TextEncoder().encode('SELECT * FROM t');
request.set(sql, 0);
id = nextId++;
pending.set(id, (r) => console.log(r.data && r.data.byteLength));
N.exec(db, 0, sql.length, 0, 0, 0, id); // (db, tx, sqlLen, paramsLen, flags, chunkRows, id)
```

### TypeORM

```typescript
import 'reflect-metadata';
import { DataSource } from 'typeorm/browser';
import { installMixins } from '@nativescript-community/sqlite-core/typeorm'; // or '@nativescript-community/sqlite/typeorm'

installMixins();
const dataSource = new DataSource({ type: 'nativescript', database: 'app.db', entities: [/* ... */], synchronize: true, extra: { /* openOrCreate options */ } });
await dataSource.initialize();
```

TypeORM's browser build references every database driver and a few node modules, so the webpack config needs (see `spike/nssqlite-spike/webpack.config.js` for a working one): the `browser` alias field, an alias for the `typeorm/browser` prefix, `false` fallbacks for the node built-ins and an `IgnorePlugin` for the drivers you do not use (`pg`, `mysql`, `mongodb`, `sql.js`, ...). The driver is covered by integration tests (schema sync, repositories, relations, query builder, transactions) in Node and on NativeScript 9.1 Android and iOS.

### nano-sql

`@nativescript-community/sqlite-core/nanosql` uses `openOrCreate`, `execute` and `each` and keeps working on the new API (not covered by tests yet).


[](#migrating-from-3x)

## Migrating from 3.x

* The plugin no longer bundles SQLite on iOS (FMDB is gone) and uses no Android framework SQLite: see *Choose the SQLite library*.
* `threading` is ignored: everything is asynchronous and native.
* `getVersion()` / `setVersion()` are async. `wrapDb` is gone. `cursorWindowSize` and `cursorWindowName` do nothing.
* While a `transaction` runs, other calls made on the same `db` join it (as before). Use the `tx` argument to be explicit.
* The database opens in the background: errors come from `db.ready` or the first query, no more synchronous throw.

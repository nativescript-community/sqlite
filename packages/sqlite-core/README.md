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
  <b>SQLite for NativeScript: the API and the native core, without a SQLite library and without a binding. Add @nativescript-community/sqlite-napi (NativeScript 9.1+) and/or sqlite-bridge, and a SQLite engine; or use @nativescript-community/sqlite for all of it.</b></br>
  <sub><sub>
</p>

<br />



[](#table-of-contents)

## Table of Contents

* [Which packages](#which-packages)
* [Installation](#installation)
	* [Choose the SQLite library](#choose-the-sqlite-library)
* [Usage](#usage)
	* [Async and sync](#async-and-sync)
	* [SQLCipher and other `PRAGMA key` setups](#sqlcipher-and-other-pragma-key-setups)
	* [Extensions](#extensions)
* [Bindings: Node-API, JNI, Objective-C](#bindings-node-api-jni-objective-c)
	* [TypeORM](#typeorm)
	* [nano-sql](#nano-sql)
* [Migrating from 3.x](#migrating-from-3x)


[](#which-packages)

## Which packages

The plugin is several small packages, so an app only carries what it uses:

| package | what it is | native size (arm64 / Android, iOS device slice) |
|---|---|---|
| **`@nativescript-community/sqlite-core`** (this one) | the TypeScript API and the C core. No SQLite, no binding, no dependency | 28 KB / 32 KB |
| [`sqlite-napi`](../sqlite-napi) | the **Node-API** binding, for NativeScript 9.1+ (needs `sqlite-core`) | 23 KB / 29 KB |
| [`sqlite-bridge`](../sqlite-bridge) | the **JNI** and **Objective-C** bridges, for any NativeScript version and required by NativeScript 8 (needs `sqlite-core`) | 10 KB / 17 KB |
| [`sqlite-default-engine`](../sqlite-default-engine) | the **default SQLite**: androidx sqlite-bundled on Android (gradle dependency, WAL by default), the SQLite of the process on iOS. Import it once | + the androidx library |
| [`sqlite-shared-engine`](../sqlite-shared-engine) | a SQLite built as **`libsqlite.so`** (WAL by default on Android, the process SQLite on iOS), instead of `sqlite-default-engine`: libraries of your app that link `libsqlite.so` share it. Import it once | + `libsqlite.so` (~1.6 MB per ABI) |
| [`sqlite`](../sqlite) | everything: core + napi + bridge + default engine | all of the above |
| [`sqlite-android-framework`](../sqlite-android-framework) | the SQLite of Android itself (`android.database.sqlite`) as an engine, no SQLite library in the app (prototype) | 24 KB |

What to install:

| you want | install |
|---|---|
| it to just work on every NativeScript version | `@nativescript-community/sqlite` |
| NativeScript 9.1+ only, the default SQLite (androidx), **no bridges** | `sqlite-core` + `sqlite-napi` + `sqlite-default-engine` |
| NativeScript 9.1+ only, your own SQLite (SQLCipher, a custom build) | `sqlite-core` + `sqlite-napi` |
| NativeScript 8 (or 8 and 9) | `sqlite-core` + `sqlite-bridge` (+ `sqlite-napi` to use Node-API on 9.1+) + `sqlite-default-engine` or your own SQLite |
| no SQLite library in the Android app | `sqlite-core` + a binding + `sqlite-android-framework` |

Without a binding installed, opening a database throws an error saying which package to add.


[](#installation)

## Installation
Run the following command from the root of your project, with the binding you need:

`ns plugin add @nativescript-community/sqlite-core @nativescript-community/sqlite-napi`

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

The TypeScript API above is the same whatever runs underneath; the binding is picked when the first database opens:

| runtime | binding | package | what to know |
|---|---|---|---|
| NativeScript 9.1+ | **Node-API**, used directly from JS | [`sqlite-napi`](../sqlite-napi) | the default; `*Sync` methods; works from Workers (each Worker has its own environment) |
| any, required by NativeScript 8 | **JNI** (Android) / **Objective-C** (iOS) bridge | [`sqlite-bridge`](../sqlite-bridge) | same native core, same API, no `*Sync` |

`configure({ backend: 'napi' | 'bridge' | 'auto' })` picks one (`'auto'`, the default: Node-API when it is installed and the runtime has it, otherwise the bridge); it applies to databases opened afterwards, and a missing binding is an explicit error naming the package to install.

**If your runtime has Node-API, ignore the JNI and Objective-C parts: do not install `sqlite-bridge`.** Nothing of the bridges is then in your app: no `NativeSqlite.java`, no `libnssqlite_jni.so`, no `NSSqliteBridge`, and the limits of the bridges (no `*Sync`, the Android JNI reference limit they work around) do not concern you. `configure({ backend: 'napi' })` makes a missing Node-API an error instead of a silent fallback. The reverse holds too: on NativeScript 8 only `sqlite-bridge` is needed.

The raw use of each binding (calling the native module without the TypeScript layer) is documented in the binding's own package: [`sqlite-napi`](../sqlite-napi) and [`sqlite-bridge`](../sqlite-bridge).

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

The complete list, with examples, is in the [migration guide](https://github.com/nativescript-community/sqlite/blob/master/MIGRATION.md). In short:

* The plugin no longer bundles SQLite on iOS (FMDB is gone) and uses no Android framework SQLite: see *Choose the SQLite library*.
* `threading` is ignored: everything is asynchronous and native.
* `getVersion()` / `setVersion()` are async. `wrapDb` is gone. `cursorWindowSize` and `cursorWindowName` do nothing.
* While a `transaction` runs, other calls made on the same `db` join it (as before). Use the `tx` argument to be explicit.
* The database opens in the background: errors come from `db.ready` or the first query, no more synchronous throw.

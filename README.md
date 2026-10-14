<!-- ⚠️ This README has been generated from the file(s) "blueprint.md" ⚠️-->This monorepo contains multiple packages:<br><br>
<details open>
<summary><b>sqlite</b></summary>

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
<h1 align="center">@nativescript-community/sqlite</h1>
<p align="center">
		<a href="https://npmcharts.com/compare/@nativescript-community/sqlite?minimal=true"><img alt="Downloads per month" src="https://img.shields.io/npm/dm/@nativescript-community/sqlite.svg" height="20"/></a>
<a href="https://www.npmjs.com/package/@nativescript-community/sqlite"><img alt="NPM Version" src="https://img.shields.io/npm/v/@nativescript-community/sqlite.svg" height="20"/></a>
	</p>

<p align="center">
  <b>SQLite for NativeScript, everything included: native threads, Node-API and JNI / Objective-C bindings, a default SQLite on each platform. Pick the smaller packages (sqlite-core, sqlite-napi...) to bring your own.</b></br>
  <sub><sub>
</p>

<br />



[](#table-of-contents)


[](#table-of-contents)

## Table of Contents

* [Installation](#installation)
* [Migrating from 3.x](#migrating-from-3x)
* [Usage](#usage)
	* [Async and sync](#async-and-sync)
	* [WAL by default on Android](#wal-by-default-on-android)
	* [Extensions](#extensions)
	* [Another SQLite for some or all databases](#another-sqlite-for-some-or-all-databases)
	* [TypeORM](#typeorm)
	* [Node-API on Android, NativeScript 8 on iOS (or the reverse)](#node-api-on-android-nativescript-8-on-ios-or-the-reverse)
	* [Do not want the default SQLite?](#do-not-want-the-default-sqlite)


[](#installation)


[](#installation)

## Installation
Run the following command from the root of your project:

`ns plugin add @nativescript-community/sqlite`

This brings everything and needs no setup: [`sqlite-core`](../sqlite-core) (the API and the native core), [`sqlite-napi`](../sqlite-napi) (Node-API binding, NativeScript 9.1+), [`sqlite-bridge`](../sqlite-bridge) (JNI / Objective-C, any NativeScript version) and [`sqlite-default-engine`](../sqlite-default-engine) (the default SQLite):

* **Android**: androidx `sqlite-bundled` (a recent SQLite with FTS5, JSON, RTREE, math functions, ~0.65 MB per ABI), added to your app by this package's `include.gradle`. Engine `libsqliteJni.so`.
* **iOS**: the SQLite of the process: the system SQLite, or the one your app links (e.g. a CocoaPods `SQLCipher`).

Everything of `sqlite-core` is re-exported, and so are its `/typeorm` and `/nanosql` entries. The full reference (options, bindings, raw Node-API / bridge use) is in the [`sqlite-core` documentation](../sqlite-core).


[](#migrating-from-3x)


[](#migrating-from-3x)

## Migrating from 3.x

4.0 keeps the API names and shapes, but a few things changed on purpose (`close()` and `getVersion()` return promises, parameters are bound with their real types, WAL is on by default on Android, the native database objects are gone). See the [migration guide](https://github.com/nativescript-community/sqlite/blob/master/MIGRATION.md).


[](#usage)


[](#usage)

## Usage

Every call runs on a native thread and returns a promise: the JS thread is never blocked.

```typescript
import { openOrCreate } from '@nativescript-community/sqlite';

const db = openOrCreate('my.db'); // a bare name goes to the databases folder (Android) / documents folder (iOS)
await db.execute('CREATE TABLE names (id INTEGER PRIMARY KEY, name TEXT)');

// many statements in one native call, all or nothing
await db.batch(names.map((name, id) => ['INSERT INTO names (id, name) VALUES (?, ?)', [id, name]]));

const rows = await db.select('SELECT * FROM names WHERE id > ?', [10]); // [{ id: 11, name: '...' }, ...]
const first = await db.get('SELECT * FROM names');
await db.each('SELECT * FROM names', [], (err, row) => {}); // streams big results

await db.transaction(async (cancel, tx) => {
    // throwing or cancel() rolls back
    await tx.execute('INSERT INTO names (id, name) VALUES (?, ?)', [1, 'a']);
});

await db.close();
```

### Async and sync

```typescript
// asynchronous: start many at once, nothing blocks
const [a, b] = await Promise.all([db.get('SELECT * FROM names WHERE id = ?', [1]), db.get('SELECT * FROM names WHERE id = ?', [2])]);

// synchronous (NativeScript 9.1+): block the calling thread, no event loop round trip. Tiny statements in a loop only.
await db.transaction(async () => {
    for (let i = 0; i < 5000; i++) db.executeSync('INSERT INTO names (id, name) VALUES (?, ?)', [i, 'n' + i]);
});
const row = db.getSync('SELECT * FROM names WHERE id = ?', [5]);
```

`executeSync`, `selectSync`, `selectArraySync`, `getSync` and `getArraySync` throw on NativeScript 8, which uses the bridge. See *Async and sync* in the core documentation for when each pays off.

### WAL by default on Android

**Android databases open in WAL mode by default** (`wal: true`): with SQLite's default journal every commit creates, syncs and deletes a journal file, which made 500 awaited one-statement writes take 2.6 s on a phone (38 ms in WAL). It adds `-wal` / `-shm` files next to the database (`deleteDatabase` removes them). Opt out per database with `{ wal: false }`, or for all with `configure({ defaultOptions: { wal: false } })`. In-memory and read-only databases ignore it. iOS keeps SQLite's default.

### Extensions

The default Android engine (androidx sqlite-bundled) can load SQLite extensions; the system SQLite of iOS cannot (see the core documentation for iOS and for compiled-in extensions).

```typescript
const db = openOrCreate('my.db');
if (db.canLoadExtensions()) {
    await db.loadExtension('libmyext.so'); // entry point guessed from the name: sqlite3_myext_init, or pass it as 2nd argument
}
await db.select("SELECT my_function('x')");
```

Ship `libmyext.so` for each ABI in a folder of your app and declare it in `App_Resources/Android/app.gradle` (the NativeScript template replaces the default `jniLibs` folders):

```gradle
android {
    sourceSets { main { jniLibs.srcDir "${rootProject.projectDir}/../../App_Resources/Android/native-libs" } } // native-libs/<abi>/libmyext.so
}
```

### Another SQLite for some or all databases

`engine` is per database and `configure` sets the default; use them to put SQLCipher or your own build next to the default one:

```typescript
import { configure, openOrCreate } from '@nativescript-community/sqlite';

const plain = openOrCreate('cache.db'); // default engine
const secure = openOrCreate('secure.db', { engine: 'libsqlcipher.so', initSql: "PRAGMA key = 'secret'" }); // Android: add net.zetetic:sqlcipher-android
configure({ engine: 'libmysqlite.so' }); // or change it for every database opened afterwards
```

### TypeORM

```typescript
import 'reflect-metadata';
import { DataSource } from 'typeorm/browser';
import { installMixins } from '@nativescript-community/sqlite/typeorm';

installMixins();
const dataSource = new DataSource({ type: 'nativescript', database: 'app.db', entities: [/* ... */], synchronize: true });
await dataSource.initialize();
```

The webpack changes TypeORM's browser build needs are listed in the [core documentation](../sqlite-core#typeorm).

### Node-API on Android, NativeScript 8 on iOS (or the reverse)

You get both bindings on both platforms. Leave the one you do not need out of that platform's build, for example the JNI library on Android: see *One platform with Node-API, the other with the bridge* in the [`sqlite-bridge`](../sqlite-bridge) documentation.

### Do not want the default SQLite?

Depend on [`@nativescript-community/sqlite-core`](../sqlite-core) and the binding you need instead of this package: no SQLite and no gradle dependency come with them, so there is nothing to override or patch out when you use SQLCipher or your own build. Only need NativeScript 9.1+ with the default SQLite? `sqlite-core` + `sqlite-napi` + `sqlite-default-engine` is the same without the JNI / Objective-C bridges. See *Which packages* in the core documentation.

</details>
<details open>
<summary><b>sqlite-android-framework</b></summary>

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
<h1 align="center">@nativescript-community/sqlite-android-framework</h1>
<p align="center">
		<a href="https://npmcharts.com/compare/@nativescript-community/sqlite-android-framework?minimal=true"><img alt="Downloads per month" src="https://img.shields.io/npm/dm/@nativescript-community/sqlite-android-framework.svg" height="20"/></a>
<a href="https://www.npmjs.com/package/@nativescript-community/sqlite-android-framework"><img alt="NPM Version" src="https://img.shields.io/npm/v/@nativescript-community/sqlite-android-framework.svg" height="20"/></a>
	</p>

<p align="center">
  <b>Use the SQLite of the Android platform (android.database.sqlite) as the engine of @nativescript-community/sqlite-core: no SQLite library in the app.</b></br>
  <sub><sub>
</p>

<br />



[](#table-of-contents)


[](#table-of-contents)

## Table of Contents

* [Installation](#installation)
	* [Using it](#using-it)
	* [Prototype: what to know](#prototype-what-to-know)


[](#installation)


[](#installation)

## Installation

Needs [`@nativescript-community/sqlite-core`](../sqlite-core) and a binding ([`sqlite-napi`](../sqlite-napi) for NativeScript 9.1+, [`sqlite-bridge`](../sqlite-bridge) for any version). Run from the root of your project:

`ns plugin add @nativescript-community/sqlite-core @nativescript-community/sqlite-napi @nativescript-community/sqlite-android-framework`

```typescript
import { openOrCreate } from '@nativescript-community/sqlite-core';
import { useFrameworkEngine } from '@nativescript-community/sqlite-android-framework';

useFrameworkEngine(); // every database now runs on android.database.sqlite
const db = openOrCreate('my.db');
// or per database: loadFrameworkEngine(); openOrCreate('my.db', { engine: FRAMEWORK_ENGINE })
```

The app carries **no SQLite library** (this package is ~25 KB per ABI): the SQLite of the platform is used, with the native threads, the batching and the whole API of sqlite-core on top. The Android part is a small shim exposing the `sqlite3_*` functions the core needs on top of `android.database.sqlite`, so nothing in the core is specific to it. Works with both bindings (Node-API and JNI).

### Using it

Everything of [`sqlite-core`](../sqlite-core) works on top: promises on native threads, `batch`, `transaction`, `each`, `*Sync` (NativeScript 9.1+, they work but are not faster here, the Java round trip per statement dominates), TypeORM, both bindings.

```typescript
import { openOrCreate } from '@nativescript-community/sqlite-core';
import { FRAMEWORK_ENGINE, loadFrameworkEngine } from '@nativescript-community/sqlite-android-framework';

loadFrameworkEngine(); // once: loads the native shim
const a = openOrCreate('app.db', { engine: FRAMEWORK_ENGINE, wal: true });
const b = openOrCreate('other.db', { engine: 'libsqliteJni.so' }); // another SQLite in the same app is fine
const rows = await a.select('SELECT sqlite_version() AS v, count(*) AS n FROM sqlite_master');
```

**Extensions are not available** (the framework does not allow loading them): `a.canLoadExtensions()` is false and `a.loadExtension(...)` rejects with a `SqliteError`. For extensions, SQLCipher or a fixed SQLite version use the androidx engine of [`@nativescript-community/sqlite`](../sqlite) or your own, see the core documentation.

### Prototype: what to know

* **The platform decides** the SQLite version (older Android versions ship much older SQLites, OEMs differ) and its options: check `db.getSqliteVersion()` at run time. No extensions (`canLoadExtensions()` is false), no SQLCipher, a fixed busy timeout (`busyTimeout` is ignored).
* One statement per call, as with the other engines; `executeScript` and `batch` split statements with a small scanner (strings, comments, `CREATE TRIGGER ... END` are handled).
* Transactions use the framework's session (`BEGIN` is `IMMEDIATE`, or `EXCLUSIVE` when asked; `DEFERRED` is run as `IMMEDIATE`).
* **Big rows:** a row has to fit in the framework's cursor window, 2 MB by default. This package uses 16 MB; set it with `useFrameworkEngine({ cursorWindowSize })` or `loadFrameworkEngine({ cursorWindowSize })` (bytes, `0` keeps the platform's 2 MB). The memory is mapped but only the pages a query fills are used. A row over the window fails with an error that names `cursorWindowSize`.
* The first read of a result makes the framework count all rows: very big results cost twice the stepping.
* `changes` / `lastInsertRowId` after an `INSERT` cost a second tiny query.
* Speed (emulator, warm, against androidx sqlite-bundled through the same core): `select` of 20000 rows ~14 ms vs ~3 ms, 1000 awaited point lookups ~55 ms vs ~40 ms, 5000 inserts in a transaction ~80 ms vs ~20 ms, `batch()` of 5000 inserts ~60 ms vs ~7 ms.

</details>
<details open>
<summary><b>sqlite-bridge</b></summary>

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
<h1 align="center">@nativescript-community/sqlite-bridge</h1>
<p align="center">
		<a href="https://npmcharts.com/compare/@nativescript-community/sqlite-bridge?minimal=true"><img alt="Downloads per month" src="https://img.shields.io/npm/dm/@nativescript-community/sqlite-bridge.svg" height="20"/></a>
<a href="https://www.npmjs.com/package/@nativescript-community/sqlite-bridge"><img alt="NPM Version" src="https://img.shields.io/npm/v/@nativescript-community/sqlite-bridge.svg" height="20"/></a>
	</p>

<p align="center">
  <b>JNI and Objective-C bridges of @nativescript-community/sqlite-core, for NativeScript runtimes without Node-API (NativeScript 8 and older).</b></br>
  <sub><sub>
</p>

<br />



[](#table-of-contents)


[](#table-of-contents)

## Table of Contents

* [What it is](#what-it-is)
* [Installation](#installation)
* [Usage](#usage)
	* [One platform with Node-API, the other with the bridge](#one-platform-with-node-api-the-other-with-the-bridge)
* [Using the bridges directly](#using-the-bridges-directly)


[](#what-it-is)


[](#what-it-is)

## What it is

The **JNI** (Android) and **Objective-C** (iOS) bridges of [`@nativescript-community/sqlite-core`](../sqlite-core), for runtimes without Node-API: **NativeScript 8 and older**. They map the native core one to one, so the whole API of the core is available with the same behaviour (only the `*Sync` methods need Node-API).

* Works on every NativeScript version. On NativeScript 9.1+ it is only used when `sqlite-napi` is not installed or when you force `backend: 'bridge'`.
* If you target NativeScript 9.1+ only, you do not need this package: leave it out and nothing of the bridges is in your app.
* Contents: `libnssqlite_jni.so` (10 KB per Android ABI, arm64) with `NativeSqlite.java`; `NSSqliteBridge.xcframework` (17 KB for the iOS device slice).
* The Android bridge exchanges only numbers per request (the NativeScript runtime aborts at 51200 JNI global references): SQL and parameters go through a per-thread request arena, results through a result arena.


[](#installation)


[](#installation)

## Installation

`ns plugin add @nativescript-community/sqlite-core @nativescript-community/sqlite-bridge`

then choose a SQLite engine (see the [`sqlite-core`](../sqlite-core) documentation), or install [`@nativescript-community/sqlite`](../sqlite) which brings a default one and both bindings.


[](#usage)


[](#usage)

## Usage

There is nothing to call: [`sqlite-core`](../sqlite-core) uses the bridge when Node-API is not there. To force it, for example to test NativeScript 8 behaviour on a newer runtime:

```typescript
import { configure, openOrCreate } from '@nativescript-community/sqlite-core';

configure({ backend: 'bridge' }); // throws a clear error when this package is missing
const db = openOrCreate('app.db', { engine: 'libsqlcipher.so' });
await db.select('SELECT * FROM t');
```

### One platform with Node-API, the other with the bridge

A package is installed for both platforms, so an app whose Android runtime has Node-API but whose iOS runtime is NativeScript 8 would carry the JNI bridge on Android for nothing. Install `@nativescript-community/sqlite` (or core + napi + bridge) and leave the JNI library out of the Android build in `App_Resources/Android/app.gradle`:

```gradle
android {
    packagingOptions {
        exclude '**/libnssqlite_jni.so' // sqlite-bridge on Android: Node-API is used, the JNI library is never loaded
    }
}
```

(The few lines of `NativeSqlite.java` stay in the dex, unused.) On iOS the bridge is kept. If both runtimes have Node-API, simply do not install `sqlite-bridge`. Checked on the Android emulator with NativeScript 9.1: the APK holds `libnssqlite_core.so`, `libnssqlite_napi.so` and the SQLite library only, and the whole test suite passes with `backend: 'napi'`.


[](#using-the-bridges-directly)


[](#using-the-bridges-directly)

## Using the bridges directly

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


</details>
<details open>
<summary><b>sqlite-core</b></summary>

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


[](#which-packages)

## Which packages

The plugin is several small packages, so an app only carries what it uses:

| package | what it is | native size (arm64 / Android, iOS device slice) |
|---|---|---|
| **`@nativescript-community/sqlite-core`** (this one) | the TypeScript API and the C core. No SQLite, no binding, no dependency | 28 KB / 32 KB |
| [`sqlite-napi`](../sqlite-napi) | the **Node-API** binding, for NativeScript 9.1+ (needs `sqlite-core`) | 23 KB / 29 KB |
| [`sqlite-bridge`](../sqlite-bridge) | the **JNI** and **Objective-C** bridges, for any NativeScript version and required by NativeScript 8 (needs `sqlite-core`) | 10 KB / 17 KB |
| [`sqlite-default-engine`](../sqlite-default-engine) | the **default SQLite**: androidx sqlite-bundled on Android (gradle dependency, WAL by default), the SQLite of the process on iOS. Import it once | + the androidx library |
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


[](#migrating-from-3x)

## Migrating from 3.x

The complete list, with examples, is in the [migration guide](https://github.com/nativescript-community/sqlite/blob/master/MIGRATION.md). In short:

* The plugin no longer bundles SQLite on iOS (FMDB is gone) and uses no Android framework SQLite: see *Choose the SQLite library*.
* `threading` is ignored: everything is asynchronous and native.
* `getVersion()` / `setVersion()` are async. `wrapDb` is gone. `cursorWindowSize` and `cursorWindowName` do nothing.
* While a `transaction` runs, other calls made on the same `db` join it (as before). Use the `tx` argument to be explicit.
* The database opens in the background: errors come from `db.ready` or the first query, no more synchronous throw.

</details>
<details open>
<summary><b>sqlite-default-engine</b></summary>

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
<h1 align="center">@nativescript-community/sqlite-default-engine</h1>
<p align="center">
		<a href="https://npmcharts.com/compare/@nativescript-community/sqlite-default-engine?minimal=true"><img alt="Downloads per month" src="https://img.shields.io/npm/dm/@nativescript-community/sqlite-default-engine.svg" height="20"/></a>
<a href="https://www.npmjs.com/package/@nativescript-community/sqlite-default-engine"><img alt="NPM Version" src="https://img.shields.io/npm/v/@nativescript-community/sqlite-default-engine.svg" height="20"/></a>
	</p>

<p align="center">
  <b>The default SQLite for @nativescript-community/sqlite-core: androidx sqlite-bundled on Android (WAL by default), the SQLite of the process on iOS.</b></br>
  <sub><sub>
</p>

<br />



[](#table-of-contents)


[](#table-of-contents)

## Table of Contents

* [What it is](#what-it-is)
* [Installation](#installation)
	* [WAL by default on Android](#wal-by-default-on-android)
	* [Extensions](#extensions)


[](#what-it-is)


[](#what-it-is)

## What it is

The SQLite that [`@nativescript-community/sqlite`](../sqlite) uses by default, as a package of its own so you can combine it with only the bindings you need (for example NativeScript 9.1+ without the JNI / Objective-C bridges):

* **Android**: androidx `sqlite-bundled` (a recent SQLite with FTS5, JSON, RTREE, math functions, ~0.65 MB per ABI), added to your app by this package's `include.gradle`. Engine `libsqliteJni.so`.
* **iOS**: the SQLite of the process: the system SQLite, or the one your app links (e.g. a CocoaPods `SQLCipher`).
* **WAL on Android**: databases open with `wal: true` (see below).

It contains no native code of its own. Do not install it when you bring your own SQLite (SQLCipher, a custom build): then nothing from androidx is in your app.


[](#installation)


[](#installation)

## Installation

`ns plugin add @nativescript-community/sqlite-core @nativescript-community/sqlite-napi @nativescript-community/sqlite-default-engine`

(`sqlite-napi` for NativeScript 9.1+; `sqlite-bridge` instead of, or next to it, for NativeScript 8.) Import the package once, before the first database is opened, for example in `app.ts`:

```typescript
import '@nativescript-community/sqlite-default-engine'; // configures the default engine and options of sqlite-core
import { openOrCreate } from '@nativescript-community/sqlite-core';

const db = openOrCreate('my.db'); // androidx on Android, the process SQLite on iOS
await db.execute('CREATE TABLE names (id INTEGER PRIMARY KEY, name TEXT)');
```

Without the import the core has no engine and throws "No SQLite engine chosen". It only sets `defaultEngine` and `defaultOptions`: `configure({ engine })` or the `engine` option of a database still pick another SQLite.

### WAL by default on Android

With SQLite's default journal every commit creates, syncs and deletes a journal file, which made 500 awaited one-statement writes take 2.6 s on a phone (38 ms in WAL). The package sets `defaultOptions: { wal: true }` on Android: it adds `-wal` / `-shm` files next to the database (`deleteDatabase` removes them). Opt out per database with `{ wal: false }`, or for all with `configure({ defaultOptions: { wal: false } })`. In-memory and read-only databases ignore it. iOS keeps SQLite's default.

### Extensions

The Android engine can load extensions (`db.canLoadExtensions()`), the system SQLite of iOS cannot; see the *Extensions* section of the [`sqlite-core`](../sqlite-core) documentation.

</details>
<details open>
<summary><b>sqlite-napi</b></summary>

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
<h1 align="center">@nativescript-community/sqlite-napi</h1>
<p align="center">
		<a href="https://npmcharts.com/compare/@nativescript-community/sqlite-napi?minimal=true"><img alt="Downloads per month" src="https://img.shields.io/npm/dm/@nativescript-community/sqlite-napi.svg" height="20"/></a>
<a href="https://www.npmjs.com/package/@nativescript-community/sqlite-napi"><img alt="NPM Version" src="https://img.shields.io/npm/v/@nativescript-community/sqlite-napi.svg" height="20"/></a>
	</p>

<p align="center">
  <b>Node-API binding of @nativescript-community/sqlite-core for NativeScript 9.1+ (native part only: no JNI / Objective-C bridge code).</b></br>
  <sub><sub>
</p>

<br />



[](#table-of-contents)


[](#table-of-contents)

## Table of Contents

* [What it is](#what-it-is)
* [Installation](#installation)
* [Usage](#usage)
* [Using the binding directly](#using-the-binding-directly)


[](#what-it-is)


[](#what-it-is)

## What it is

The **Node-API** binding of [`@nativescript-community/sqlite-core`](../sqlite-core): a small native module (`libnssqlite_napi.so` on Android, a static library on iOS) that NativeScript 9.1+ runtimes load and that JS calls directly, with external ArrayBuffers for results and one native thread per database. It is the fast path: the JNI / Objective-C bridges are not needed (and not installed) when you use it.

* Needs NativeScript **9.1 or newer**, and `@nativescript-community/sqlite-core` (installed with it). On older runtimes the module stays inert and the API falls back to [`sqlite-bridge`](../sqlite-bridge) when that is installed.
* No runtime library is linked: the Node-API functions are resolved when the module loads, so it does not depend on the runtime's library name or ABI.
* Size: 23 KB per Android ABI (arm64), 29 KB for the iOS device slice. It adds the `*Sync` methods and use from Workers.
* Runtimes without `napi_*threadsafe_function` (the NativeScript QuickJS runtime, `@nativescript/android-quickjs-ng`) cannot be woken from a database thread: the module reports `threadsafe: false`, finished requests wait in a queue, and the TypeScript layer drains it with `poll()` from a 0 ms timer while requests are in flight (nothing runs when idle). Same API and results; results of independent calls reach JS in one batch, and the latency of a call is a timer tick (~1 ms) instead of a thread wake-up. The module is loaded through the standard `napi_register_module_v1` export, `napi_module_register` is optional.


[](#installation)


[](#installation)

## Installation

`ns plugin add @nativescript-community/sqlite-core @nativescript-community/sqlite-napi`

then choose a SQLite engine (see the [`sqlite-core`](../sqlite-core) documentation), or install [`@nativescript-community/sqlite`](../sqlite) which brings a default one and this binding.


[](#usage)


[](#usage)

## Usage

There is nothing to call: [`sqlite-core`](../sqlite-core) finds this module itself. To insist on it (fail instead of falling back to a bridge):

```typescript
import { configure, openOrCreate } from '@nativescript-community/sqlite-core';

configure({ backend: 'napi' }); // throws a clear error when the runtime has no Node-API or this package is missing
const db = openOrCreate('app.db', { engine: 'libsqlcipher.so' });

await db.execute('INSERT INTO t VALUES (?)', [1]);   // asynchronous, on the database's own thread
const row = db.getSync('SELECT count(*) AS n FROM t'); // blocking twin, only with this binding
```


[](#using-the-binding-directly)


[](#using-the-binding-directly)

## Using the binding directly

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


</details>

[](#demos-and-development)

## Demos and Development


### Repo Setup

The repo uses submodules. If you did not clone with ` --recursive` then you need to call
```
git submodule update --init
```

The package manager used to install and link dependencies must be `pnpm` or `yarn`. `npm` wont work.

To develop and test:
if you use `yarn` then run `yarn`
if you use `pnpm` then run `pnpm i`

**Interactive Menu:**

To start the interactive menu, run `npm start` (or `yarn start` or `pnpm start`). This will list all of the commonly used scripts.

### Build

```bash
npm run build.all
```
WARNING: it seems `yarn build.all` wont always work (not finding binaries in `node_modules/.bin`) which is why the doc explicitly uses `npm run`

### Demos

```bash
npm run demo.[ng|react|svelte|vue].[ios|android]

npm run demo.svelte.ios # Example
```

Demo setup is a bit special in the sense that if you want to modify/add demos you dont work directly in `demo-[ng|react|svelte|vue]`
Instead you work in `demo-snippets/[ng|react|svelte|vue]`
You can start from the `install.ts` of each flavor to see how to register new demos 


[](#contributing)

## Contributing

### Update repo 

You can update the repo files quite easily

First update the submodules

```bash
npm run update
```

Then commit the changes
Then update common files

```bash
npm run sync
```
Then you can run `yarn|pnpm`, commit changed files if any

### Update readme 
```bash
npm run readme
```

### Update doc 
```bash
npm run doc
```

### Publish

The publishing is completely handled by `lerna` (you can add `-- --bump major` to force a major release)
Simply run 
```shell
npm run publish
```

### modifying submodules

The repo uses https:// for submodules which means you won't be able to push directly into the submodules.
One easy solution is t modify `~/.gitconfig` and add
```
[url "ssh://git@github.com/"]
	pushInsteadOf = https://github.com/
```

[](#questions)

## Questions

If you have any questions/issues/comments please feel free to create an issue or start a conversation in the [NativeScript Community Discord](https://nativescript.org/discord).
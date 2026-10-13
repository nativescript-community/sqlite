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
  <b>SQLite for NativeScript: native threads, Node-API, a default SQLite on each platform. Use @nativescript-community/sqlite-core to bring your own.</b></br>
  <sub><sub>
</p>

<br />



[](#table-of-contents)

## Table of Contents

* [Installation](#installation)
* [Usage](#usage)
	* [Async and sync](#async-and-sync)
	* [WAL by default on Android](#wal-by-default-on-android)
	* [Extensions](#extensions)
	* [Another SQLite for some or all databases](#another-sqlite-for-some-or-all-databases)
	* [TypeORM](#typeorm)
	* [Do not want the default SQLite?](#do-not-want-the-default-sqlite)


[](#installation)

## Installation
Run the following command from the root of your project:

`ns plugin add @nativescript-community/sqlite`

This is [`@nativescript-community/sqlite-core`](../sqlite-core) (the API, the native threads, the Node-API / JNI / Objective-C bindings) **plus a default SQLite**, so it works without any setup:

* **Android**: androidx `sqlite-bundled` (a recent SQLite with FTS5, JSON, RTREE, math functions, ~0.65 MB per ABI), added to your app by this package's `include.gradle`. Engine `libsqliteJni.so`.
* **iOS**: the SQLite of the process: the system SQLite, or the one your app links (e.g. a CocoaPods `SQLCipher`).

Everything of `sqlite-core` is re-exported, and so are its `/typeorm` and `/nanosql` entries. The full reference (options, bindings, raw Node-API / bridge use) is in the [`sqlite-core` documentation](../sqlite-core).


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

### Do not want the default SQLite?

Depend on [`@nativescript-community/sqlite-core`](../sqlite-core) instead of this package: it brings no SQLite and no gradle dependency, so there is nothing to override or patch out when you use SQLCipher or your own build.

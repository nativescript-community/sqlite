{{ load:../../tools/readme/edit-warning.md }}
{{ template:title }}
{{ template:badges }}
{{ template:description }}

{{ template:toc }}

## Two packages

* **`@nativescript-community/sqlite-core`** (this one): the API and the native core. It depends on nothing and ships **no SQLite**: you choose the engine (`engine` option or `configure`), so there is nothing to patch out when you want SQLCipher or your own build.
* **[`@nativescript-community/sqlite`](../sqlite)**: this package plus a default engine: androidx sqlite-bundled on Android (it adds the gradle dependency) and the SQLite of the process on iOS. Pick it if you just want SQLite.

## Installation
Run the following command from the root of your project:

`ns plugin add {{ pkg.name }}`

### Choose the SQLite library

This package opens a database only once an engine is chosen, with `configure({ engine })` (all databases) or `openOrCreate(file, { engine })` (one database). Without one it throws "No SQLite engine chosen".

* **Android**: add a library that exports the `sqlite3_*` C API to your app and name it as `engine`: `libsqlcipher.so` (`net.zetetic:sqlcipher-android`), `libsqliteJni.so` (androidx `sqlite-bundled`), your own build in `jniLibs`...
* **Android, no SQLite library at all**: [`@nativescript-community/sqlite-android-framework`](../sqlite-android-framework) uses the platform's `android.database.sqlite` as the engine (prototype).
* **iOS**: `engine: null` is the SQLite of the process: the system one, unless your app links another (a CocoaPods `SQLCipher`, or your own dynamic framework: it is found first). Explicit choices: `'/usr/lib/libsqlite3.dylib'` (system), `'@rpath/MySqlite.framework/MySqlite'` (an embedded framework).
* **iOS, SQLite linked statically** (a `.a`, static pod): symbols of static libraries are not reliably visible to `dlsym`, so the plugin cannot look them up. Build `native/provider/NSSqliteStaticProvider.m` into the same library (it registers the SQLite under a name at startup) and use `engine: '@static'`.

```typescript
import { configure, openOrCreate } from '@nativescript-community/sqlite-core';

configure({ engine: 'libsqlcipher.so' }); // before opening databases
const db = openOrCreate('secure.db', { initSql: "PRAGMA key = 'secret'" });
```

Tested with: androidx sqlite-bundled (3.50.1), SQLCipher (`net.zetetic:sqlcipher-android` on Android, the `SQLCipher` pod on iOS), a vanilla SQLite amalgamation built with your own options (FTS5, `DQS=0`...; Android `.so`, iOS dynamic framework and iOS static library), and several of them in the same app at the same time (`engine` is per database).

### SQLCipher and other `PRAGMA key` setups

`initSql` runs first on the new connection (before `wal`), so the key is the first statement SQLCipher sees:

```typescript
const db = openOrCreate('secure.db', { engine: 'libsqlcipher.so', initSql: "PRAGMA key = 'secret'", wal: true });
```

A wrong or missing key is reported by the first query (`SqliteError`, `code === 26`, "file is not a database").

### Extensions

* **Compiled in**: build the extension into your SQLite (`-DSQLITE_EXTRA_INIT=...` calling `sqlite3_auto_extension`, see `native/ext/custom_init.c`). Every connection has it, no JS call needed.
* **Loadable**: ship a shared library next to your SQLite (`jniLibs/<abi>/libmyext.so`, or a signed framework on iOS) and call `await db.loadExtension('libmyext.so')`. Pass the entry point when SQLite cannot guess it from the file name (`loadExtension(path, 'sqlite3_myext_init')`). Loading is per connection.
* `db.canLoadExtensions()` tells whether the engine can load extensions at all. Android engines (androidx, SQLCipher, your build) can. Apple's system SQLite cannot: `loadExtension` rejects with a `SqliteError`.

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
* Tiny statements in a loop: `executeSync`, `selectSync`, `getSync`... block the calling thread until the database answers and skip the event loop round trip (NativeScript 9.1+). Fast for small statements, never use them for big ones.
* Extensions: `db.loadExtension(path)` when the SQLite library allows it, or link a static extension into your own library.
* A database opens in the background: `await db.ready` (or `openOrCreateAsync`) to wait for it and get the open error.

### Runtimes

NativeScript 9.1+ uses the Node-API binding directly; NativeScript 8 uses a thin JNI / Objective-C bridge over the same native core. `configure({ backend: 'napi' | 'bridge' })` forces one.

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

## Migrating from 3.x

* The plugin no longer bundles SQLite on iOS (FMDB is gone) and uses no Android framework SQLite: see *Choose the SQLite library*.
* `threading` is ignored: everything is asynchronous and native.
* `getVersion()` / `setVersion()` are async. `wrapDb` is gone. `cursorWindowSize` and `cursorWindowName` do nothing.
* While a `transaction` runs, other calls made on the same `db` join it (as before). Use the `tx` argument to be explicit.
* The database opens in the background: errors come from `db.ready` or the first query, no more synchronous throw.

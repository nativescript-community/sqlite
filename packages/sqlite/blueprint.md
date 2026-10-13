{{ load:../../tools/readme/edit-warning.md }}
{{ template:title }}
{{ template:badges }}
{{ template:description }}

{{ template:toc }}

## Installation
Run the following command from the root of your project:

`ns plugin add {{ pkg.name }}`

### Choose the SQLite library

The plugin does not ship a SQLite: it loads the one your app provides, so you decide the version, the compile options and the extensions.

* **iOS**: the system SQLite is used by default. To use your own build (SQLCipher, extensions, newer version) link it into the app and set `engine`.
* **Android**: add a library that exports the `sqlite3_*` C API. The simplest is androidx sqlite-bundled (a recent SQLite with FTS5, JSON, RTREE, math functions, ~0.65 MB per ABI), in `App_Resources/Android/app.gradle`:

```gradle
dependencies {
    implementation 'androidx.sqlite:sqlite-bundled:2.7.1'
}
```

  It is loaded by default (`libsqliteJni.so`). Any other library works the same way (SQLCipher, your own build): set `engine: 'libsqlcipher.so'` globally with `configure` or per database.

```typescript
import { configure } from '@nativescript-community/sqlite';

configure({ engine: 'libsqlcipher.so' }); // optional, before opening databases
```

## Usage

Every call runs on a native thread and returns a promise: the JS thread is never blocked.

```typescript
import { openOrCreate } from '@nativescript-community/sqlite';

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
* Options of `openOrCreate`: `readOnly`, `flags`, `engine`, `busyTimeout`, `wal`, `initSql` (e.g. `PRAGMA key = ...`).
* Extensions: `db.loadExtension(path)` when the SQLite library allows it, or link a static extension into your own library.
* A database opens in the background: `await db.ready` (or `openOrCreateAsync`) to wait for it and get the open error.

### Runtimes

NativeScript 9.1+ uses the Node-API binding directly; NativeScript 8 uses a thin JNI / Objective-C bridge over the same native core. `configure({ backend: 'napi' | 'bridge' })` forces one.

### TypeORM, nano-sql

`@nativescript-community/sqlite/typeorm` and `@nativescript-community/sqlite/nanosql` keep working on the new API.

## Migrating from 3.x

* The plugin no longer bundles SQLite on iOS (FMDB is gone) and uses no Android framework SQLite: see *Choose the SQLite library*.
* `threading` is ignored: everything is asynchronous and native.
* `getVersion()` / `setVersion()` are async. `wrapDb` is gone. `cursorWindowSize` and `cursorWindowName` do nothing.
* While a `transaction` runs, other calls made on the same `db` join it (as before). Use the `tx` argument to be explicit.
* The database opens in the background: errors come from `db.ready` or the first query, no more synchronous throw.

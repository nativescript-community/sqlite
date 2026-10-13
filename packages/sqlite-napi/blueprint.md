{{ load:../../tools/readme/edit-warning.md }}
{{ template:title }}
{{ template:badges }}
{{ template:description }}

{{ template:toc }}

## What it is

The **Node-API** binding of [`@nativescript-community/sqlite-core`](../sqlite-core): a small native module (`libnssqlite_napi.so` on Android, a static library on iOS) that NativeScript 9.1+ runtimes load and that JS calls directly, with external ArrayBuffers for results and one native thread per database. It is the fast path: the JNI / Objective-C bridges are not needed (and not installed) when you use it.

* Needs NativeScript **9.1 or newer**, and `@nativescript-community/sqlite-core` (installed with it). On older runtimes the module stays inert and the API falls back to [`sqlite-bridge`](../sqlite-bridge) when that is installed.
* No runtime library is linked: the Node-API functions are resolved when the module loads, so it does not depend on the runtime's library name or ABI.
* Size: 23 KB per Android ABI (arm64), 29 KB for the iOS device slice. It adds the `*Sync` methods and use from Workers.

## Installation

`ns plugin add @nativescript-community/sqlite-core {{ pkg.name }}`

then choose a SQLite engine (see the [`sqlite-core`](../sqlite-core) documentation), or install [`@nativescript-community/sqlite`](../sqlite) which brings a default one and this binding.

## Usage

There is nothing to call: [`sqlite-core`](../sqlite-core) finds this module itself. To insist on it (fail instead of falling back to a bridge):

```typescript
import { configure, openOrCreate } from '@nativescript-community/sqlite-core';

configure({ backend: 'napi' }); // throws a clear error when the runtime has no Node-API or this package is missing
const db = openOrCreate('app.db', { engine: 'libsqlcipher.so' });

await db.execute('INSERT INTO t VALUES (?)', [1]);   // asynchronous, on the database's own thread
const row = db.getSync('SELECT count(*) AS n FROM t'); // blocking twin, only with this binding
```

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


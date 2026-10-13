{{ load:../../tools/readme/edit-warning.md }}
{{ template:title }}
{{ template:badges }}
{{ template:description }}

{{ template:toc }}

## What it is

The **JNI** (Android) and **Objective-C** (iOS) bridges of [`@nativescript-community/sqlite-core`](../sqlite-core), for runtimes without Node-API: **NativeScript 8 and older**. They map the native core one to one, so the whole API of the core is available with the same behaviour (only the `*Sync` methods need Node-API).

* Works on every NativeScript version. On NativeScript 9.1+ it is only used when `sqlite-napi` is not installed or when you force `backend: 'bridge'`.
* If you target NativeScript 9.1+ only, you do not need this package: leave it out and nothing of the bridges is in your app.
* Contents: `libnssqlite_jni.so` (10 KB per Android ABI, arm64) with `NativeSqlite.java`; `NSSqliteBridge.xcframework` (17 KB for the iOS device slice).
* The Android bridge exchanges only numbers per request (the NativeScript runtime aborts at 51200 JNI global references): SQL and parameters go through a per-thread request arena, results through a result arena.

## Installation

`ns plugin add @nativescript-community/sqlite-core {{ pkg.name }}`

then choose a SQLite engine (see the [`sqlite-core`](../sqlite-core) documentation), or install [`@nativescript-community/sqlite`](../sqlite) which brings a default one and both bindings.

## Usage

There is nothing to call: [`sqlite-core`](../sqlite-core) uses the bridge when Node-API is not there. To force it, for example to test NativeScript 8 behaviour on a newer runtime:

```typescript
import { configure, openOrCreate } from '@nativescript-community/sqlite-core';

configure({ backend: 'bridge' }); // throws a clear error when this package is missing
const db = openOrCreate('app.db', { engine: 'libsqlcipher.so' });
await db.select('SELECT * FROM t');
```

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


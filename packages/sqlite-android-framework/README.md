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

## Table of Contents

* [Installation](#installation)
	* [Prototype: what to know](#prototype-what-to-know)


[](#installation)

## Installation

Needs [`@nativescript-community/sqlite-core`](../sqlite-core). Run from the root of your project:

`ns plugin add @nativescript-community/sqlite-core @nativescript-community/sqlite-android-framework`

```typescript
import { openOrCreate } from '@nativescript-community/sqlite-core';
import { useFrameworkEngine } from '@nativescript-community/sqlite-android-framework';

useFrameworkEngine(); // every database now runs on android.database.sqlite
const db = openOrCreate('my.db');
// or per database: loadFrameworkEngine(); openOrCreate('my.db', { engine: FRAMEWORK_ENGINE })
```

The app carries **no SQLite library** (this package is ~25 KB per ABI): the SQLite of the platform is used, with the native threads, the batching and the whole API of sqlite-core on top. The Android part is a small shim exposing the `sqlite3_*` functions the core needs on top of `android.database.sqlite`, so nothing in the core is specific to it. Works with both bindings (Node-API and JNI).

### Prototype: what to know

* **The platform decides** the SQLite version (Android 7 ships a 3.9, Android 14 a 3.4x, the OEM may differ) and its options: check `db.getSqliteVersion()`. No extensions (`canLoadExtensions()` is false), no SQLCipher, a fixed busy timeout (`busyTimeout` is ignored).
* One statement per call, as with the other engines; `executeScript` and `batch` split statements with a small scanner (strings, comments, `CREATE TRIGGER ... END` are handled).
* Transactions use the framework's session (`BEGIN` is `IMMEDIATE`, or `EXCLUSIVE` when asked; `DEFERRED` is run as `IMMEDIATE`).
* A row bigger than the framework's cursor window (2 MB) cannot be read.
* The first read of a result makes the framework count all rows: very big results cost twice the stepping.
* `changes` / `lastInsertRowId` after an `INSERT` cost a second tiny query.
* Speed (emulator, warm, against androidx sqlite-bundled through the same core): `select` of 20000 rows ~14 ms vs ~3 ms, 1000 awaited point lookups ~55 ms vs ~40 ms, 5000 inserts in a transaction ~80 ms vs ~20 ms, `batch()` of 5000 inserts ~60 ms vs ~7 ms.

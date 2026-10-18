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
<h1 align="center">@nativescript-community/sqlite-shared-engine</h1>
<p align="center">
		<a href="https://npmcharts.com/compare/@nativescript-community/sqlite-shared-engine?minimal=true"><img alt="Downloads per month" src="https://img.shields.io/npm/dm/@nativescript-community/sqlite-shared-engine.svg" height="20"/></a>
<a href="https://www.npmjs.com/package/@nativescript-community/sqlite-shared-engine"><img alt="NPM Version" src="https://img.shields.io/npm/v/@nativescript-community/sqlite-shared-engine.svg" height="20"/></a>
	</p>

<p align="center">
  <b>A SQLite shipped as libsqlite.so for @nativescript-community/sqlite-core: other libraries of the app that ship a libsqlite.so (a map SDK...) share this one SQLite. WAL by default on Android, the SQLite of the process on iOS.</b></br>
  <sub><sub>
</p>

<br />



[](#table-of-contents)

## Table of Contents

* [What it is](#what-it-is)
* [Installation](#installation)
	* [Sharing it with another library](#sharing-it-with-another-library)
	* [Updating SQLite](#updating-sqlite)
	* [WAL by default on Android](#wal-by-default-on-android)
	* [Extensions](#extensions)


[](#what-it-is)

## What it is

A SQLite shipped as its own library, **`libsqlite.so`**, with the same package layout as [`sqlite-default-engine`](../sqlite-default-engine): pick one of the two.

* **Android**: a vanilla SQLite (FTS3/4/5, RTREE, math functions, STAT4, column metadata, `dbstat`; ~1.6 MB per ABI) built by this repo from the sqlite.org amalgamation, with soname `libsqlite.so`. Engine `libsqlite.so`.
* **iOS**: the SQLite of the process, like `sqlite-default-engine`.
* **WAL on Android**: databases open with `wal: true`, like `sqlite-default-engine`.

Why not `sqlite-default-engine`? Its androidx library is named `libsqliteJni.so` and carries androidx's JNI glue. Another library of your app that embeds its own SQLite (a map SDK, a document scanner...) cannot share it. With a library named `libsqlite.so` on both sides, the app ships **one** SQLite: the library only has to link `libsqlite.so` instead of compiling SQLite in, and neither side knows about the other.


[](#installation)

## Installation

`ns plugin add @nativescript-community/sqlite-core @nativescript-community/sqlite-napi @nativescript-community/sqlite-shared-engine`

Import the package once, before the first database is opened, for example in `app.ts`:

```typescript
import '@nativescript-community/sqlite-shared-engine'; // configures the default engine and options of sqlite-core
import { openOrCreate } from '@nativescript-community/sqlite-core';

const db = openOrCreate('my.db'); // libsqlite.so on Android, the process SQLite on iOS
```

Do not install it next to `sqlite-default-engine`: both set the default engine, the last import wins and you ship two SQLites.

### Sharing it with another library

A library that links `libsqlite.so` (`DT_NEEDED`) needs it once in the app. If it ships its own copy, gradle must keep one of them; the app decides which, so the same file is used by everyone:

```gradle
android {
    packagingOptions {
        pickFirst 'lib/armeabi-v7a/libsqlite.so'
        pickFirst 'lib/arm64-v8a/libsqlite.so'
        pickFirst 'lib/x86_64/libsqlite.so'
        pickFirst 'lib/x86/libsqlite.so'
    }
}
```

`pickFirst` keeps one copy but not which one. To choose it, put the wanted `libsqlite.so` in the app's own `jniLibs`: it wins over the dependencies' copies.

What a `libsqlite.so` must be to be shared:

* it exports the whole `sqlite3_*` API (default visibility) and is thread-safe (`SQLITE_THREADSAFE=1`, `sqlite-core` refuses 0);
* it is at least as recent as the SQLite every user was written against, and has the compile options they need (this build: see `native/build-sqlite.sh`).

SQLite state is process-wide: `sqlite3_config`, auto-extensions and the memory allocator are shared by every library using it.

### Updating SQLite

The version is pinned in [`native/sqlite-version.sh`](../../native/sqlite-version.sh) (version, release year, checksum of the amalgamation). To move to another one:

```sh
native/update-sqlite.sh 3.54.0   # downloads the amalgamation, records version + checksum
native/build-sqlite.sh           # rebuilds libsqlite.so for the four ABIs into platforms/android/jniLibs
```

The compile options are in `native/build-sqlite.sh` (`SQLITE_OPTIONS` overrides them for one build). The library is rebuilt by `native/build-android.sh` (so by `build.native` / `build.all`) too: published packages contain the pinned version.

### WAL by default on Android

With SQLite's default journal every commit creates, syncs and deletes a journal file, which made 500 awaited one-statement writes take 2.6 s on a phone (38 ms in WAL). The package sets `defaultOptions: { wal: true }` on Android: it adds `-wal` / `-shm` files next to the database (`deleteDatabase` removes them). Opt out per database with `{ wal: false }`, or for all with `configure({ defaultOptions: { wal: false } })`. In-memory and read-only databases ignore it. iOS keeps SQLite's default.

### Extensions

The Android engine can load extensions (`db.canLoadExtensions()`); see the *Extensions* section of the [`sqlite-core`](../sqlite-core) documentation.

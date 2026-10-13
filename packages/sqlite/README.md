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
	* [Do not want the default SQLite?](#do-not-want-the-default-sqlite)


[](#installation)

## Installation
Run the following command from the root of your project:

`ns plugin add @nativescript-community/sqlite`

This is [`@nativescript-community/sqlite-core`](../sqlite-core) (the API, the native threads, the Node-API binding; read its documentation for everything you can do) **plus a default SQLite**:

* **Android**: androidx `sqlite-bundled` (a recent SQLite with FTS5, JSON, RTREE, math functions, ~0.65 MB per ABI), added to your app by this package's `include.gradle`. Engine `libsqliteJni.so`.
* **iOS**: the SQLite of the process (the system SQLite, or the one your app links, e.g. a CocoaPods `SQLCipher`).

```typescript
import { openOrCreate } from '@nativescript-community/sqlite';

const db = openOrCreate('my.db');
await db.execute('CREATE TABLE names (id INTEGER PRIMARY KEY, name TEXT)');
const rows = await db.select('SELECT * FROM names');
```

Everything from `sqlite-core` is re-exported, and so are its `/typeorm` and `/nanosql` entries. The default is only a default: `configure({ engine })` or the `engine` option still pick another SQLite.

### Do not want the default SQLite?

Depend on [`@nativescript-community/sqlite-core`](../sqlite-core) instead of this package: it brings no SQLite and no gradle dependency, so there is nothing to override or patch out when you use SQLCipher or your own build.

# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

## [4.1.0](https://github.com/nativescript-community/sqlite/compare/v4.0.1...v4.1.0) (2026-10-18)

**Note:** Version bump only for package @nativescript-community/sqlite

## [4.0.1](https://github.com/nativescript-community/sqlite/compare/v4.0.0...v4.0.1) (2026-10-14)

**Note:** Version bump only for package @nativescript-community/sqlite

## [4.0.0](https://github.com/nativescript-community/sqlite/compare/v3.5.9...v4.0.0) (2026-10-14)

### ⚠ BREAKING CHANGES

* 4.0 replaces the internals of the plugin. close() and getVersion() return promises, execute() resolves to
{ changes, lastInsertRowId }, openOrCreate() opens in the background (open errors come from db.ready or the first query),
parameters are bound with their real types instead of strings, wrapDb / db.db / byteArrayToBuffer / arrayToNativeByteArray /
paramToString and the WorkersContext class are removed, threading / cursorWindowSize / cursorWindowName are ignored, Android
uses androidx sqlite-bundled with WAL on by default instead of the platform SQLite, iOS no longer uses FMDB, minimum
NativeScript 8. See MIGRATION.md.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>

### Features

* custom engines and extensions tests, canLoadExtensions, initSql before WAL ([f02d5c9](https://github.com/nativescript-community/sqlite/commit/f02d5c9a87158f4576ce2be072f6164432a9d952))
* **native:** JNI and Objective-C bridge bindings, prebuilt packaging ([bd3b2b9](https://github.com/nativescript-community/sqlite/commit/bd3b2b97b8ce618cfa3527e3226b7d75f93712ee))
* split into sqlite-core (bare) and sqlite (default engine), iOS static SQLite providers ([6008f7a](https://github.com/nativescript-community/sqlite/commit/6008f7a0952dfebb14bc9da4d83957d529eac8c9))
* split JNI / Objective-C bridges and the Node-API binding into sqlite-bridge and sqlite-napi ([c206afc](https://github.com/nativescript-community/sqlite/commit/c206afcf709a76106b188e5538ad06d893546b6b))
* sqlite-default-engine package, so androidx can be used without the bridges ([ebefd97](https://github.com/nativescript-community/sqlite/commit/ebefd975c475726665408c3d8a5a9a977111aaf9))
* TypeScript layer on the native core, string heap wire format ([3caf8cb](https://github.com/nativescript-community/sqlite/commit/3caf8cb21a9cde91d835deab5560a3aae81a1afa))
* WAL by default on Android in @nativescript-community/sqlite, configure({ defaultOptions }) ([3030907](https://github.com/nativescript-community/sqlite/commit/30309076be96088c2016d835bfe0342ab64bf1c2))

### Bug Fixes

* **core:** transaction() runs its action immediately; translate Android flags of 3.x ([8552478](https://github.com/nativescript-community/sqlite/commit/8552478aa9bd26dd5db2387b2886789eaf12c3e3))
* do not need TextDecoder / TextEncoder when the codec module loads ([ce18eea](https://github.com/nativescript-community/sqlite/commit/ce18eead8366cd7151767fe843ccee6528c1beb9))

### Performance Improvements

* comparison with 3.5.9, arena-based JNI bridge, blocking Sync calls ([a725e2d](https://github.com/nativescript-community/sqlite/commit/a725e2d76851b595d86e87899662f789a4d16e7d))

### Miscellaneous Chores

* leave the version bump and changelogs to the release workflow ([9a94f30](https://github.com/nativescript-community/sqlite/commit/9a94f30f2d45363fff8d3bed855ccf1f7b24cc87))

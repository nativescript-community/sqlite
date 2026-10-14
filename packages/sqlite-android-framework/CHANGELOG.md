# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

## [4.0.1](https://github.com/nativescript-community/sqlite/compare/v4.0.0...v4.0.1) (2026-10-14)

**Note:** Version bump only for package @nativescript-community/sqlite-android-framework

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

* **android-framework:** configurable cursor window (default 16 MB), clear error for a row that does not fit ([a21b8ca](https://github.com/nativescript-community/sqlite/commit/a21b8ca55d9da4ed1e9ad1192e0f54133d898ecd))
* split JNI / Objective-C bridges and the Node-API binding into sqlite-bridge and sqlite-napi ([c206afc](https://github.com/nativescript-community/sqlite/commit/c206afcf709a76106b188e5538ad06d893546b6b))
* sqlite-android-framework, the platform SQLite (android.database.sqlite) as an engine (prototype) ([9cf7dc7](https://github.com/nativescript-community/sqlite/commit/9cf7dc742dc32d373d0ef50c120cab6e0fe8497f))

### Bug Fixes

* do not need TextDecoder / TextEncoder when the codec module loads ([ce18eea](https://github.com/nativescript-community/sqlite/commit/ce18eead8366cd7151767fe843ccee6528c1beb9))

### Miscellaneous Chores

* leave the version bump and changelogs to the release workflow ([9a94f30](https://github.com/nativescript-community/sqlite/commit/9a94f30f2d45363fff8d3bed855ccf1f7b24cc87))

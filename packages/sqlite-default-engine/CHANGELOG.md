# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

## [4.1.1](https://github.com/nativescript-community/sqlite/compare/v4.1.0...v4.1.1) (2026-10-23)

**Note:** Version bump only for package @nativescript-community/sqlite-default-engine

## [4.1.0](https://github.com/nativescript-community/sqlite/compare/v4.0.1...v4.1.0) (2026-10-18)

**Note:** Version bump only for package @nativescript-community/sqlite-default-engine

## [4.0.1](https://github.com/nativescript-community/sqlite/compare/v4.0.0...v4.0.1) (2026-10-14)

**Note:** Version bump only for package @nativescript-community/sqlite-default-engine

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

* sqlite-default-engine package, so androidx can be used without the bridges ([ebefd97](https://github.com/nativescript-community/sqlite/commit/ebefd975c475726665408c3d8a5a9a977111aaf9))

### Miscellaneous Chores

* leave the version bump and changelogs to the release workflow ([9a94f30](https://github.com/nativescript-community/sqlite/commit/9a94f30f2d45363fff8d3bed855ccf1f7b24cc87))

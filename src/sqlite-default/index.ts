/**
 * The ready-to-use setup: @nativescript-community/sqlite-core (the API and the native core) with both bindings
 * (sqlite-napi for NativeScript 9.1+, sqlite-bridge for any version) and the default SQLite engine
 * (sqlite-default-engine). Apps that want less depend on the packages they need instead.
 */
import '@nativescript-community/sqlite-default-engine';

export * from '@nativescript-community/sqlite-core';

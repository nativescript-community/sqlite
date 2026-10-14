/**
 * The platform SQLite (android.database.sqlite) as an engine of sqlite-core: no SQLite library in the app, but no choice of its
 * version, no extensions and a fixed busy timeout. Android only.
 */
import { configure } from '@nativescript-community/sqlite-core';

declare const com: any;
declare const __ANDROID__: boolean;

export const FRAMEWORK_ENGINE = 'libnssqlite_framework.so';

let loaded = false;

export interface FrameworkEngineOptions {
    /** Bytes of the cursor window of every query, default 16 MB (the platform's is 2 MB). A row must fit in it. 0 keeps the platform default. */
    cursorWindowSize?: number;
}

/** Loads the native part; pass `{ engine: FRAMEWORK_ENGINE }` per database, or use `useFrameworkEngine`. */
export function loadFrameworkEngine(options: FrameworkEngineOptions = {}) {
    if (!__ANDROID__) {
        throw new Error('@nativescript-community/sqlite-android-framework only works on Android');
    }
    if (!loaded) {
        com.akylas.sqlite.framework.FrameworkEngine.init();
        loaded = true;
    }
    if (options.cursorWindowSize !== undefined) {
        com.akylas.sqlite.framework.FrameworkEngine.setCursorWindowSize(options.cursorWindowSize);
    }
    return FRAMEWORK_ENGINE;
}

/** Makes the platform SQLite the engine of the databases opened afterwards, unless they set their own. */
export function useFrameworkEngine(options: FrameworkEngineOptions = {}) {
    configure({ engine: loadFrameworkEngine(options) });
}

/**
 * The SQLite of the Android platform (android.database.sqlite) as an engine for @nativescript-community/sqlite-core: no
 * SQLite library in the app, but also no choice of its version or options, no extensions and a fixed busy timeout.
 * Android only.
 */
import { configure } from '@nativescript-community/sqlite-core';

declare const com: any;
declare const __ANDROID__: boolean;

/** The `engine` value of this package. */
export const FRAMEWORK_ENGINE = 'libnssqlite_framework.so';

let loaded = false;

export interface FrameworkEngineOptions {
    /**
     * Bytes of the cursor window of every query, default 16 MB (the platform's own default is 2 MB). A row has to fit in it:
     * a long route stored as one JSON text of several MB needs a window of at least that size. 0 keeps the platform default.
     */
    cursorWindowSize?: number;
}

/** Loads the native part. Called by `useFrameworkEngine`; call it yourself to pass `{ engine: FRAMEWORK_ENGINE }` per database. */
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

/** Makes the platform SQLite the engine of every database opened afterwards (unless a database sets its own `engine`). */
export function useFrameworkEngine(options: FrameworkEngineOptions = {}) {
    configure({ engine: loadFrameworkEngine(options) });
}

import { Backend } from './backend';
import { createNapiBackend } from './backend.napi';
import { messageOf } from './core';

declare const __non_webpack_require__: any;

/** The runtime's require: bundlers must not try to resolve native modules. */
export function nativeRequire(id: string): any {
    const requireFunction = typeof __non_webpack_require__ === 'function' ? __non_webpack_require__ : Reflect.get(globalThis, 'require');
    return requireFunction(id);
}

/**
 * Picks the binding: `loadAddon` returns the Node-API module (sqlite-napi) or throws; `createBridge` builds the JNI / Objective-C
 * backend (sqlite-bridge) or throws when the package is not installed.
 */
export function pickBackend(prefer: 'auto' | 'napi' | 'bridge', defaultEngines: Array<string | null>, loadAddon: () => any, createBridge: () => Backend): Backend {
    let napiError = '';
    if (prefer !== 'bridge') {
        try {
            return createNapiBackend(loadAddon(), defaultEngines);
        } catch (error) {
            napiError = messageOf(error);
            if (prefer === 'napi') {
                throw new Error(`The Node-API binding is not available: ${napiError}. It needs NativeScript 9.1+ and the package @nativescript-community/sqlite-napi.`);
            }
        }
    }
    try {
        return createBridge();
    } catch (error) {
        if (prefer === 'bridge') {
            throw new Error(`The JNI / Objective-C bridge is not available: ${messageOf(error)}. It needs the package @nativescript-community/sqlite-bridge.`);
        }
        throw new Error(
            `No native binding found. Node-API: ${napiError}. Bridge: ${messageOf(error)}. Install @nativescript-community/sqlite-napi (NativeScript 9.1+) ` +
                'and/or @nativescript-community/sqlite-bridge (any NativeScript version), or @nativescript-community/sqlite which brings both.'
        );
    }
}

const ANDROID_NO_LOCALIZED_COLLATORS = 0x10;
const ANDROID_CREATE_IF_NECESSARY = 0x10000000;
const ANDROID_ENABLE_WRITE_AHEAD_LOGGING = 0x20000000;

/**
 * 3.x passed `flags` to android.database.sqlite.SQLiteDatabase, these are SQLITE_OPEN_* flags: the Android-only ones
 * (CREATE_IF_NECESSARY, ENABLE_WRITE_AHEAD_LOGGING, NO_LOCALIZED_COLLATORS) are translated; OPEN_READONLY is 1 in both.
 */
export function translateAndroidFlags<T extends { flags?: number; wal?: boolean }>(options: T): T {
    const flags = options.flags;
    if (!flags || !(flags & (ANDROID_CREATE_IF_NECESSARY | ANDROID_ENABLE_WRITE_AHEAD_LOGGING | ANDROID_NO_LOCALIZED_COLLATORS))) {
        return options;
    }
    const out: T = { ...options };
    out.flags = flags & 1 ? 0x1 : 0x2 | (flags & ANDROID_CREATE_IF_NECESSARY ? 0x4 : 0);
    if (flags & ANDROID_ENABLE_WRITE_AHEAD_LOGGING && out.wal === undefined) {
        out.wal = true;
    }
    return out;
}

import { Backend } from './backend';
import { createNapiBackend } from './backend.napi';

declare const __non_webpack_require__: any;

/** The runtime's require: bundlers must not try to resolve native modules. */
export function nativeRequire(id: string): any {
    const r = typeof __non_webpack_require__ === 'function' ? __non_webpack_require__ : (global as any).require;
    return r(id);
}

const msg = (e: any) => (e && e.message) || String(e);

/**
 * Picks the binding. `loadAddon` returns the Node-API module (@nativescript-community/sqlite-napi) or throws when the runtime
 * has no Node-API or the package is not installed; `createBridge` builds the JNI / Objective-C backend
 * (@nativescript-community/sqlite-bridge) or throws when the package is not installed.
 */
export function pickBackend(prefer: 'auto' | 'napi' | 'bridge', defaultEngines: Array<string | null>, loadAddon: () => any, createBridge: () => Backend): Backend {
    let napiError = '';
    if (prefer !== 'bridge') {
        try {
            return createNapiBackend(loadAddon(), defaultEngines);
        } catch (e) {
            napiError = msg(e);
            if (prefer === 'napi') {
                throw new Error(`The Node-API binding is not available: ${napiError}. It needs NativeScript 9.1+ and the package @nativescript-community/sqlite-napi.`);
            }
        }
    }
    try {
        return createBridge();
    } catch (e) {
        if (prefer === 'bridge') {
            throw new Error(`The JNI / Objective-C bridge is not available: ${msg(e)}. It needs the package @nativescript-community/sqlite-bridge.`);
        }
        throw new Error(
            `No native binding found. Node-API: ${napiError}. Bridge: ${msg(e)}. Install @nativescript-community/sqlite-napi (NativeScript 9.1+) ` +
                'and/or @nativescript-community/sqlite-bridge (any NativeScript version), or @nativescript-community/sqlite which brings both.'
        );
    }
}

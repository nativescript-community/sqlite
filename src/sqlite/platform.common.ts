import { Backend } from './backend';
import { createNapiBackend } from './backend.napi';

declare const __non_webpack_require__: any;

/** The runtime's require: bundlers must not try to resolve native modules. */
export function nativeRequire(id: string): any {
    const r = typeof __non_webpack_require__ === 'function' ? __non_webpack_require__ : (global as any).require;
    return r(id);
}

/**
 * Picks the binding. `loadAddon` returns the Node-API module or throws when the runtime has no Node-API;
 * `createBridge` builds the JNI / Objective-C backend.
 */
export function pickBackend(prefer: 'auto' | 'napi' | 'bridge', defaultEngines: Array<string | null>, loadAddon: () => any, createBridge: () => Backend): Backend {
    if (prefer !== 'bridge') {
        try {
            return createNapiBackend(loadAddon(), defaultEngines);
        } catch (e) {
            if (prefer === 'napi') {
                throw new Error(`The Node-API binding is not available on this runtime: ${(e && (e as any).message) || e}`);
            }
        }
    }
    return createBridge();
}

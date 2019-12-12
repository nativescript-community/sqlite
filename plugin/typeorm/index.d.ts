import { BaseConnectionOptions } from "typeorm/browser/connection/BaseConnectionOptions";
export declare function installMixins(): void;
/**
 * NativeScript-specific connection options.
 */
export interface NativescriptConnectionOptions extends BaseConnectionOptions {
    /**
     * Database type.
     */
    readonly type: "nativescript";
    /**
     * Database name.
     */
    readonly database: string;
    /**
     * The driver object
     * Default is `require('nativescript-sqlite')
     */
    readonly driver?: any;
}

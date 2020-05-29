import { BaseConnectionOptions } from "typeorm/browser/connection/BaseConnectionOptions";
export declare function installMixins(): void;
export interface NativescriptConnectionOptions extends BaseConnectionOptions {
    readonly type: "nativescript";
    readonly database: string;
    readonly driver?: any;
}

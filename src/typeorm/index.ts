import { Connection } from '@akylas/typeorm/browser/connection/Connection';
import { BaseConnectionOptions } from '@akylas/typeorm/browser/connection/BaseConnectionOptions';

import { NativescriptDriver } from './NativescriptDriver';

let installed = false;
export function installMixins() {
    if (installed) {
        return;
    }
    installed = true;
    // console.log('nativescript-akylas-sqlite"','typeorm','install');
    const DriverFactory = require('@akylas/typeorm/browser/driver/DriverFactory').DriverFactory;
    const oldFunc = DriverFactory.prototype.create;

    DriverFactory.prototype.create = function (connection: Connection) {
        const { type } = connection.options;
        console.log('DriverFactory', 'create', connection.options);
        switch (type) {
            case 'nativescript' as any:
            case '@akylas/nativescript-sqlite' as any:
                return new NativescriptDriver(connection);
            default:
                return oldFunc.call(this, connection);
        }
    };
}

/**
 * NativeScript-specific connection options.
 */
export interface NativescriptConnectionOptions extends BaseConnectionOptions {
    /**
     * Database type.
     */
    readonly type: 'nativescript';

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

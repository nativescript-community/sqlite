import { DataSource } from 'typeorm/browser';
import { BaseDataSourceOptions } from 'typeorm/browser/data-source/BaseDataSourceOptions';
import { NativescriptDriver } from './NativescriptDriver';

export * from './NativescriptDriver';
export * from './NativescriptQueryRunner';

let installed = false;
export function installMixins() {
    if (installed) {
        return;
    }
    installed = true;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const DriverFactory = require('typeorm/browser/driver/DriverFactory').DriverFactory;
    const oldFunc = DriverFactory.prototype.create;

    DriverFactory.prototype.create = function (connection: DataSource) {
        const { type } = connection.options;

        if (type === ('@nativescript-community/sqlite' as any)) {
            console.warn('"@nativescript-community/sqlite" is not recognized as a valid sqlite driver by typeorm and will break some SQL queries. Please use "nativescript" instead.');
        }

        switch (type) {
            case 'nativescript':
            case '@nativescript-community/sqlite' as any:
                return new NativescriptDriver(connection);
            default:
                return oldFunc.call(this, connection);
        }
    };
}

/**
 * NativeScript-specific connection options.
 */
export interface NativescriptConnectionOptions extends BaseDataSourceOptions {
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

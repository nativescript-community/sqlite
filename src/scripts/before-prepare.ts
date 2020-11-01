
module.exports = function ($logger, projectData, injector, hookArgs) {
    const prepareData = hookArgs.prepareData;
    prepareData.env = prepareData.env || {};
    prepareData.env.alias = prepareData.env.alias || {};
    Object.assign(prepareData.env.alias, {
        '../driver/oracle/OracleDriver': '@akylas/nativescript-sqlite/typeorm/NativescriptDriver',
        './oracle/OracleDriver': '@akylas/nativescript-sqlite/typeorm/NativescriptDriver',
        '../driver/cockroachdb/CockroachDriver': '@akylas/nativescript-sqlite/typeorm/NativescriptDriver',
        './cockroachdb/CockroachDriver': '@akylas/nativescript-sqlite/typeorm/NativescriptDriver',
        './cordova/CordovaDriver': '@akylas/nativescript-sqlite/typeorm/NativescriptDriver',
        './react-native/ReactNativeDriver': '@akylas/nativescript-sqlite/typeorm/NativescriptDriver',
        '../driver/react-native/ReactNativeDriver': '@akylas/nativescript-sqlite/typeorm/NativescriptDriver',
        './nativescript/NativescriptDriver': '@akylas/nativescript-sqlite/typeorm/NativescriptDriver',
        '../driver/nativescript/NativescriptDriver': '@akylas/nativescript-sqlite/typeorm/NativescriptDriver',
        './mysql/MysqlDriver': '@akylas/nativescript-sqlite/typeorm/NativescriptDriver',
        '../driver/mysql/MysqlDriver': '@akylas/nativescript-sqlite/typeorm/NativescriptDriver',
        './postgres/PostgresDriver': '@akylas/nativescript-sqlite/typeorm/NativescriptDriver',
        '../driver/postgres/PostgresDriver': '@akylas/nativescript-sqlite/typeorm/NativescriptDriver',
        './expo/ExpoDriver': '@akylas/nativescript-sqlite/typeorm/NativescriptDriver',
        './aurora-data-api/AuroraDataApiDriver': '@akylas/nativescript-sqlite/typeorm/NativescriptDriver',
        '../driver/aurora-data-api/AuroraDataApiDriver': '@akylas/nativescript-sqlite/typeorm/NativescriptDriver',
        './sqlite/SqliteDriver': '@akylas/nativescript-sqlite/typeorm/NativescriptDriver',
        '../driver/sqljs/SqljsDriver': '@akylas/nativescript-sqlite/typeorm/NativescriptDriver',
        './sqljs/SqljsDriver': '@akylas/nativescript-sqlite/typeorm/NativescriptDriver',
        '../driver/sqlserver/SqlServerDriver': '@akylas/nativescript-sqlite/typeorm/NativescriptDriver',
        './sqlserver/SqlServerDriver': '@akylas/nativescript-sqlite/typeorm/NativescriptDriver',
        './mongodb/MongoDriver': '@akylas/nativescript-sqlite/typeorm/NativescriptDriver',
        '../driver/mongodb/MongoDriver': '@akylas/nativescript-sqlite/typeorm/NativescriptDriver',
        '../driver/cordova/CordovaDriver': '@akylas/nativescript-sqlite/typeorm/NativescriptDriver',
        '../driver/better-sqlite3/BetterSqlite3Driver': '@akylas/nativescript-sqlite/typeorm/NativescriptDriver'
    });
};

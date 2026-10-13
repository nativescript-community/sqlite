const path = require('path');
const webpack = require('@nativescript/webpack');
const { IgnorePlugin } = require('webpack');

// TypeORM's browser build references every driver and some node helpers; none of them is used on a device.
const ignored = new Set(require('./webpack.ignored.json'));
const nodeBuiltins = ['path', 'util', 'fs', 'os', 'stream', 'events', 'buffer', 'crypto', 'assert', 'zlib', 'http', 'https', 'url', 'net', 'tls', 'child_process', 'vm', 'constants', 'tty', 'dns', 'readline', 'module'];

module.exports = (env) => {
    webpack.init(env);

    webpack.chainWebpack((config) => {
        // "typeorm/browser" ships extensionless deep imports its exports map hides: point the prefix at the folder
        // typeorm's package.json "browser" field swaps its node-only modules for dummies
        config.resolve.aliasFields.add('browser');
        config.resolve.alias.set('typeorm/browser', path.resolve(__dirname, 'node_modules/typeorm/browser'));
        config.merge({ resolve: { fallback: Object.fromEntries(nodeBuiltins.map((m) => [m, false])) } });
        config.plugin('ignore-typeorm-optional').use(IgnorePlugin, [{ checkResource: (resource) => ignored.has(resource) }]);
    });

    return webpack.resolveConfig();
};

// Bundles the TypeORM test for Node. TypeORM ships its ESM build as "typeorm/browser" with extensionless deep
// imports that Node (and its exports map) cannot resolve: map them to files, and use the browser build's own
// platform replacements (package.json "browser" field) so nothing needs fs or a real database driver.
import { build } from 'esbuild';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const typeorm = join(root, 'node_modules/typeorm');
const out = process.argv[2];

const alias = {
    name: 'typeorm-browser-deep-imports',
    setup(build) {
        build.onResolve({ filter: /^typeorm\/browser(\/.*)?$/ }, (args) => {
            const rest = args.path.slice('typeorm/browser'.length);
            return { path: join(typeorm, 'browser', rest ? rest + '.js' : 'index.js') };
        });
    }
};

await build({
    entryPoints: [join(root, 'src/sqlite/tests/typeorm.test.ts')],
    bundle: true,
    platform: 'browser', // honours the "browser" field of typeorm's package.json
    format: 'cjs',
    target: 'node22',
    sourcemap: true,
    logLevel: 'warning',
    external: ['assert', 'fs', 'os', 'path', 'node:*', '@nativescript-community/sqlite'], // the driver gets the test module through its `driver` option
    plugins: [alias],
    outfile: out
});

#!/bin/sh
# TypeORM integration tests: the NativescriptDriver on the real core, in Node. typeorm/browser is ESM with
# extensionless imports, so the test is bundled with esbuild first.
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
BUILD=${NSSQLITE_BUILD_DIR:-$ROOT/native/.build}
"$ROOT/native/build-node.sh" > /dev/null
mkdir -p "$BUILD/orm-tests"
node "$ROOT/native/bundle-orm.mjs" "$BUILD/orm-tests/typeorm.test.js"
NSSQLITE_NODE_ADDON="$BUILD/node/nssqlite.node" node --test "$BUILD/orm-tests/typeorm.test.js"

/* Performance comparison harness. The same workloads run against whichever plugin the app has installed under
 * '@nativescript-community/sqlite' (the 3.x baseline, or this branch), through the API they share. */
import { File, knownFolders } from '@nativescript/core';
import { openOrCreate } from '@nativescript-community/sqlite';

declare const __ANDROID__: boolean;

function messageOf(error: unknown): string {
    return typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string' ? error.message : String(error);
}

function stackOf(error: unknown, lines: number): string {
    return typeof error === 'object' && error !== null && 'stack' in error && typeof error.stack === 'string' ? error.stack.split('\n').slice(0, lines).join(' | ') : '';
}

const log = (...args: any[]) => console.log('[PERF]', ...args);
const now = (): number => performance.now();

function median(xs: number[]) {
    const sorted = xs.slice().sort((left, right) => left - right);
    return sorted[Math.floor(sorted.length / 2)];
}

interface Result { ms: number; min: number; info?: any }

async function measure(fn: () => Promise<any>, runs: number, prepare?: () => Promise<any>, warmup = 1): Promise<Result> {
    const times: number[] = [];
    let info: any;
    for (let index = 0; index < warmup + runs; index++) {
        if (prepare) await prepare();
        const t0 = now();
        info = await fn();
        const dt = now() - t0;
        if (index >= warmup) times.push(dt);
    }
    return { ms: +median(times).toFixed(1), min: +Math.min(...times).toFixed(1), info };
}

function removeDb(file: string) {
    for (const suffix of ['', '-wal', '-shm', '-journal']) {
        try {
            if (File.exists(file + suffix)) File.fromPath(file + suffix).removeSync();
        } catch (error) {
            // ignore
        }
    }
}

const CTE = (limit: number) => `WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c WHERE x < ${limit})`;

export interface Variant {
    label: string;
    /** called before the database is opened */
    setup?: () => void;
    /** skip the workloads that run statements inside a transaction (they hang with the 3.x worker mode: the transaction belongs to the JS thread's connection session) */
    skipTransactions?: boolean;
    /** point lookups through select()[0]: `get` of the 3.x iOS plugin never worked (it reads a row before calling next()) */
    pointViaSelect?: boolean;
    /** skip the 100000 row select: with the 3.x iOS plugin it is quadratic (rows = [...rows, row]) and takes many minutes */
    skipBigSelect?: boolean;
    options?: any;
}

/** Longest gap between two ticks of a 4 ms timer while `fn` runs: how long the JS (UI) thread was blocked. */
async function jank(fn: () => Promise<any>) {
    let last = now();
    let max = 0;
    const timer = setInterval(() => {
        const time = now();
        max = Math.max(max, time - last);
        last = time;
    }, 4);
    const t0 = now();
    last = t0;
    await fn();
    const total = now() - t0;
    max = Math.max(max, now() - last);
    clearInterval(timer);
    return { maxGapMs: +max.toFixed(1), totalMs: +total.toFixed(1) };
}

export async function runPerf(variant: Variant) {
    const name = variant.label;
    const file = `${knownFolders.documents().path}/perf-${name}.db`;
    removeDb(file);
    variant.setup && variant.setup();
    const db: any = openOrCreate(file, variant.options || {});
    const out: Record<string, Result | any> = {};
    const report = (key: string, result: any) => {
        out[key] = result;
        log(name, key, JSON.stringify(result));
    };
    try {
        await db.execute('CREATE TABLE narrow(id INTEGER PRIMARY KEY, name TEXT, score REAL)');
        await db.execute(`${CTE(20000)} INSERT INTO narrow SELECT x, 'name_' || x, x * 0.25 FROM c`);
        await db.execute('CREATE TABLE wide(i1, i2, i3, i4, r1, r2, r3, t1, t2, t3, n1, n2)');
        await db.execute(
            `${CTE(5000)} INSERT INTO wide SELECT x, x * 3, x % 7, x * 1000003, x / 3.0, x * 1.5, -x * 0.125, printf('%024d', x), 'description of item ' || x || ' in the catalog', 'x' || (x % 100) || '/' || abs(random() % 1000000), CASE WHEN x % 2 THEN NULL ELSE x END, NULL FROM c`
        );
        await db.execute('CREATE TABLE txt(a TEXT, b TEXT, c TEXT)');
        await db.execute(
            `${CTE(5000)} INSERT INTO txt SELECT printf('%0200d', x), CASE WHEN x % 10 = 0 THEN substr(printf('%0200d', x), 1, 150) || 'é€ ünïcode ' || x ELSE printf('%0200d', x * 2) END, printf('%0100d', x) || printf('%0100d', x) FROM c`
        );
        await db.execute('CREATE TABLE bl(id INTEGER, data BLOB)');
        await db.execute(`${CTE(1000)} INSERT INTO bl SELECT x, randomblob(2048) FROM c`);
        await db.execute('CREATE TABLE ins(id INTEGER PRIMARY KEY, a TEXT, b REAL)');
        const clearIns = () => db.execute('DELETE FROM ins');

        // --- writes
        report(
            'insert 500 rows, one awaited execute each, autocommit',
            await measure(async () => {
                for (let index = 0; index < 500; index++) await db.execute('INSERT INTO ins(a, b) VALUES (?, ?)', ['row ' + index, index * 0.5]);
            }, 3, clearIns)
        );
        if (!variant.skipTransactions) report(
            'insert 5000 rows in a transaction, awaited one by one',
            await measure(async () => {
                await db.transaction(async () => {
                    for (let index = 0; index < 5000; index++) await db.execute('INSERT INTO ins(a, b) VALUES (?, ?)', ['row ' + index, index * 0.5]);
                });
            }, 5, clearIns)
        );
        if (!variant.skipTransactions) report(
            'insert 5000 rows in a transaction, all started at once',
            await measure(async () => {
                await db.transaction(async () => {
                    await Promise.all(Array.from({ length: 5000 }, (_, index) => db.execute('INSERT INTO ins(a, b) VALUES (?, ?)', ['row ' + index, index * 0.5])));
                });
            }, 5, clearIns)
        );
        if (typeof db.batch === 'function') {
            const items = Array.from({ length: 5000 }, (_, index) => ['INSERT INTO ins(a, b) VALUES (?, ?)', ['row ' + index, index * 0.5]]);
            report('insert 5000 rows with batch() (new API only)', await measure(() => db.batch(items), 5, clearIns));
        }

        // --- blocking calls (new API only, Node-API binding only)
        let hasSync = false;
        try {
            hasSync = typeof db.getSync === 'function' && !!db.getSync('SELECT 1 AS one');
        } catch (error) {
            hasSync = false;
        }
        if (hasSync) {
            report(
                'insert 5000 rows in a transaction, blocking executeSync (new API only)',
                await measure(async () => {
                    await db.transaction(async () => {
                        for (let index = 0; index < 5000; index++) db.executeSync('INSERT INTO ins(a, b) VALUES (?, ?)', ['row ' + index, index * 0.5]);
                    });
                }, 5, clearIns)
            );
        }

        // --- reads
        const sel = async (sql: string, runs = 5) => measure(async () => (await db.select(sql)).length, runs);
        report('select 20000 rows x 3 (int, short text, real)', await sel('SELECT * FROM narrow'));
        report('select 5000 rows x 12 (mixed, nulls)', await sel('SELECT * FROM wide'));
        report('select 5000 rows x 3 (200 char text)', await sel('SELECT * FROM txt'));
        report('select 1000 rows with 2 KB blobs', await sel('SELECT * FROM bl'));
        report(
            '500 small selects (100 rows), one after the other',
            await measure(async () => {
                for (let index = 0; index < 500; index++) await db.select('SELECT id, name FROM narrow WHERE id <= 100');
            }, 5)
        );
        const point = variant.pointViaSelect
            ? async (id: number) => (await db.select('SELECT * FROM narrow WHERE id = ?', [id]))[0]
            : (id: number) => db.get('SELECT * FROM narrow WHERE id = ?', [id]);
        report(
            '1000 get by primary key, one after the other',
            await measure(async () => {
                for (let index = 1; index <= 1000; index++) await point(index);
            }, 5)
        );
        report('1000 get by primary key, all started at once', await measure(async () => (await Promise.all(Array.from({ length: 1000 }, (_, index) => point(index + 1)))).length, 5));
        if (hasSync) {
            report(
                '1000 get by primary key, blocking getSync (new API only)',
                await measure(async () => {
                    for (let index = 1; index <= 1000; index++) db.getSync('SELECT * FROM narrow WHERE id = ?', [index]);
                }, 5)
            );
            report(
                '500 small selects (100 rows), blocking selectSync (new API only)',
                await measure(async () => {
                    for (let index = 0; index < 500; index++) db.selectSync('SELECT id, name FROM narrow WHERE id <= 100');
                }, 5)
            );
        }
        report(
            'each over 20000 rows',
            await measure(async () => {
                let count = 0;
                await db.each('SELECT * FROM narrow', [], () => {
                    count++;
                }, () => {});
                return count;
            }, 5)
        );

        // --- responsiveness: how long is the JS thread blocked by a big query
        const big = 'SELECT a.id, a.name, a.score, k.k FROM narrow a, (SELECT 1 AS k UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5) k';
        if (!variant.skipBigSelect) {
            const gaps: any[] = [];
            for (let index = 0; index < 4; index++) {
                const gap = await jank(async () => (await db.select(big)).length);
                if (index > 0) gaps.push(gap);
            }
            report('jank during select of 100000 rows x 4', { maxGapMs: median(gaps.map((gap) => gap.maxGapMs)), totalMs: median(gaps.map((gap) => gap.totalMs)) });
        }
        const gaps2: any[] = [];
        for (let index = 0; index < 4; index++) {
            const gap = await jank(async () => {
                for (let iteration = 0; iteration < 20; iteration++) await db.select('SELECT * FROM narrow LIMIT 2000');
            });
            if (index > 0) gaps2.push(gap);
        }
        report('jank during 20 selects of 2000 rows', { maxGapMs: median(gaps2.map((gap) => gap.maxGapMs)), totalMs: median(gaps2.map((gap) => gap.totalMs)) });
    } catch (error) {
        log(name, 'ERROR', messageOf(error), stackOf(error, 3));
    }
    try {
        await db.close();
    } catch (error) {
        // ignore
    }
    removeDb(file);
    return out;
}

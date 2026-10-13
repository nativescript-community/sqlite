import { strict as assert } from 'assert';
import { describe, it } from 'node:test';
import * as path from 'path';
import { Worker } from 'worker_threads';

/** Every worker thread has its own Node-API env and dispatcher: databases used there must work at the same time as on the main thread. */
describe('worker threads', () => {
    it('use the binding concurrently with the main thread', async () => {
        const run = (n: number) =>
            new Promise<any>((resolve, reject) => {
                const w = new Worker(path.join(__dirname, 'worker-job.js'), { workerData: { n } });
                w.on('message', resolve);
                w.on('error', reject);
            });
        const { open } = await import('./support');
        const db = open();
        await db.execute('CREATE TABLE t(a)');
        const local = db.batch(Array.from({ length: 3000 }, (_, i) => ['INSERT INTO t VALUES (?)', [i]] as [string, any[]]));
        const results = await Promise.all([run(1000), run(2000), local]);
        assert.deepEqual([results[0].count, results[0].sum], [1000, 499500]);
        assert.deepEqual([results[1].count, results[1].sum], [2000, 1999000]);
        assert.equal((await db.get('SELECT COUNT(*) AS n FROM t')).n, 3000);
        await db.close();
    });
});

import { parentPort, workerData } from 'worker_threads';
import { open } from './support';

(async () => {
    const db = open();
    await db.execute('CREATE TABLE w(a)');
    await db.batch(Array.from({ length: workerData.n }, (_, i) => ['INSERT INTO w VALUES (?)', [i]] as [string, any[]]));
    const row = await db.get('SELECT COUNT(*) AS count, SUM(a) AS sum FROM w');
    await db.close();
    parentPort.postMessage(row);
})();

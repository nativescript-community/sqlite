import { parentPort, workerData } from 'worker_threads';
import { open, statement } from './support';

(async () => {
    const db = open();
    await db.execute('CREATE TABLE w(a)');
    await db.batch(Array.from({ length: workerData.n }, (_, index) => statement('INSERT INTO w VALUES (?)', index)));
    const row = await db.get('SELECT COUNT(*) AS count, SUM(a) AS sum FROM w');
    await db.close();
    parentPort.postMessage(row);
})();

const context: Worker = self as any;
import { SQLiteDatabaseBase } from './sqlitedatabase';

// function nativeArray(array) {
//     if (global.isAndroid) {
//         const nArray = Array.create(java.lang.Object, array.length);
//         for (let index = 0; index < array.length; index++) {
//             nArray[index] = array[index];
//         }
//         return nArray;
//     }
//     return array;
// }
// export default class DBWorker {
//     processing = false;
// }
// const worker = new DBWorker();
const fakeDatabase = new SQLiteDatabaseBase(null);
context.onmessage = (async (event: { data }) => {
    const data = event.data;
    switch (data.type) {
        case 'terminate':
            // worker.log('terminating worker');
            // worker.stop();
            (context as any).close();
            break;
        case 'call':
            const id = data.id;
            const call = data.callName;
            const args = data.args;
            const db = (com as any).akylas.sqlite.WorkersContext.getValue(`${id}_db`);
            fakeDatabase.db = db;
            fakeDatabase.threading = false;
            if (data.dbOptions) {
                Object.assign(fakeDatabase, data.dbOptions);

            }
            try {
                const result =await (fakeDatabase[call] as Function).apply(fakeDatabase, args);
                // console.log('Worker.onmessage done ', id, call, !!result);
                (global as any).postMessage(
                    {
                        id,
                        result,
                    }
                );
            } catch (err) {
                (global as any).postMessage(
                    Object.assign(data, {
                        id,
                        error: err.toString(),
                    })
                );
                // console.log('error in worker', err.toString());
            }

            // if (worker.processing) {
            //     console.log('ignoring processing');
            //     (global as any).postMessage(
            //         Object.assign(data, {
            //             type: 'error',
            //             id,
            //             error: 'processing',
            //         })
            //     );
            //     return;
            // }

            break;
    }
}) as any;

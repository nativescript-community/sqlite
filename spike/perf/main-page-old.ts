import { EventData } from '@nativescript/core';
import { runPerf } from './perf';

declare const __ANDROID__: boolean;

export function navigatingTo(args: EventData) {
    setTimeout(async () => {
        // the 3.x plugin: FMDB (iOS) / android.database.sqlite (Android), on the JS thread
        if (!Reflect.get(globalThis, '__ONLY_THREADED__')) await runPerf({ label: 'old', pointViaSelect: !__ANDROID__, skipBigSelect: !__ANDROID__ });
        if (__ANDROID__) {
            // its only way to leave the JS thread: a JS Worker per database
            await runPerf({ label: 'old-threaded', options: { threading: true }, skipTransactions: true });
        }
        console.log('[PERF] done');
    }, 500);
}

import { EventData, Page } from '@nativescript/core';
import { configure } from '@nativescript-community/sqlite';
import { runPerf } from './perf';

export function navigatingTo(args: EventData) {
    const page = <Page>args.object;
    setTimeout(async () => {
        // this branch: Node-API binding (NativeScript >= 9.1), then the JNI / Objective-C bridge
        configure({ backend: 'napi' });
        await runPerf({ label: 'new-napi' });
        configure({ backend: 'bridge' });
        await runPerf({ label: 'new-bridge' });
        console.log('[PERF] done');
    }, 500);
}

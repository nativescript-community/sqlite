import { EventData } from '@nativescript/core';
import { configure } from '@nativescript-community/sqlite';
import { FRAMEWORK_ENGINE, loadFrameworkEngine } from '@nativescript-community/sqlite-android-framework';
import { runPerf } from './perf';

export function navigatingTo(args: EventData) {
    setTimeout(async () => {
        // this branch with androidx sqlite-bundled (the default engine): Node-API, then the JNI bridge
        configure({ backend: 'napi' });
        await runPerf({ label: 'new-napi' });
        configure({ backend: 'bridge' });
        await runPerf({ label: 'new-bridge' });
        // the platform SQLite (android.database.sqlite) through sqlite-android-framework
        configure({ backend: 'napi' });
        loadFrameworkEngine();
        await runPerf({ label: 'framework-napi', options: { engine: FRAMEWORK_ENGINE } });
        console.log('[PERF] done');
    }, 500);
}

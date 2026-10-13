import { EventData, Page } from '@nativescript/core';
import { HelloWorldModel } from './main-view-model';
import { runApiTests } from './api-test';
import { runOrmTests } from './orm-test';

declare const __non_webpack_require__: any;

export function navigatingTo(args: EventData) {
    const page = <Page>args.object;
    page.bindingContext = new HelloWorldModel();
    // the Node-API binding only exists on NativeScript >= 9.1 runtimes
    setTimeout(async () => {
        await runApiTests((globalThis as any).__NS_BACKENDS__ || ['napi', 'bridge']);
        await runOrmTests();
    }, 300);
}

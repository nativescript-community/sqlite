import { EventData, Page } from '@nativescript/core';
import { HelloWorldModel } from './main-view-model';
import { runApiTests } from './api-test';
import { runOrmTests } from './orm-test';
import { runEngineTests } from './engine-test';
import { backendsToTest } from './util';

declare const __non_webpack_require__: any;

export function navigatingTo(args: EventData) {
    if (args.object instanceof Page) {
        args.object.bindingContext = new HelloWorldModel();
    }
    // the Node-API binding only exists on NativeScript >= 9.1 runtimes
    setTimeout(async () => {
        await runApiTests(backendsToTest());
        await runOrmTests();
        await runEngineTests(backendsToTest());
    }, 300);
}

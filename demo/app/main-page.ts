import * as observable from '@nativescript/core/data/observable';
import * as pages from '@nativescript/core/ui/page';
import { HelloWorldModel } from './main-view-model';

// Event handler for Page 'loaded' event attached in main-page.xml
export function pageLoaded(args: observable.EventData) {
    // Get the event sender
    const page = args.object as pages.Page;
    page.bindingContext = new HelloWorldModel();
}

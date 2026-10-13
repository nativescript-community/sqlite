import { EventData, Page } from '@nativescript/core'
import { HelloWorldModel } from './main-view-model'
import { runBench } from './bench'

export function navigatingTo(args: EventData) {
  const page = <Page>args.object
  page.bindingContext = new HelloWorldModel()
  setTimeout(() => runBench(), 500)
}

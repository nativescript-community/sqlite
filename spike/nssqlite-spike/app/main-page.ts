import { EventData, Page } from '@nativescript/core'
import { HelloWorldModel } from './main-view-model'
import { runBridgeTests } from './bridge-test'
import { runWorkerTest } from './napi-test'

export function navigatingTo(args: EventData) {
  const page = <Page>args.object
  page.bindingContext = new HelloWorldModel()
  runBridgeTests()
  runWorkerTest()
}

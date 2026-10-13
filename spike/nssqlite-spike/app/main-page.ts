import { EventData, Page } from '@nativescript/core'
import { HelloWorldModel } from './main-view-model'

declare const __non_webpack_require__: any
declare const __ANDROID__: boolean

function log(...args: any[]) {
  console.log('[SPIKE]', ...args)
}

function runSpike() {
  try {
    const isAndroid = __ANDROID__
    const addon = isAndroid ? __non_webpack_require__('system_lib://libnssqlite.so') : __non_webpack_require__('nssqlite_spike')
    log('loaded', Object.keys(addon))
    log('hello', addon.hello())
    if (isAndroid) {
      log('sqliteTest(androidx)', addon.sqliteTest('libsqliteJni.so'))
    } else {
      log('sqliteTest(default)', addon.sqliteTest())
      log('sqliteTest(system path)', addon.sqliteTest('/usr/lib/libsqlite3.dylib'))
    }
    log('sqliteTest(bogus)', addon.sqliteTest('libnope.so'))
    const t0 = Date.now()
    addon.ping((ab: ArrayBuffer, nativeTid: number, callerTid: number) => {
      log('ping cb', ab instanceof ArrayBuffer, ab.byteLength, new TextDecoder().decode(new Uint8Array(ab)), 'nativeTid', nativeTid, 'callerTid', callerTid, 'ms', Date.now() - t0)
    })
  } catch (e) {
    log('ERROR', e && (e as any).stack ? (e as any).stack : String(e))
  }
}

export function navigatingTo(args: EventData) {
  const page = <Page>args.object
  page.bindingContext = new HelloWorldModel()
  runSpike()
}

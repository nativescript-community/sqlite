import { NativeScriptConfig } from '@nativescript/core';

const config: NativeScriptConfig = {
  id: 'org.nativescript.nssqlitespike',
  appPath: 'app',
  appResourcesPath: 'App_Resources',
  android: {
    v8Flags: '--expose_gc',
    markingMode: 'none'
  }
};

export default config;
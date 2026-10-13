Pod::Spec.new do |s|
  s.name         = 'NSSqlite'
  s.version      = '0.0.1'
  s.summary      = 'nssqlite native core (spike)'
  s.homepage     = 'https://github.com/nativescript-community/sqlite'
  s.license      = { :type => 'Apache-2.0' }
  s.author       = 'Martin Guillon'
  s.source       = { :path => '.' }
  s.platform     = :ios, '13.0'
  s.static_framework = true
  s.source_files = 'core/provider.{c,h}', 'binding/napi/spike_addon.c', 'binding/ios/NSSqliteLink.m'
  s.private_header_files = 'core/provider.h'
  s.pod_target_xcconfig = {
    'HEADER_SEARCH_PATHS' => '"$(PODS_TARGET_SRCROOT)/binding/napi/include"',
    'GCC_C_LANGUAGE_STANDARD' => 'gnu11'
  }
end

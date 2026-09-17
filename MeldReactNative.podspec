require 'json'
package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  s.name         = 'MeldReactNative'
  s.version      = package['version']
  s.summary      = package['description']
  s.homepage     = 'https://github.com/meldeng/meldsdk-react-native'
  s.license      = { :type => 'Proprietary' }
  s.author       = { 'Meld' => 'support@meld.io' }
  s.platform     = :ios, '15.0'
  s.swift_version = '5.9'
  s.source       = { :git => 'https://github.com/meldeng/meldsdk-react-native.git', :tag => s.version.to_s }
  s.source_files = 'ios/**/*.{swift,m,h}'

  # The React Native host, and the native Meld SDK this wraps (kept in lockstep).
  s.dependency 'React-Core'
  # 0.6 is the floor, not just the family: the Banxa adapter this version can be asked to
  # present lands in MeldSDK 0.6.0. Left at '~> 0.5', a consumer holding a Podfile.lock
  # pinned to 0.5.x would resolve happily and then fail at runtime with no adapter for a
  # Banxa order, instead of failing to resolve with a reason.
  s.dependency 'MeldSDK', '~> 0.7'
end

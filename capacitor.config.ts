import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.icanrunashow.app',
  appName: 'I Can Run A Show',
  webDir: 'dist',
  // The native shell loads the live deployment instead of bundled files.
  // The API has no CORS headers, so requests must stay same-origin — pointing
  // the webview at production keeps every /api call same-origin and means web
  // deploys reach the iOS app without an App Store release. Remove this block
  // (and add CORS to the API) to ship fully-bundled offline assets instead.
  server: {
    url: 'https://icanrunashow.com',
    // Shown when the site can't load and the service worker has nothing
    // cached yet: a first launch with no signal. Capacitor serves it from the
    // bundled webDir, so it comes from public/ and needs no network.
    errorPath: 'offline.html',
  },
  ios: {
    contentInset: 'automatic',
    // WKWebView only gives a page a service worker when its domain is in
    // WKAppBoundDomains (ios/App/App/Info.plist) and this is on. Without it
    // the Workbox worker never registers, nothing is precached, and every
    // launch needs the network. Links to other domains still open outside the
    // app; docs/IOS.md has why.
    limitsNavigationsToAppBoundDomains: true,
  },
};

export default config;

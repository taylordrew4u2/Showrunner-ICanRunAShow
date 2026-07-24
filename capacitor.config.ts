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
  },
  ios: {
    contentInset: 'automatic',
  },
};

export default config;

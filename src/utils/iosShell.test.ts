import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The real files, not fixtures. The iOS shell's offline mode is three files
// agreeing with each other — the Capacitor config, Info.plist and the bundled
// error page — and none of them is code a unit test can run.
const root = new URL('../../', import.meta.url);
const capConfig = readFileSync(new URL('capacitor.config.ts', root), 'utf8');
const plist = readFileSync(new URL('ios/App/App/Info.plist', root), 'utf8');

function setting(name: string): string {
  return capConfig.match(new RegExp(`\\b${name}: '([^']+)'`))?.[1] ?? '';
}

const serverUrl = setting('url');
const errorPath = setting('errorPath');

describe('the iOS shell offline', () => {
  it('ships the error page in the bundle', () => {
    // Capacitor loads errorPath from the bundled webDir after a failed load.
    // A page that isn't there fails too, which loads the error page again.
    expect(errorPath).not.toBe('');
    expect(existsSync(new URL(`public/${errorPath}`, root))).toBe(true);
  });

  it('lets the live site register its service worker', () => {
    // WKWebView only exposes service workers to app-bound domains, and only
    // with the navigation limit on.
    expect(capConfig).toMatch(/limitsNavigationsToAppBoundDomains: true/);
    const list = plist.match(/<key>WKAppBoundDomains<\/key>\s*<array>([\s\S]*?)<\/array>/)?.[1] ?? '';
    const domains = [...list.matchAll(/<string>([^<]+)<\/string>/g)].map((m) => m[1]);
    expect(domains).toContain(new URL(serverUrl).hostname);
    // The shell's own origin, where the error page is served.
    expect(domains).toContain('localhost');
  });

  it('retries the live site and loads nothing else from the network', () => {
    const page = readFileSync(new URL(`public/${errorPath}`, root), 'utf8');
    expect(page.match(/https?:\/\/[^'"\s)]+/g)).toEqual([`${serverUrl}/`]);
  });
});

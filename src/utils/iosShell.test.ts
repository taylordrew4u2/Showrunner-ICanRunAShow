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

describe('the offline page', () => {
  const page = readFileSync(new URL(`public/${errorPath}`, root), 'utf8');
  const script = page.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? '';

  /** The page's own script, run as it is on load. */
  function open({ onLine, now, session = new Map<string, string>(), storageWorks = true }: {
    onLine: boolean;
    now: number;
    session?: Map<string, string>;
    storageWorks?: boolean;
  }) {
    const note = { textContent: '' };
    const listeners: Record<string, () => void> = {};
    const loads: string[] = [];
    const refuse = () => { throw new DOMException('blocked', 'SecurityError'); };
    const storage = storageWorks
      ? {
          getItem: (key: string) => session.get(key) ?? null,
          setItem: (key: string, value: string) => void session.set(key, value),
          removeItem: (key: string) => void session.delete(key),
        }
      : { getItem: refuse, setItem: refuse, removeItem: refuse };
    const doc = {
      getElementById: (id: string) => id === 'note'
        ? note
        : { addEventListener: (_type: string, fn: () => void) => { listeners.tap = fn; } },
    };
    const win = { addEventListener: (type: string, fn: () => void) => { listeners[type] = fn; } };
    new Function('window', 'document', 'navigator', 'location', 'sessionStorage', 'Date', script)(
      win, doc, { onLine }, { replace: (url: string) => loads.push(url) }, storage, { now: () => now },
    );
    return { note, loads, session, tap: () => listeners.tap(), online: () => listeners.online() };
  }

  it('tries the app on Retry even with no signal, since it may be saved on this device', () => {
    // Capacitor shows this page after any failed load, a cancelled one
    // included, and the service worker can open the app offline.
    const shown = open({ onLine: false, now: 1_000 });
    shown.tap();
    expect(shown.loads).toEqual([`${serverUrl}/`]);
    expect(shown.note.textContent).toBe('Trying again…');
  });

  it('says there is still no connection when a retry comes straight back here', () => {
    const first = open({ onLine: false, now: 1_000 });
    first.tap();
    const again = open({ onLine: false, now: 4_000, session: first.session });
    expect(again.note.textContent).toBe('Still no connection.');
    // Never retries by itself on load, so a failing load cannot loop.
    expect(again.loads).toEqual([]);
  });

  it('says nothing about an earlier retry the next time the page appears', () => {
    const first = open({ onLine: true, now: 1_000 });
    first.tap();
    const later = open({ onLine: true, now: 1_000 + 60 * 60 * 1000, session: first.session });
    expect(later.note.textContent).toBe('');
    expect(open({ onLine: true, now: 1_000 }).note.textContent).toBe('');
  });

  it('still retries by itself when the connection comes back', () => {
    const shown = open({ onLine: true, now: 1_000 });
    shown.online();
    expect(shown.loads).toEqual([`${serverUrl}/`]);
  });

  it('retries where the page cannot keep anything', () => {
    const shown = open({ onLine: false, now: 1_000, storageWorks: false });
    expect(shown.note.textContent).toBe('');
    shown.tap();
    expect(shown.loads).toEqual([`${serverUrl}/`]);
  });
});

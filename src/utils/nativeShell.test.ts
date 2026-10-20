import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isNativeShell } from './nativeShell';

describe('telling the iOS app from a browser', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is the iOS app when the Capacitor bridge says it runs on a native platform', () => {
    vi.stubGlobal('window', { Capacitor: { isNativePlatform: () => true } });
    expect(isNativeShell()).toBe(true);
  });

  it('is a browser when there is no bridge on the page', () => {
    vi.stubGlobal('window', {});
    expect(isNativeShell()).toBe(false);
  });

  it('is a browser when the bridge is there but says the platform is the web', () => {
    vi.stubGlobal('window', { Capacitor: { isNativePlatform: () => false } });
    expect(isNativeShell()).toBe(false);
  });

  it('is a browser when the bridge has no way to say', () => {
    vi.stubGlobal('window', { Capacitor: {} });
    expect(isNativeShell()).toBe(false);
  });

  it('is a browser where there is no window at all', () => {
    // Rendering on the server, or a test without a page.
    expect(isNativeShell()).toBe(false);
  });
});

describe('the sales page inside the iOS app', () => {
  // The real page, not a fixture. It is a static file outside the React app,
  // and the shell opens it in place from the sign-in screen and the guides.
  const page = readFileSync(new URL('../../public/tour/index.html', import.meta.url), 'utf8');
  const script = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)]
    .map((m) => m[1])
    .find((code) => code.includes('native-shell')) ?? '';

  function classesFor(win: object): string[] {
    const added: string[] = [];
    const doc = { documentElement: { classList: { add: (name: string) => added.push(name) } } };
    new Function('window', 'document', script)(win, doc);
    return added;
  }

  it('marks the page as the iOS app only when the Capacitor bridge says so', () => {
    expect(classesFor({ Capacitor: { isNativePlatform: () => true } })).toEqual(['native-shell']);
    expect(classesFor({ Capacitor: { isNativePlatform: () => false } })).toEqual([]);
    expect(classesFor({ Capacitor: {} })).toEqual([]);
    expect(classesFor({})).toEqual([]);
  });

  it('hides everything web-only there', () => {
    expect(page).toMatch(/\.native-shell \.web-only \{ display: none; \}/);
  });

  it('leaves no price, checkout or billing in what the iOS app shows', () => {
    // App Store guideline 3.1.1. The structured data for search engines is
    // never shown, so it keeps its offers.
    const shown = page
      .replace(/<head>[\s\S]*?<\/head>/, '')
      .replace(/<(section|a|span)\b[^>]*class="[^"]*\bweb-only\b[^"]*"[^>]*>[\s\S]*?<\/\1>/g, '');
    expect(shown).not.toMatch(/\$\d+ <small>|\/ month|stripe|manage billing|upgrade|#pricing|cancel anytime/i);
    // The parts that were hidden are still there for the web.
    expect(page).toMatch(/<section id="pricing" class="band web-only">/);
    expect(page).toContain('$9 <small>/ month</small>');
  });
});

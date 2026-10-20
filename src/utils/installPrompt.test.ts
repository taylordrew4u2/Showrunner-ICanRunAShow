import { afterEach, describe, expect, it, vi } from 'vitest';
import { isIOS, isMobile, isStandalone } from './installPrompt';

// What an iPhone's WKWebView sends: no "Safari" token, and nothing that says
// the page is installed.
const IPHONE_WEBVIEW =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';

// What Safari on an iPad sends by default since iPadOS 13: a Mac's.
const IPAD_SAFARI =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';

function browser({
  userAgent,
  standalone = false,
  displayModeStandalone = false,
  capacitor,
  maxTouchPoints = 0,
}: {
  userAgent: string;
  standalone?: boolean;
  displayModeStandalone?: boolean;
  capacitor?: { isNativePlatform: () => boolean };
  maxTouchPoints?: number;
}) {
  const navigator = { userAgent, standalone, maxTouchPoints };
  vi.stubGlobal('navigator', navigator);
  vi.stubGlobal('window', {
    navigator,
    matchMedia: () => ({ matches: displayModeStandalone }),
    ...(capacitor ? { Capacitor: capacitor } : {}),
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('whether the app is already installed', () => {
  it('counts the App Store app as installed, so it is never told to add itself to the home screen', () => {
    // The native app is a WKWebView under Capacitor: its display mode reads
    // "browser" and navigator.standalone is false, but its user agent says
    // iPhone. It was showing "Tap Share, then Add to Home Screen" — there is
    // no Share button in the app — and holding the backup nudge back until
    // that was dismissed.
    browser({ userAgent: IPHONE_WEBVIEW, capacitor: { isNativePlatform: () => true } });
    expect(isStandalone()).toBe(true);
  });

  it('does not count a page in Safari as installed', () => {
    browser({ userAgent: IPHONE_WEBVIEW });
    expect(isStandalone()).toBe(false);
    expect(isMobile() && isIOS()).toBe(true);
  });

  it('does not count a page in a browser as installed just because Capacitor is loaded', () => {
    browser({ userAgent: IPHONE_WEBVIEW, capacitor: { isNativePlatform: () => false } });
    expect(isStandalone()).toBe(false);
  });

  it('counts an icon added to the home screen as installed', () => {
    browser({ userAgent: IPHONE_WEBVIEW, standalone: true });
    expect(isStandalone()).toBe(true);
    browser({ userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile', displayModeStandalone: true });
    expect(isStandalone()).toBe(true);
  });
});

describe('which devices are iPhones and iPads', () => {
  it('recognises an iPad, although its Safari says it is a Mac', () => {
    // The "ipad" in the user-agent test had not matched default iPad Safari
    // for years, so iPad users were never shown how to install.
    browser({ userAgent: IPAD_SAFARI, maxTouchPoints: 5 });
    expect(isIOS()).toBe(true);
    expect(isMobile()).toBe(true);
  });

  it('still takes a Mac for a Mac', () => {
    browser({ userAgent: IPAD_SAFARI, maxTouchPoints: 0 });
    expect(isIOS()).toBe(false);
    expect(isMobile()).toBe(false);
  });

  it('does not tell the iPad app to add itself to the home screen either', () => {
    // The iPad's WKWebView sends the same Mac user agent.
    browser({ userAgent: IPAD_SAFARI, maxTouchPoints: 5, capacitor: { isNativePlatform: () => true } });
    expect(isStandalone()).toBe(true);
  });
});

const ANDROID_CHROME =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';

describe("holding Chrome's install offer until the banner is up", () => {
  // Module state: each test gets its own copy.
  async function fresh() {
    vi.resetModules();
    return import('./installPrompt');
  }

  function offer() {
    return new Event('beforeinstallprompt', { cancelable: true });
  }

  it('keeps an offer made while the sign-in screen is still up', async () => {
    // Chrome makes the offer once per page load. The banner only exists in
    // the signed-in app, so an offer made before that was lost, and the
    // "Install the app" row never appeared that session.
    const { holdInstallPrompt, heldInstallPrompt } = await fresh();
    const page = new EventTarget();
    holdInstallPrompt(page, () => true);
    const event = offer();
    page.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(heldInstallPrompt()).toBe(event);
  });

  it('passes on an offer made after the banner is up', async () => {
    const { holdInstallPrompt, onInstallPrompt } = await fresh();
    const page = new EventTarget();
    holdInstallPrompt(page, () => true);
    const heard = vi.fn();
    const stop = onInstallPrompt(heard);
    const event = offer();
    page.dispatchEvent(event);
    expect(heard).toHaveBeenCalledWith(event);
    stop();
    page.dispatchEvent(offer());
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it('forgets an offer once it has been used, since Chrome allows it once', async () => {
    const { holdInstallPrompt, heldInstallPrompt, releaseInstallPrompt } = await fresh();
    const page = new EventTarget();
    holdInstallPrompt(page, () => true);
    page.dispatchEvent(offer());
    releaseInstallPrompt();
    expect(heldInstallPrompt()).toBeNull();
  });

  it("leaves Chrome's own offer alone where the banner would not show it", async () => {
    const { holdInstallPrompt, heldInstallPrompt } = await fresh();
    const page = new EventTarget();
    holdInstallPrompt(page, () => false);
    const event = offer();
    page.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(heldInstallPrompt()).toBeNull();
  });

  it('holds it for an Android phone in the browser, until the banner has been turned down', async () => {
    const stored = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (key: string) => stored.get(key) ?? null });
    browser({ userAgent: ANDROID_CHROME, maxTouchPoints: 5 });

    const first = await fresh();
    const page = new EventTarget();
    first.holdInstallPrompt(page);
    page.dispatchEvent(offer());
    expect(first.heldInstallPrompt()).not.toBeNull();

    stored.set('showrunner:installPromptDismissed', '1');
    const declined = await fresh();
    const again = new EventTarget();
    declined.holdInstallPrompt(again);
    const event = offer();
    again.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(declined.heldInstallPrompt()).toBeNull();
  });
});

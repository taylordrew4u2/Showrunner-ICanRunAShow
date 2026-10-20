/**
 * Detects whether the app is already running installed (standalone display
 * mode) vs. in a regular mobile browser tab. The native-app feel — no address
 * bar, no browser chrome, its own app-switcher entry — only fully applies once
 * installed, so the rest of the UI uses this to nudge un-installed visitors.
 */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  // The App Store app is a WKWebView under Capacitor, which reports neither
  // of the signs below — but it is as installed as an app gets, and has no
  // Share button to add itself to the home screen with. Capacitor's bridge
  // is injected into the page it loads, and says so.
  const capacitor = (window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  if (capacitor?.isNativePlatform?.() === true) return true;
  const mql = window.matchMedia?.('(display-mode: standalone)').matches;
  // iOS Safari predates the display-mode media query; it exposes this instead.
  const iosStandalone = (window.navigator as { standalone?: boolean }).standalone === true;
  return Boolean(mql || iosStandalone);
}

/**
 * Safari on an iPad has sent a Mac's user agent by default since iPadOS 13,
 * so "ipad" never appears. A Mac has no touch screen; that tells them apart.
 */
function isIPadOS(): boolean {
  return /macintosh/i.test(navigator.userAgent) && (navigator.maxTouchPoints ?? 0) > 1;
}

export function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || isIPadOS();
}

export function isMobile(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /android|iphone|ipad|ipod/i.test(navigator.userAgent) || isIPadOS();
}

const DISMISSED_KEY = 'showrunner:installPromptDismissed';

/** Whether this device has turned the install banner down. */
export function installPromptDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

export function dismissInstallPrompt(): void {
  try {
    localStorage.setItem(DISMISSED_KEY, '1');
  } catch {
    /* ignore */
  }
}

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/** Where the banner would offer Chrome's one-tap install: an Android phone's browser. */
function offersInstall(): boolean {
  return !installPromptDismissed() && !isStandalone() && isMobile() && !isIOS();
}

let held: BeforeInstallPromptEvent | null = null;
const listeners = new Set<(event: BeforeInstallPromptEvent) => void>();

/**
 * Keep Chrome's install offer from the moment the page loads. Called once, at
 * boot.
 *
 * Chrome makes the offer once per page load, and usually while the sign-in
 * screen or the loading skeleton is still up — but the banner that uses it
 * only exists in the signed-in app. Listening from the banner missed it, and
 * the "Install the app" row never appeared that session.
 */
export function holdInstallPrompt(
  page: EventTarget = window,
  wanted: () => boolean = offersInstall,
): void {
  page.addEventListener('beforeinstallprompt', (event) => {
    if (!wanted()) return;
    // Chrome's own mini-infobar stays down; the banner makes the offer.
    event.preventDefault();
    held = event as BeforeInstallPromptEvent;
    for (const listener of listeners) listener(held);
  });
}

/** The offer, if one has been made and not yet used. */
export function heldInstallPrompt(): BeforeInstallPromptEvent | null {
  return held;
}

/** Hear about an offer made from now on. Returns the unsubscribe. */
export function onInstallPrompt(listener: (event: BeforeInstallPromptEvent) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Chrome lets an offer be shown once; forget it after. */
export function releaseInstallPrompt(): void {
  held = null;
}

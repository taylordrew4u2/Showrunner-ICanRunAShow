/**
 * Detects whether the app is already running installed (standalone display
 * mode) vs. in a regular mobile browser tab. The native-app feel — no address
 * bar, no browser chrome, its own app-switcher entry — only fully applies once
 * installed, so the rest of the UI uses this to nudge un-installed visitors.
 */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const mql = window.matchMedia?.('(display-mode: standalone)').matches;
  // iOS Safari predates the display-mode media query; it exposes this instead.
  const iosStandalone = (window.navigator as { standalone?: boolean }).standalone === true;
  return Boolean(mql || iosStandalone);
}

export function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

export function isMobile(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /android|iphone|ipad|ipod/i.test(navigator.userAgent);
}

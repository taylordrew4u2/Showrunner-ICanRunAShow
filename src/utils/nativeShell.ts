/**
 * Whether this page is running inside the iOS app rather than a browser.
 *
 * The app is a Capacitor shell around the live site (see capacitor.config.ts),
 * so the code is the same either way and Capacitor's bridge is the only tell:
 * the shell puts `window.Capacitor` on the page before any of the page's own
 * scripts run, and it says whether there's a native platform behind it. A
 * browser has no bridge at all, and the web build never loads one.
 */
export function isNativeShell(): boolean {
  if (typeof window === 'undefined') return false;
  const bridge = (window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return bridge?.isNativePlatform?.() === true;
}

/**
 * Best-effort tactile feedback for taps.
 *
 * Vibration only does anything on devices that implement the Vibration API
 * (Android Chrome, some others). iOS Safari and installed iOS PWAs do NOT
 * expose any web haptics API, so this is a no-op there by design — the visual
 * press states carry the "feel" on iPhone.
 */
export function vibrateTap(ms = 10): void {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(ms);
    }
  } catch {
    /* vibration is best-effort; never let it throw */
  }
}

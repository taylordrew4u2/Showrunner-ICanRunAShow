/**
 * Pairing a stage remote by listening to it.
 *
 * The operator is often also on the bill. Once they are on stage they are
 * nowhere near the laptop, and the music still has to start and stop — so the
 * remote has to be a physical button in a pocket, not a screen.
 *
 * Bluetooth clickers all pair as keyboards, but there is no agreement on what
 * they send: some Enter, some Space, some a letter, some the volume keys.
 * Guessing at brands is hopeless, so the app listens once and remembers
 * whatever this particular button sends.
 */

/**
 * Keys the operating system takes for itself, which therefore never reach a
 * web page. Selfie clickers overwhelmingly send volume-up — that is how phone
 * camera apps trigger a shutter — so this is the common disappointment, and
 * worth naming precisely rather than failing silently.
 */
const SWALLOWED_BY_OS = new Set([
  'AudioVolumeUp',
  'AudioVolumeDown',
  'AudioVolumeMute',
  'MediaPlayPause',
  'MediaTrackNext',
  'MediaTrackPrevious',
]);

/** Keys the app already needs for something else, or that mean "get me out". */
const RESERVED = new Set(['Escape', 'Tab', 'Shift', 'Control', 'Alt', 'Meta']);

export type PairResult =
  | { ok: true; key: string }
  | { ok: false; reason: 'os-key' | 'reserved' };

/** Decide whether a captured key can serve as the remote's button. */
export function keyFromEvent(key: string): PairResult {
  if (SWALLOWED_BY_OS.has(key)) return { ok: false, reason: 'os-key' };
  if (RESERVED.has(key)) return { ok: false, reason: 'reserved' };
  return { ok: true, key };
}

/** What to show for a bound key, since ' ' and 'ArrowRight' read badly raw. */
export function describeKey(key: string): string {
  if (key === ' ') return 'Space';
  if (key === 'Enter') return 'Enter';
  if (key.startsWith('Arrow')) return key.replace('Arrow', '') + ' arrow';
  if (key.length === 1) return key.toUpperCase();
  return key;
}

/** Why a key could not be used, in words the operator can act on. */
export function explainFailure(reason: 'os-key' | 'reserved'): string {
  return reason === 'os-key'
    ? "That button sends a volume or media key, which your computer keeps for itself — the app never sees it. If your remote has an iOS/Android switch, try the other setting; otherwise a page-turner pedal will work where this won't."
    : 'That key is needed for something else. Try another button on the remote.';
}

/**
 * Whether a keypress is the paired remote firing.
 *
 * Matched case-insensitively for single characters: a clicker that sends a
 * bare letter can arrive shifted depending on how it was paired, and a remote
 * that works only some of the time is worse than one that never did.
 */
export function isRemotePress(key: string, bound?: string): boolean {
  if (!bound) return false;
  if (bound.length === 1 && key.length === 1) return key.toLowerCase() === bound.toLowerCase();
  return key === bound;
}

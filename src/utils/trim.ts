/**
 * Reading and writing the in/out points of a song.
 *
 * Producers think in mm:ss because that is what every music player shows them,
 * so that is what these fields take and print. Bare seconds are accepted too —
 * someone who knows the drop is at 47 shouldn't have to type "0:47".
 */

/** Parse "1:23", "83", "1:23.5" to seconds. Null when it isn't a time. */
export function parseTimecode(input: string): number | null {
  const text = input.trim();
  if (!text) return null;
  // mm:ss(.ms) or h:mm:ss — split on colons and read right to left, so the
  // same code handles both without asking which one it was given.
  const parts = text.split(':');
  if (parts.length > 3) return null;
  let seconds = 0;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i].trim();
    if (!/^\d*\.?\d+$/.test(part)) return null;
    const value = Number(part);
    if (!Number.isFinite(value)) return null;
    // Only the leading group may exceed 59. Bare "90" is a minute and a half,
    // and "90:00" is a long recording, but "1:90" is someone mistyping.
    if (parts.length > 1 && i > 0 && value > 59) return null;
    seconds = seconds * 60 + value;
  }
  return seconds < 0 ? null : seconds;
}

/** Print seconds as mm:ss, or h:mm:ss past an hour. */
export function formatTimecode(seconds: number | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return '';
  const total = Math.round(seconds);
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/**
 * How long the trimmed section runs, or null when it plays to the end.
 *
 * An out-point at or before the in-point is not a zero-length song, it's a
 * half-finished edit — treated as "no out-point" so the button still plays
 * something rather than nothing.
 */
export function trimmedLength(startSec?: number, endSec?: number): number | null {
  const start = startSec && startSec > 0 ? startSec : 0;
  if (endSec == null || !(endSec > start)) return null;
  return endSec - start;
}

/** A short human summary of a trim, for a row that has one. */
export function trimSummary(startSec?: number, endSec?: number): string | null {
  const length = trimmedLength(startSec, endSec);
  const hasStart = !!startSec && startSec > 0;
  if (!hasStart && length == null) return null;
  if (length == null) return `from ${formatTimecode(startSec)}`;
  if (!hasStart) return `first ${formatTimecode(length)}`;
  return `${formatTimecode(startSec)}–${formatTimecode(endSec)}`;
}

import type { Show } from '../types';

/**
 * Locate the embedded media that makes a show too large to save, so the
 * "too large" error can point at exact files instead of making the user hunt.
 */

interface EmbeddedItem {
  label: string;
  bytes: number;
}

// A base64 data URL encodes ~3 bytes per 4 characters.
const dataUrlBytes = (value?: string): number =>
  value && value.startsWith('data:') ? Math.round(value.length * 0.75) : 0;

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Collect every embedded media item in a show with a human label. */
function collectEmbedded(show: Show): EmbeddedItem[] {
  const items: EmbeddedItem[] = [];
  const add = (label: string, value?: string) => {
    const bytes = dataUrlBytes(value);
    if (bytes > 0) items.push({ label, bytes });
  };

  for (const p of show.performers || []) {
    add(`${p.name} — walk-on music`, p.walkOnMusic);
  }
  for (const a of show.artists || []) {
    add(`${a.name} — walk-on music`, a.walkOnMusic);
  }
  for (const c of show.schedule || []) {
    add(`cue "${c.description || c.time}" — music`, c.music);
  }

  return items.sort((a, b) => b.bytes - a.bytes);
}

/**
 * Human-readable list of the biggest embedded files in a show, e.g.
 * `Alice — walk-on music (8.2 MB), Bea — walk-on music (3.1 MB)`.
 */
export function describeLargestMedia(show: Show, limit = 3): string {
  const items = collectEmbedded(show).slice(0, limit);
  if (items.length === 0) return '';
  return items.map((i) => `${i.label} (${formatBytes(i.bytes)})`).join(', ');
}

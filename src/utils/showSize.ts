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

  add('flyer', show.flyer);
  add('schedule image', show.scheduleImage);
  add('artist flash sheet', show.artistFlashImage);
  add('artist schedule image', show.artistScheduleImage);
  for (const p of show.performers || []) {
    add(`${p.name} — walk-on music`, p.walkOnMusic);
    add(`${p.name} — video`, p.video);
    add(`${p.name} — photo`, p.photo);
    (p.photos || []).forEach((ph, i) => {
      if (ph !== p.photo) add(`${p.name} — photo ${i + 1}`, ph);
    });
  }
  for (const a of show.artists || []) {
    add(`${a.name} — walk-on music`, a.walkOnMusic);
    add(`${a.name} — video`, a.video);
    add(`${a.name} — photo`, a.photo);
    add(`${a.name} — file${a.fileName ? ` (${a.fileName})` : ''}`, a.file);
  }
  for (const c of show.schedule || []) {
    add(`cue "${c.description || c.time}" — music`, c.music);
  }
  for (const f of show.files || []) {
    add(`file "${f.name}"`, f.fileData);
  }
  for (const h of show.hosts || []) add(`${h.name} — photo`, h.photo);
  for (const v of show.vendors || []) add(`${v.name} — photo`, v.photo);
  for (const e of show.expenses || []) add(`receipt for "${e.itemName}"`, e.receiptPhoto);

  return items.sort((a, b) => b.bytes - a.bytes);
}

/**
 * Human-readable list of the biggest embedded files in a show, e.g.
 * `Alice — walk-on music (8.2 MB), flyer (3.1 MB)`.
 */
export function describeLargestMedia(show: Show, limit = 3): string {
  const items = collectEmbedded(show).slice(0, limit);
  if (items.length === 0) return '';
  return items.map((i) => `${i.label} (${formatBytes(i.bytes)})`).join(', ');
}

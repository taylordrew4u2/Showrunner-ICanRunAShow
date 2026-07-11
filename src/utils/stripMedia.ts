import type { AppSettings, Show } from '../types';

/**
 * The app no longer stores photos, videos, or generic file uploads — walk-on
 * songs (kept in the chunked media store) are the only uploads. Accounts that
 * saved before this change can still carry megabytes of embedded base64 media
 * in their show/settings payloads, so scrub those legacy keys on load; the
 * next save then writes the slimmed-down data and storage shrinks back down.
 */

type LegacyRecord = Record<string, unknown>;

function scrub(obj: unknown, keys: string[]): void {
  if (!obj || typeof obj !== 'object') return;
  for (const k of keys) delete (obj as LegacyRecord)[k];
}

/** Remove legacy embedded media (photos, videos, files) from a show in place. */
export function stripLegacyShowMedia(show: Show): Show {
  scrub(show, ['flyer', 'scheduleImage', 'artistFlashImage', 'artistScheduleImage', 'files']);
  for (const p of show.performers || []) scrub(p, ['photo', 'photos', 'video']);
  for (const a of show.artists || []) scrub(a, ['photo', 'video', 'file', 'fileName']);
  for (const h of show.hosts || []) scrub(h, ['photo']);
  for (const v of show.vendors || []) scrub(v, ['photo']);
  for (const e of show.expenses || []) scrub(e, ['receiptPhoto']);
  return show;
}

/** Remove legacy embedded media from settings (Rolodex photos, receipts, trash). */
export function stripLegacySettingsMedia(settings: AppSettings): AppSettings {
  for (const c of settings.potentialComics || []) scrub(c, ['photo', 'photos']);
  for (const e of settings.expenses || []) scrub(e, ['receiptPhoto']);
  for (const t of settings.trash || []) {
    if (t.data) stripLegacyShowMedia(t.data);
  }
  return settings;
}

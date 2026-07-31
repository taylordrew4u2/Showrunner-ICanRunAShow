import type { AppSettings, Show } from '../types';
import { isMediaRef } from './mediaStore';

/**
 * The app doesn't embed uploads in the show payload — audio and performer
 * photos live in the chunked media store and the payload carries only a small
 * `media:` reference. Accounts that saved before that change can still carry
 * megabytes of embedded base64 media, so scrub those legacy keys on load; the
 * next save then writes the slimmed-down data and storage shrinks back down.
 *
 * A performer photo is the one key that can be either: a legacy base64 blob to
 * throw away, or a current reference to keep. It's checked rather than deleted.
 */

type LegacyRecord = Record<string, unknown>;

function scrub(obj: unknown, keys: string[]): void {
  if (!obj || typeof obj !== 'object') return;
  for (const k of keys) delete (obj as LegacyRecord)[k];
}

/** Drop a photo field unless it's a media-store reference. */
function scrubEmbeddedPhoto(obj: unknown): void {
  if (!obj || typeof obj !== 'object') return;
  const rec = obj as LegacyRecord;
  if (typeof rec.photo === 'string' && isMediaRef(rec.photo)) return;
  delete rec.photo;
}

/** Remove legacy embedded media (photos, videos, files) from a show in place. */
export function stripLegacyShowMedia(show: Show): Show {
  scrub(show, ['flyer', 'scheduleImage', 'artistFlashImage', 'artistScheduleImage', 'files']);
  for (const p of show.performers || []) {
    scrub(p, ['photos', 'video']);
    scrubEmbeddedPhoto(p);
  }
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

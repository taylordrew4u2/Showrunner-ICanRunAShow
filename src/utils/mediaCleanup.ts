import type { AppSettings, Show } from '../types';
import { api } from './api';
import { isMediaRef, parseMediaRef } from './mediaStore';
import { songOwnsItsMedia } from './musicLibrary';
import type { SessionCredentials } from './session-vault';

/**
 * Working out which uploaded files are safe to delete.
 *
 * Uploads live in the media store as encrypted chunks, and nothing collects
 * them: a show deleted with a headliner's walk-on track on it left that audio
 * on the server for good. Over a year of shows that is the largest thing in
 * the account, and it is all unreachable.
 *
 * The reason it can't simply be "delete what the show pointed at" is that a
 * reference is not owned by the thing holding it. Duplicating a show
 * structuredClones it, so the copy carries the *same* media ids; a library
 * track appears in every show's DJ list while the audio belongs to the
 * library; and a show sitting in the trash can still be restored, so its
 * references are alive too. Deleting a file another record still points at
 * costs the user data, which is far worse than the disk it saves.
 *
 * So the rule here is: collect what the deleted thing referenced, subtract
 * everything still reachable from anywhere else, and delete only what is left.
 */

function push(into: Set<string>, value?: string): void {
  if (value && isMediaRef(value)) into.add(value);
}

/** Every media reference a show points at, whether or not it is shared. */
export function showMediaRefs(show: Show): string[] {
  const refs = new Set<string>();
  for (const p of show.performers ?? []) {
    push(refs, p.photo);
    push(refs, p.walkOnMusic);
  }
  for (const a of show.artists ?? []) {
    push(refs, a.walkOnMusic);
  }
  for (const cue of show.schedule ?? []) {
    push(refs, cue.music);
  }
  for (const song of show.djSongs ?? []) {
    // A song added from the library points at audio the library owns; the show
    // is a borrower, and deleting the show must not take it.
    if (songOwnsItsMedia(song)) push(refs, song.music);
  }
  return [...refs];
}

/**
 * Every media reference reachable from account-level data.
 *
 * Trash counts: a show in the trash can be restored, and restoring it to find
 * its audio gone would be a worse bug than the storage it frees.
 */
export function settingsMediaRefs(settings: AppSettings): string[] {
  const refs = new Set<string>();
  for (const track of settings.musicLibrary ?? []) push(refs, track.music);
  for (const comic of settings.potentialComics ?? []) push(refs, comic.walkOnMusic);
  for (const contract of settings.contracts ?? []) push(refs, contract.fileRef);
  for (const item of settings.trash ?? []) {
    if (item.data) for (const ref of showMediaRefs(item.data)) refs.add(ref);
  }
  return [...refs];
}

/**
 * Of `candidates`, the references nothing else still points at.
 *
 * `shows` and `settings` must be the state *after* the deletion — what will
 * still exist once this is saved — or a file about to become unreachable will
 * look reachable and be kept forever.
 */
export function orphanedRefs(
  candidates: string[],
  shows: Show[],
  settings: AppSettings,
): string[] {
  const live = new Set<string>(settingsMediaRefs(settings));
  for (const show of shows) {
    for (const ref of showMediaRefs(show)) live.add(ref);
  }
  const seen = new Set<string>();
  return candidates.filter((ref) => {
    if (!isMediaRef(ref) || live.has(ref) || seen.has(ref)) return false;
    seen.add(ref);
    return true;
  });
}

// ── Reclaiming what earlier versions left behind ─────────────────────────────

/** One stored file, as the server sees it: an id and a size, never content. */
export interface StoredMedia {
  id: string;
  chunks: number;
  bytes: number;
}

/** Every media id reachable from the account's current data. */
export function liveMediaIds(shows: Show[], settings: AppSettings): Set<string> {
  const ids = new Set<string>();
  const add = (ref: string) => {
    const parsed = parseMediaRef(ref);
    if (parsed) ids.add(parsed.id);
  };
  for (const ref of settingsMediaRefs(settings)) add(ref);
  for (const show of shows) for (const ref of showMediaRefs(show)) add(ref);
  return ids;
}

/**
 * Stored files nothing points at any more.
 *
 * These are the ones deletion used to leave behind: a show removed before
 * anything collected its uploads has no trace left in the account's data, so
 * its audio is unreachable but still stored.
 */
export function unreferencedMedia(
  stored: StoredMedia[],
  shows: Show[],
  settings: AppSettings,
): StoredMedia[] {
  const live = liveMediaIds(shows, settings);
  return stored.filter((item) => !live.has(item.id));
}

export interface SweepReport {
  scanned: number;
  removed: number;
  bytes: number;
  failed: number;
}

/**
 * Find and delete every stored file the account no longer references.
 *
 * The caller must be sure `shows` and `settings` are the account's complete,
 * loaded data — a half-loaded client would see almost nothing as referenced
 * and delete almost everything. `dryRun` reports without touching anything,
 * which is what the screen offering this shows before asking.
 */
export async function sweepUnusedMedia(
  shows: Show[],
  settings: AppSettings,
  creds: SessionCredentials,
  { dryRun = false }: { dryRun?: boolean } = {},
): Promise<SweepReport> {
  const auth = { authUserId: creds.userId, authHash: creds.authHash };
  const { items } = await api.get<{ items: StoredMedia[] }>('/api/media?list=1', auth);
  const unused = unreferencedMedia(items ?? [], shows, settings);
  const report: SweepReport = {
    scanned: items?.length ?? 0,
    removed: 0,
    bytes: unused.reduce((sum, item) => sum + (item.bytes || 0), 0),
    failed: 0,
  };
  if (dryRun) {
    report.removed = unused.length;
    return report;
  }
  for (const item of unused) {
    try {
      await api.del(`/api/media?id=${encodeURIComponent(item.id)}`, auth);
      report.removed += 1;
    } catch {
      // One failure should not abandon the rest of the sweep; the file stays
      // and the next run will find it again.
      report.failed += 1;
    }
  }
  return report;
}

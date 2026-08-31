import type { AppSettings, Show } from '../types';
import { isMediaRef } from './mediaStore';
import { songOwnsItsMedia } from './musicLibrary';

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

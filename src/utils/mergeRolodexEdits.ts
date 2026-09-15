import type { PotentialComic } from '../types';
import { COMIC_PROFILE_FIELDS, getComicProfilePatch } from './rolodex';

/** Apply a captured editor's changes without replacing newer canonical fields. */
export function mergeRolodexEdits(
  baseline: PotentialComic[],
  incoming: PotentialComic[],
  current: PotentialComic[],
): PotentialComic[] {
  const beforeById = new Map(baseline.map(comic => [comic.id, comic]));
  const incomingById = new Map(incoming.map(comic => [comic.id, comic]));
  const currentIds = new Set(current.map(comic => comic.id));
  let changed = false;
  const kept: PotentialComic[] = [];

  for (const comic of current) {
    const before = beforeById.get(comic.id);
    const edited = incomingById.get(comic.id);
    if (before && !edited) {
      changed = true;
      continue;
    }
    // Entries created since this editor's snapshot remain authoritative.
    if (!before || !edited) {
      kept.push(comic);
      continue;
    }
    const patch = getComicProfilePatch(before, edited);
    const changesCurrent = COMIC_PROFILE_FIELDS.some(field =>
      Object.hasOwn(patch, field) && !Object.is(comic[field], patch[field]),
    );
    if (changesCurrent) {
      kept.push({ ...comic, ...patch });
      changed = true;
    } else {
      kept.push(comic);
    }
  }

  // A stale editor cannot bring back someone deleted after it was opened.
  const additions = [...incomingById.values()].filter(comic =>
    !beforeById.has(comic.id) && !currentIds.has(comic.id),
  );
  if (!changed && additions.length === 0) return current;
  return [...additions, ...kept];
}

import type { Artist, Performer, PotentialComic, Show } from '../types';
import { generateId } from './id';

/** Personal fields belong to one comic; show-slot ids and contracts do not. */
export const COMIC_PROFILE_FIELDS = [
  'name', 'photo', 'socialMedia', 'email', 'phone', 'notes', 'credits', 'videoLink',
  'walkOnMusic', 'walkOnMusicName', 'walkOnMusicArtist', 'walkOnMusicTimestamp',
  'walkOnMusicLink', 'walkOnStartSec', 'walkOnEndSec',
] as const satisfies readonly (keyof Performer & keyof PotentialComic)[];

export type ComicProfile = Pick<PotentialComic, typeof COMIC_PROFILE_FIELDS[number]>;

/** Case and stray whitespace vary between old lineups and their Rolodex entry. */
export function rolodexKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

function profileFields(profile: ComicProfile): ComicProfile {
  return Object.fromEntries(COMIC_PROFILE_FIELDS.map((field) => [field, profile[field]])) as ComicProfile;
}

/** Only edited fields are written back, so a stale show cannot erase new data. */
export function getComicProfilePatch(before: ComicProfile, after: ComicProfile): Partial<ComicProfile> {
  return Object.fromEntries(
    COMIC_PROFILE_FIELDS
      .filter((field) => !Object.is(before[field], after[field]))
      .map((field) => [field, after[field]]),
  ) as Partial<ComicProfile>;
}

/** A linked performer keeps their identity when saved back to the Rolodex. */
export function performerToComic(performer: Performer): PotentialComic {
  return {
    ...profileFields(performer),
    id: performer.comicId || generateId(),
    name: performer.name.trim(),
  };
}

/** Each booking has its own slot id and shares the comic's complete profile. */
export function comicToPerformer(comic: PotentialComic): Performer {
  return {
    ...profileFields(comic),
    id: generateId(),
    comicId: comic.id,
    name: comic.name.trim(),
  };
}

/** A Rolodex booking in the artists section follows the same comic identity. */
export function comicToArtist(comic: PotentialComic): Artist {
  return comicToPerformer(comic);
}

/**
 * Explicit identity always wins. Legacy rows match only one exact normalized
 * name; duplicate names are left alone until the producer selects a person.
 * A deleted/missing explicit identity must never silently become someone else.
 */
export function resolvePerformerComic(
  performer: Performer,
  comics: PotentialComic[],
): PotentialComic | undefined {
  if (performer.comicId) return comics.find((comic) => comic.id === performer.comicId);
  const key = rolodexKey(performer.name ?? '');
  if (!key) return undefined;
  const matches = comics.filter((comic) => rolodexKey(comic.name) === key);
  return matches.length === 1 ? matches[0] : undefined;
}

/**
 * File new people without replacing existing profiles. A dangling explicit
 * link is left intact: removing a Rolodex entry should not recreate it.
 */
export function addPerformersToRolodex(
  comics: PotentialComic[],
  performers: Performer[],
): PotentialComic[] | null {
  const known = new Set(comics.map((comic) => rolodexKey(comic.name)));
  const additions: PotentialComic[] = [];
  for (const performer of performers) {
    const key = rolodexKey(performer.name ?? '');
    if (performer.comicId || !key || known.has(key)) continue;
    known.add(key);
    additions.push(performerToComic(performer));
  }
  return additions.length ? [...additions, ...comics] : null;
}

function hydratePerformer<T extends Performer>(performer: T, comic: PotentialComic): T {
  if (performer.comicId === comic.id &&
      COMIC_PROFILE_FIELDS.every((field) => Object.is(performer[field], comic[field]))) {
    return performer;
  }
  // Include undefined optional values so clearing a field clears every copy.
  return { ...performer, ...profileFields(comic), comicId: comic.id };
}

/**
 * Refresh only already-linked profiles. Schedule links keep their show-slot
 * ids; labels that still use the previous name follow a rename. Custom cue
 * labels and every other show field remain unchanged.
 */
export function syncShowsWithRolodex(comics: PotentialComic[], shows: Show[]): Show[] {
  const byId = new Map(comics.map((comic) => [comic.id, comic]));
  let changed = false;
  const synced = shows.map((show) => {
    let performersChanged = false;
    const renames = new Map<string, { before: string; after: string }>();
    const hydrate = <T extends Performer>(performer: T): T => {
      const comic = performer.comicId ? byId.get(performer.comicId) : undefined;
      if (!comic) return performer;
      const hydrated = hydratePerformer(performer, comic);
      if (hydrated !== performer) performersChanged = true;
      if (hydrated.name !== performer.name) {
        renames.set(performer.id, { before: performer.name, after: hydrated.name });
      }
      return hydrated;
    };
    const performers = show.performers.map(hydrate);
    const artists = show.artists.map(hydrate);
    if (!performersChanged) return show;
    let scheduleChanged = false;
    const schedule = show.schedule.map((item) => {
      const rename = item.performerId ? renames.get(item.performerId) : undefined;
      if (!rename || item.performer !== rename.before) return item;
      scheduleChanged = true;
      return { ...item, performer: rename.after };
    });
    changed = true;
    return { ...show, performers, artists, ...(scheduleChanged ? { schedule } : {}) };
  });
  return changed ? synced : shows;
}

function hasProfileValue(value: ComicProfile[keyof ComicProfile]): boolean {
  return value !== undefined && value !== null && (typeof value !== 'string' || value.trim() !== '');
}

/**
 * Migrate old snapshots to shared identity without losing richer saved data.
 * First collect missing people, then fill gaps from all safely matched legacy
 * rows, and only then hydrate the shows. This lets a headshot saved in one old
 * show and a social handle saved in another survive the migration together.
 *
 * Linked rows never backfill the Rolodex: once identity is established its
 * empty values may be intentional clears, including after a page reload.
 */
export function reconcileRolodexProfiles(
  comics: PotentialComic[],
  shows: Show[],
): { comics: PotentialComic[]; shows: Show[] } {
  let reconciledComics = addPerformersToRolodex(comics, shows.flatMap((show) => show.performers)) ?? comics;
  const backfills = new Map<string, PotentialComic>();
  for (const show of shows) {
    for (const performer of [...show.performers, ...show.artists]) {
      if (performer.comicId) continue;
      const matched = resolvePerformerComic(performer, reconciledComics);
      if (!matched) continue;
      const current = backfills.get(matched.id) ?? matched;
      const missing = COMIC_PROFILE_FIELDS.filter(
        (field) => !hasProfileValue(current[field]) && hasProfileValue(performer[field]),
      );
      if (missing.length) {
        backfills.set(current.id, {
          ...current,
          ...Object.fromEntries(missing.map((field) => [field, performer[field]])),
        });
      }
    }
  }
  if (backfills.size) {
    reconciledComics = reconciledComics.map((comic) => backfills.get(comic.id) ?? comic);
  }
  let linksChanged = false;
  const linkedShows = shows.map((show) => {
    let changed = false;
    const link = <T extends Performer>(performer: T): T => {
      if (performer.comicId) return performer;
      const matched = resolvePerformerComic(performer, reconciledComics);
      if (!matched) return performer;
      changed = true;
      return { ...performer, comicId: matched.id };
    };
    const performers = show.performers.map(link);
    const artists = show.artists.map(link);
    if (!changed) return show;
    linksChanged = true;
    return { ...show, performers, artists };
  });
  return {
    comics: reconciledComics,
    shows: syncShowsWithRolodex(reconciledComics, linksChanged ? linkedShows : shows),
  };
}

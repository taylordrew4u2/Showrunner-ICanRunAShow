import type { Artist, Performer, PotentialComic, Show } from '../types';
import { generateId } from './id';
import { HOST_COMIC_FIELD, HOST_SLOTS, HOST_SOCIAL_FIELD, hostSlot, type HostFields, type HostSlot } from './showHosts';
import { toHandle } from './social';
import { withWalkOnSongs } from './walkOnSongs';

/** Personal fields belong to one comic; show-slot ids and contracts do not. */
export const COMIC_PROFILE_FIELDS = [
  'name', 'photo', 'socialMedia', 'email', 'phone', 'notes', 'credits', 'videoLink', 'tapeMinutes',
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

/**
 * Whether an edit to a booked slot typed a different person over it.
 *
 * A name edit on a linked slot used to be written back to the Rolodex as a
 * rename, so retyping "Alex Rivera" over Sam Okafor's slot renamed Sam's
 * entry to Alex — and Alex's booking, flyer and soundboard pad all wore
 * Sam's headshot, socials and credits. The new name is the tell: a fix to
 * the spelling keeps the same key, and a different key is a different act.
 */
export function slotReassigned(before: Pick<Performer, 'name'>, after: Pick<Performer, 'name'>): boolean {
  const from = rolodexKey(before.name ?? '');
  const to = rolodexKey(after.name ?? '');
  return !!from && !!to && from !== to;
}

/**
 * The slot as a fresh booking of whoever was just named, keeping only what
 * the producer typed into it. The link to the old entry goes, and so does
 * every profile field the slot merely inherited from that entry — the
 * headshot above all. A field the edit changed at the same time is theirs
 * and stays. Reconciling the show afterwards files the new name in the
 * Rolodex, or links it to the entry already there.
 */
export function reassignSlot<T extends Performer>(slot: T, previous: ComicProfile): T {
  const cleared: Partial<ComicProfile> = {};
  for (const field of COMIC_PROFILE_FIELDS) {
    if (field === 'name') continue;
    if (Object.is(slot[field], previous[field])) cleared[field] = undefined;
  }
  return { ...slot, ...cleared, comicId: undefined };
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
 * `fromSample` names the bookings that are on a sample show: an entry filed
 * from one of those is marked as such (see PotentialComic.fromSample).
 */
export function addPerformersToRolodex(
  comics: PotentialComic[],
  performers: Performer[],
  fromSample?: ReadonlySet<Performer>,
): PotentialComic[] | null {
  const known = new Set(comics.map((comic) => rolodexKey(comic.name)));
  const additions: PotentialComic[] = [];
  for (const performer of performers) {
    const key = rolodexKey(performer.name ?? '');
    if (performer.comicId || !key || known.has(key)) continue;
    known.add(key);
    const filed = performerToComic(performer);
    additions.push(fromSample?.has(performer) ? { ...filed, fromSample: true } : filed);
  }
  return additions.length ? [...additions, ...comics] : null;
}

/**
 * The entry as the producer's own: without the note that it was filed from a
 * sample show. Anything the producer does with the person outside a sample
 * makes them real; here, editing their entry in the Rolodex. The same object
 * when there is no note, so an unchanged Rolodex stays unchanged.
 */
export function withoutSampleMark(comic: PotentialComic): PotentialComic {
  if (!Object.hasOwn(comic, 'fromSample')) return comic;
  const own = { ...comic };
  delete own.fromSample;
  return own;
}

/**
 * Drop the sample note from everyone booked on a show of the producer's own,
 * on the bill or as a host. Bookings on a sample show keep it.
 */
function clearSampleMarks(comics: PotentialComic[], shows: readonly Show[]): PotentialComic[] {
  if (!comics.some((comic) => comic.fromSample)) return comics;
  const booked = new Set<string>();
  for (const show of shows) {
    if (show.sample) continue;
    for (const person of [...show.performers, ...(show.artists ?? [])]) {
      if (person.comicId) booked.add(person.comicId);
    }
    for (const slot of HOST_SLOTS) {
      const { comicId } = hostSlot(show, slot);
      if (comicId) booked.add(comicId);
    }
  }
  if (!comics.some((comic) => comic.fromSample && booked.has(comic.id))) return comics;
  return comics.map((comic) => (comic.fromSample && booked.has(comic.id) ? withoutSampleMark(comic) : comic));
}

/**
 * "Save to Rolodex" from a booking's drawer. An entry already there is filled
 * in, keeping a headshot the booking lacks, and keeps whatever note it has; a
 * new one saved from a sample show is marked as filed from it.
 */
export function saveToRolodex(comics: PotentialComic[], comic: PotentialComic, fromSample: boolean): PotentialComic[] {
  const existing = comics.find((c) => c.id === comic.id) ?? resolvePerformerComic(comic, comics);
  if (existing) {
    // A booking with no headshot must not blank the one already on the entry.
    return comics.map((c) => (c.id === existing.id ? { ...c, ...comic, id: c.id, photo: comic.photo ?? c.photo } : c));
  }
  return [fromSample ? { ...comic, fromSample: true } : comic, ...comics];
}

/**
 * Which comics had their headshot removed on purpose, in this write.
 *
 * A Rolodex entry with no photo usually means nothing was ever uploaded — but
 * it also meant that after a settings save that failed, raced another device,
 * or was recovered from an older copy, every show booking that person lost its
 * headshot on the next load, and the show save then made the loss permanent.
 * An upload is the one profile field that cannot be retyped, so an *absent*
 * photo never erases one any more. Only the two "Remove photo" buttons clear
 * every copy, and they say so by naming the comic here.
 *
 * `renamedFrom` is the Rolodex as it stood before the edit being synced. A
 * host is kept as a name, so an entry's new name is only a rename to the
 * shows it hosts when the old one is there to compare (see releaseRetypedHosts).
 */
export interface RolodexSyncOptions {
  clearedPhotos?: ReadonlySet<string>;
  renamedFrom?: readonly PotentialComic[];
}

function hydratePerformer<T extends Performer>(
  performer: T,
  comic: PotentialComic,
  photoCleared: boolean,
): T {
  const fields = profileFields(comic);
  if (fields.photo === undefined && !photoCleared && performer.photo) fields.photo = performer.photo;
  if (performer.comicId === comic.id &&
      COMIC_PROFILE_FIELDS.every((field) => Object.is(performer[field], fields[field]))) {
    return performer;
  }
  // Include undefined optional values so clearing a field clears every copy.
  return { ...performer, ...fields, comicId: comic.id };
}

/** A host's handle and the entry's are the same one, however each was typed. */
function sameHandle(a: string | undefined, b: string | undefined): boolean {
  const left = toHandle(a)?.toLowerCase() ?? a?.trim() ?? '';
  const right = toHandle(b)?.toLowerCase() ?? b?.trim() ?? '';
  return left === right;
}

/**
 * The one entry a typed host name can mean. As for a legacy lineup row: an
 * exact normalized name, and only when a single entry has it.
 */
function resolveHostComic(name: string, comics: readonly PotentialComic[]): PotentialComic | undefined {
  const key = rolodexKey(name);
  if (!key) return undefined;
  const matches = comics.filter((comic) => rolodexKey(comic.name) === key);
  return matches.length === 1 ? matches[0] : undefined;
}

/**
 * Whether a host typed by name may be linked to this entry.
 *
 * Linking hands the host the entry's handle. A handle typed beside the name
 * that is not the entry's is the producer saying who they mean, or a name
 * still on its way to being someone else's, so that host stays the free
 * text it is rather than having the handle swapped under it, or filed on
 * whoever the name passes through (see claimHostEntry).
 */
function hostMatchesComic(social: string, comic: PotentialComic): boolean {
  return !social.trim() || (hasProfileValue(comic.socialMedia) && sameHandle(social, comic.socialMedia));
}

/**
 * Let go of a host whose name is no longer their entry's.
 *
 * A writer from before hosts were linked, an older build of the app on
 * another device or a co-producer's, changes `host` and carries the link and
 * the handle along untouched, so its edit arrives as the new name beside the
 * old person's id. Read as a rename in the Rolodex, the edit was put back to
 * the entry's name the next time the show was opened here. The link goes
 * instead, and with it the handle that came from the entry: the name typed
 * is who is hosting, and a host taken off stays off.
 *
 * A rename is the one other way the two names come apart, and is told by
 * the entry's own previous name, where the caller has it.
 */
function releaseRetypedHosts(
  show: Show,
  byId: Map<string, PotentialComic>,
  renamedFrom: Map<string, PotentialComic> | undefined,
): Show {
  let released = show;
  for (const slot of HOST_SLOTS) {
    const held = hostSlot(released, slot);
    const comic = held.comicId ? byId.get(held.comicId) : undefined;
    if (!comic) continue;
    const key = rolodexKey(held.name);
    if (key === rolodexKey(comic.name)) continue;
    const previous = renamedFrom?.get(comic.id);
    if (key && previous && key === rolodexKey(previous.name)) continue;
    const inherited = !key || sameHandle(held.social, comic.socialMedia)
      || (!!previous && sameHandle(held.social, previous.socialMedia));
    released = {
      ...released,
      [slot]: key ? held.name : undefined,
      [HOST_SOCIAL_FIELD[slot]]: inherited ? undefined : held.social,
      [HOST_COMIC_FIELD[slot]]: undefined,
    };
  }
  return released;
}

/**
 * A host picked from the Rolodex follows their entry, as a booked performer
 * does: the entry's handle, cleared when the entry's is cleared, and its
 * name after a rename. A spelling the Rolodex reads as the same name is
 * left as typed, so a name still being typed is not corrected under the
 * cursor. Cues that carry the old name follow the rename; the host has no
 * record on the bill for them to be linked to.
 */
function syncHostsWithRolodex(
  show: Show,
  byId: Map<string, PotentialComic>,
  renamedFrom: Map<string, PotentialComic> | undefined,
): Show {
  // Whoever is still linked after this has their entry's name, or its last one.
  let synced = releaseRetypedHosts(show, byId, renamedFrom);
  for (const slot of HOST_SLOTS) {
    const held = hostSlot(synced, slot);
    const comic = held.comicId ? byId.get(held.comicId) : undefined;
    if (!comic) continue;
    const name = rolodexKey(held.name) === rolodexKey(comic.name) ? held.name : comic.name.trim();
    const social = comic.socialMedia || '';
    if (name === held.name && social === held.social) continue;
    synced = { ...synced, [slot]: name, [HOST_SOCIAL_FIELD[slot]]: social || undefined };
    if (name !== held.name && held.name.trim()) {
      const renamed = (synced.schedule ?? []).map((item) =>
        !item.performerId && item.performer === held.name ? { ...item, performer: name } : item);
      if (renamed.some((item, index) => item !== synced.schedule[index])) synced = { ...synced, schedule: renamed };
    }
  }
  return synced;
}

/**
 * A host typed by name, with a handle beside it, for the one person on file
 * by that name, who has no handle: the handle is theirs. The host is linked
 * to them, and hostSocialEdits files the handle on their entry.
 *
 * Asked when the producer leaves a host's field, never while they type. A
 * name on its way to "Alice" is "Al" for a keystroke, and filed then, Al's
 * entry kept Alice's handle and tagged Al with it on every show he played.
 */
export function claimHostEntry<T extends HostFields>(show: T, slot: HostSlot, comics: readonly PotentialComic[]): T {
  const held = hostSlot(show, slot);
  if (held.comicId || !held.social.trim()) return show;
  const matched = resolveHostComic(held.name, comics);
  if (!matched || hasProfileValue(matched.socialMedia)) return show;
  return { ...show, [HOST_SOCIAL_FIELD[slot]]: held.social.trim(), [HOST_COMIC_FIELD[slot]]: matched.id };
}

/**
 * A handle typed beside a host picked from the Rolodex is that person's
 * handle, so it goes on their entry and, from there, onto every show they
 * host or play. Only a host who was linked before the edit and still is:
 * a host just picked, or typed over, brought their own handle with them.
 * The one handle a new link does file is the one claimHostEntry linked it
 * for: typed beside the name of someone on file with none.
 */
export function hostSocialEdits(before: Show, after: Show, comics: PotentialComic[]): PotentialComic[] {
  let edited = comics;
  for (const slot of HOST_SLOTS) {
    const was = hostSlot(before, slot);
    const now = hostSlot(after, slot);
    if (!now.comicId) continue;
    if (!was.comicId) {
      const social = now.social.trim();
      if (!social || rolodexKey(was.name) !== rolodexKey(now.name)) continue;
      if (!edited.some((comic) => comic.id === now.comicId && !hasProfileValue(comic.socialMedia)
        && rolodexKey(comic.name) === rolodexKey(now.name))) continue;
      edited = edited.map((comic) => comic.id === now.comicId ? { ...comic, socialMedia: social } : comic);
      continue;
    }
    if (now.comicId !== was.comicId || now.social === was.social) continue;
    edited = edited.map((comic) => comic.id === now.comicId
      ? { ...comic, socialMedia: now.social.trim() || undefined } : comic);
  }
  return edited;
}

/**
 * Refresh only already-linked profiles. Schedule links keep their show-slot
 * ids; labels that still use the previous name follow a rename. Walk-on rows
 * on the DJ list follow a new walk-on or a rename, as they do on the show
 * where the edit was made, or the other shows kept handing the DJ the old
 * song and lost track of the row after a rename. Custom cue labels and every
 * other show field remain unchanged. A host picked from the Rolodex is
 * refreshed the same way (see syncHostsWithRolodex).
 */
export function syncShowsWithRolodex(
  comics: PotentialComic[],
  shows: Show[],
  { clearedPhotos, renamedFrom }: RolodexSyncOptions = {},
): Show[] {
  const byId = new Map(comics.map((comic) => [comic.id, comic]));
  const before = renamedFrom && new Map(renamedFrom.map((comic) => [comic.id, comic]));
  let changed = false;
  const synced = shows.map((saved) => {
    const show = syncHostsWithRolodex(saved, byId, before);
    if (show !== saved) changed = true;
    let performersChanged = false;
    const renames = new Map<string, { before: string; after: string }>();
    const hydrate = <T extends Performer>(performer: T): T => {
      const comic = performer.comicId ? byId.get(performer.comicId) : undefined;
      if (!comic) return performer;
      const hydrated = hydratePerformer(performer, comic, clearedPhotos?.has(comic.id) ?? false);
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
    // An old saved show can have no DJ list at all.
    const ownSongs = show.djSongs ?? [];
    const djSongs = withWalkOnSongs(withWalkOnSongs(ownSongs, show.performers, performers), show.artists, artists);
    const djChanged = djSongs.length !== ownSongs.length || djSongs.some((song, i) => song !== ownSongs[i]);
    changed = true;
    return {
      ...show, performers, artists,
      ...(scheduleChanged ? { schedule } : {}),
      ...(djChanged ? { djSongs } : {}),
    };
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
 * empty values may be intentional clears, including after a page reload. The
 * headshot is the exception, for the reason given on RolodexSyncOptions — a
 * booked person's photo is the one copy left when the Rolodex's own was lost,
 * so it goes back on the entry rather than being wiped from the booking.
 */
export function reconcileRolodexProfiles(
  comics: PotentialComic[],
  shows: Show[],
  options: RolodexSyncOptions = {},
): { comics: PotentialComic[]; shows: Show[] } {
  // Before anyone is linked: a host an older writer renamed is free to be
  // linked to whoever they are now.
  const byId = new Map(comics.map((comic) => [comic.id, comic]));
  const renamedFrom = options.renamedFrom && new Map(options.renamedFrom.map((comic) => [comic.id, comic]));
  const released = shows.map((show) => releaseRetypedHosts(show, byId, renamedFrom));
  if (released.some((show, index) => show !== shows[index])) shows = released;
  const onSample = new Set(shows.flatMap((show) => (show.sample ? show.performers : [])));
  let reconciledComics = addPerformersToRolodex(comics, shows.flatMap((show) => show.performers), onSample) ?? comics;
  const backfills = new Map<string, PotentialComic>();
  for (const show of shows) {
    for (const performer of [...show.performers, ...show.artists]) {
      if (performer.comicId) {
        const linked = backfills.get(performer.comicId)
          ?? reconciledComics.find((comic) => comic.id === performer.comicId);
        if (linked && !linked.photo && performer.photo && !options.clearedPhotos?.has(linked.id)) {
          backfills.set(linked.id, { ...linked, photo: performer.photo });
        }
        continue;
      }
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
    // A host named the way one person on file is named is that person, and
    // from here their handle follows the entry. A handle of their own typed
    // beside the name is not filed from here, where every keystroke passes
    // (see claimHostEntry).
    const hosts: Partial<Show> = {};
    for (const slot of HOST_SLOTS) {
      const held = hostSlot(show, slot);
      if (held.comicId) continue;
      const matched = resolveHostComic(held.name, reconciledComics);
      if (!matched || !hostMatchesComic(held.social, matched)) continue;
      hosts[HOST_COMIC_FIELD[slot]] = matched.id;
      changed = true;
    }
    if (!changed) return show;
    linksChanged = true;
    return { ...show, performers, artists, ...hosts };
  });
  const finalShows = linksChanged ? linkedShows : shows;
  // Anyone now booked on a show of the producer's own is theirs.
  reconciledComics = clearSampleMarks(reconciledComics, finalShows);
  return {
    comics: reconciledComics,
    shows: syncShowsWithRolodex(reconciledComics, finalShows, options),
  };
}

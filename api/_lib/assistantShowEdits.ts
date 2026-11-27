// Assistant tools that change what is inside a show: duplicating it, the
// lineup and its surprise guests, the running order, the recap, staff and
// vendors.
//
// Each one makes the edit the app's own screen would make and then saves it
// the way the app saves an edit (ShowDetail.handleUpdate, then
// App.handleUpdateShow): walk-on rows on the DJ list follow the lineup, a
// booked person's profile edits go to their Rolodex entry and on to their
// other bookings, new names are filed in the Rolodex, and the recap's stored
// profit is brought into line. So a change made here reads, in the app, like
// one made on another device.
import type { Artist, Performer, PotentialComic, ScheduleItem, SectionKey, Show, ShowRecap, StaffMember, Vendor } from '../../src/types';
import { VENDOR_CATEGORIES } from '../../src/types';
import { matchKnownName, withCueEdit } from '../../src/utils/cuePerformer';
import { duplicateShow } from '../../src/utils/duplicateShow';
import { settleRecapProfit } from '../../src/utils/recapMoney';
import {
  comicToArtist, comicToPerformer, getComicProfilePatch, reassignSlot, reconcileRolodexProfiles,
  resolvePerformerComic, slotReassigned, syncShowsWithRolodex, type ComicProfile, type RolodexSyncOptions,
} from '../../src/utils/rolodex';
import { billedPerformers, isSurpriseGuest, moveWithinGroup } from '../../src/utils/surpriseGuests';
import { withoutRemovedWalkOns, withWalkOnSongs } from '../../src/utils/walkOnSongs';
import {
  amount, args, AssistantToolError, bool, confirmed, forEachShow, hasScope, httpsLink, integer, itemId, loadSettings, loadShowAt,
  requiredText, requireScope, saveSettings, saveShow, saveShows, text,
  type AssistantContext, type AssistantTool, type LoadedShow, type ShowChange, type ToolDefinition,
} from './assistantCore';
import { showDetail } from './assistantViews';
import { revisionSchema, validDate } from './chatgptShows';

// ── Shared pieces ───────────────────────────────────────────────────────────

const idSchema = { type: 'string', minLength: 1, maxLength: 128 };
const READ_FIRST = 'Read get_show first and pass its revision as expected_revision; a show changed since is refused, never overwritten. Ask the producer before changing anything they did not ask for.';
const ADDS = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
const CHANGES = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false };
// A move overwrites the order that was there, and a mark overwrites the one
// before it, so both count as destructive: only a purely additive write is
// not, however easily it is undone.
const REORDERS = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false };
const FLAGS = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false };
// Taking something off a show is refused, as delete_show is, until the
// producer has said yes and the call says so.
const REMOVES = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false };
const ASK_FIRST = 'Ask the producer first, naming exactly what goes, and pass confirm: true only once they have said yes; without it this is refused.';
const confirmSchema = { type: 'boolean', const: true, description: 'True only once the producer has confirmed this removal.' };

function define(name: string, title: string, description: string, properties: Record<string, unknown>, required: string[], annotations: ToolDefinition['annotations']): ToolDefinition {
  return { name, title, description, inputSchema: { type: 'object', additionalProperties: false, properties, required }, annotations };
}

/** Text the app stores trimmed, with an emptied field stored as nothing at all. */
function cleared(value: string | undefined): string | undefined {
  return value === undefined ? undefined : value.trim() || undefined;
}

/** A section the producer would have switched on in the app before adding to it. */
function showing(show: Show, section: SectionKey): Show {
  if (!show.hiddenSections?.includes(section)) return show;
  return { ...show, hiddenSections: show.hiddenSections.filter(key => key !== section) };
}

const profileLimits: Record<Exclude<keyof ComicProfile, 'photo' | 'walkOnMusic' | 'walkOnStartSec' | 'walkOnEndSec' | 'tapeMinutes'>, number> = {
  name: 200, socialMedia: 500, email: 320, phone: 50, notes: 5000, credits: 2000, videoLink: 2048,
  walkOnMusicName: 300, walkOnMusicArtist: 300, walkOnMusicLink: 2048, walkOnMusicTimestamp: 20,
};
type ProfileText = keyof typeof profileLimits;
export const PROFILE_TEXT_FIELDS = Object.keys(profileLimits) as ProfileText[];

/** The profile a booking shares with its Rolodex entry, as tool input. Uploads stay in the app. */
export const profileProperties: Record<ProfileText, Record<string, unknown>> = {
  name: { type: 'string', minLength: 1, maxLength: 200 },
  socialMedia: { type: 'string', maxLength: 500, description: 'Instagram handle or main social link.' },
  email: { type: 'string', maxLength: 320 },
  phone: { type: 'string', maxLength: 50 },
  notes: { type: 'string', maxLength: 5000, description: 'The producer’s private notes about this person.' },
  credits: { type: 'string', maxLength: 2000, description: 'Credits for the host to mention in their stage introduction.' },
  videoLink: { type: 'string', maxLength: 2048, description: 'HTTPS link to a video of them, or empty.' },
  walkOnMusicName: { type: 'string', maxLength: 300, description: 'Walk-on song title.' },
  walkOnMusicArtist: { type: 'string', maxLength: 300 },
  walkOnMusicLink: { type: 'string', maxLength: 2048, description: 'HTTPS YouTube or Spotify link for the walk-on, or empty.' },
  walkOnMusicTimestamp: { type: 'string', maxLength: 20, description: 'Where the walk-on starts, e.g. 1:05.' },
};

/**
 * Profile edits as the app's profile drawer saves them: trimmed, an emptied
 * field cleared, and a name that cannot be emptied.
 */
export function profilePatch(input: Record<string, unknown>, fields: readonly ProfileText[]): Partial<ComicProfile> {
  const patch: Partial<ComicProfile> = {};
  for (const field of fields) {
    if (input[field] === undefined) continue;
    if (field === 'name') { patch.name = requiredText(input.name, 'name', profileLimits.name); continue; }
    const value = field === 'videoLink' || field === 'walkOnMusicLink'
      ? httpsLink(input[field], field === 'videoLink' ? 'video link' : 'walk-on link')
      : text(input[field], field, profileLimits[field]);
    patch[field] = cleared(value);
  }
  return patch;
}

function result(show: Show, revision: string, notes: string[] = []) {
  return { show: showDetail(show), revision, ...(notes.length ? { notes } : {}) };
}

/**
 * Bring every other booking of the Rolodex's people into line with it, as the
 * app does whenever the Rolodex is saved. The entry is already saved by now,
 * and the app does the same on its next load, so a booking changed meanwhile
 * on another device is left for that rather than overwritten.
 */
export async function syncBookings(ctx: AssistantContext, comics: PotentialComic[], options: RolodexSyncOptions = {}, skip?: string): Promise<string[]> {
  const changes: ShowChange[] = [];
  await forEachShow(ctx, ({ show, revision }) => {
    if (show.id === skip) return;
    const [synced] = syncShowsWithRolodex(comics, [show], options);
    if (synced !== show) changes.push({ id: show.id, expectedHash: revision, show: synced });
  });
  if (!changes.length) return [];
  try {
    await saveShows(ctx, changes);
    return [`Updated ${changes.length} more show${changes.length === 1 ? '' : 's'} where this person is booked to match.`];
  } catch (err) {
    if (!(err instanceof AssistantToolError)) throw err;
    return ['Their other bookings will catch up the next time the app opens.'];
  }
}

/** Save an edit that leaves the lineup alone. */
async function commit(ctx: AssistantContext, loaded: LoadedShow, edited: Show) {
  // A vendor's cost is part of the recap's bottom line, so either edit
  // brings the stored figure up to date.
  const updated = settleRecapProfit({ ...edited, updatedAt: new Date().toISOString() });
  return result(updated, await saveShow(ctx, updated, loaded.revision));
}

/**
 * The audience's viewer link is published by the app, from the show's page,
 * and never from here, so a lineup changed here reaches it only once the
 * producer next has the show open. Most of all, a performer just made a
 * surprise is still on it until then.
 */
function viewerNotes(before: Show, after: Show): string[] {
  if (!after.viewToken) return [];
  const bill = (show: Show) => billedPerformers(show.performers ?? []).map(person => `${person.name}\n${person.credits ?? ''}`);
  const was = bill(before);
  const now = bill(after);
  if (was.length === now.length && was.every((entry, i) => entry === now[i])) return [];
  const hidden = billedPerformers(before.performers ?? [])
    .filter(person => (after.performers ?? []).some(other => other.id === person.id && isSurpriseGuest(other)))
    .map(person => person.name);
  return [hidden.length
    ? `This show’s viewer link still lists ${hidden.join(' and ')} until the producer next opens the show in the app, which updates it. Tell them to open it now to keep the surprise.`
    : 'This show’s viewer link shows the lineup as it was until the producer next opens the show in the app, which updates it.'];
}

/** Save an edit to the performers or artists, with everything the app does after one. */
async function commitLineup(ctx: AssistantContext, loaded: LoadedShow, edited: Show) {
  const before = loaded.show;
  const people = (show: Show) => [...(show.performers ?? []), ...(show.artists ?? [])];
  // ShowDetail.handleUpdate: each act's walk-on row on the DJ list follows
  // their song and their name, and goes when they leave the show.
  const withSongs: Show = {
    ...edited,
    djSongs: withoutRemovedWalkOns(
      withWalkOnSongs(withWalkOnSongs(edited.djSongs ?? [], before.performers ?? [], edited.performers), before.artists ?? [], edited.artists),
      people(before),
      people(edited),
    ),
  };

  // App.handleUpdateShow: a booked person's changed profile fields go to their
  // Rolodex entry. The show's date, order, cues and roles stay on the show.
  const settings = await loadSettings(ctx);
  const original = settings.settings?.potentialComics ?? [];
  let comics = original;
  const clearedPhotos = new Set<string>();
  const profileEdits: string[] = [];
  const was = new Map(people(before).map(person => [person.id, person]));
  for (const person of people(withSongs)) {
    const old = was.get(person.id);
    if (!old) continue;
    const comic = resolvePerformerComic(old, comics);
    if (!comic) continue;
    if (old.comicId && !person.comicId && slotReassigned(old, person)) continue;
    const patch = getComicProfilePatch(old, person);
    if (Object.hasOwn(patch, 'photo') && patch.photo === undefined) clearedPhotos.add(comic.id);
    if (Object.keys(patch).length) {
      comics = comics.map(c => c.id === comic.id ? { ...c, ...patch } : c);
      profileEdits.push(comic.name);
    }
  }
  const updated = settleRecapProfit({ ...withSongs, updatedAt: new Date().toISOString() });
  const shared = reconcileRolodexProfiles(comics, [updated], { clearedPhotos });
  const target = shared.shows[0];
  // Linking a name to its Rolodex entry fills the booking in from it, which
  // is reading the Rolodex: a connection that may not leaves it to the app.
  const mayRead = hasScope(ctx.grant, 'rolodex:read');
  if (shared.comics === original && mayRead) return result(target, await saveShow(ctx, target, loaded.revision), viewerNotes(before, target));

  if (!settings.settings || !mayRead || !hasScope(ctx.grant, 'rolodex:write')) {
    // Saved only on the show, the app's next load would put the Rolodex's
    // copy back over it.
    if (profileEdits.length) {
      const missing = (['rolodex:read', 'rolodex:write'] as const).filter(scope => !hasScope(ctx.grant, scope));
      throw new AssistantToolError(`That changes ${profileEdits.join(' and ')}’s Rolodex profile, which all their bookings share. This connection needs ${missing.join(' and ') || 'rolodex:write'} permission for that.`);
    }
    // Filing a new name in the Rolodex, or filling a gap in an entry from this
    // booking, is what the app does with this show on its next load.
    return result(updated, await saveShow(ctx, updated, loaded.revision), viewerNotes(before, updated));
  }

  // The Rolodex first: once it holds the change, the app brings every booking
  // into line with it on its next load, even if a write below is refused.
  await saveSettings(ctx, settings, { ...settings.settings, potentialComics: shared.comics });
  const revision = await saveShow(ctx, target, loaded.revision);
  const notes = profileEdits.length ? await syncBookings(ctx, shared.comics, { clearedPhotos }, target.id) : [];
  return result(target, revision, [...viewerNotes(before, target), ...notes]);
}

type Booking = { list: 'performers' | 'artists'; person: Performer | Artist };

function findBooking(show: Show, id: string): Booking {
  const performer = (show.performers ?? []).find(person => person.id === id);
  if (performer) return { list: 'performers', person: performer };
  const artist = (show.artists ?? []).find(person => person.id === id);
  if (artist) return { list: 'artists', person: artist };
  throw new AssistantToolError('That performer is not on this show. Read get_show for their id.');
}

function replaceBooking(show: Show, booking: Booking, next: Performer | Artist | null): Show {
  const list = (show[booking.list] ?? []) as (Performer | Artist)[];
  const people = next === null
    ? list.filter(person => person.id !== booking.person.id)
    : list.map(person => person.id === booking.person.id ? next : person);
  return { ...show, [booking.list]: people };
}

function direction(value: unknown): -1 | 1 {
  if (value === 'up') return -1;
  if (value === 'down') return 1;
  throw new AssistantToolError('Direction must be up or down.');
}

/**
 * What the app looks for in a cue's text to fill in who is on stage. The
 * Rolodex's names only for a connection that may read it: a name filled in
 * from it says who is there.
 */
async function knownNames(ctx: AssistantContext, show: Show): Promise<string[]> {
  let comics: PotentialComic[] = [];
  if (hasScope(ctx.grant, 'rolodex:read')) {
    try { comics = (await loadSettings(ctx)).settings?.potentialComics ?? []; } catch { /* the show's own names still match */ }
  }
  return [
    ...(show.host ? [show.host] : []),
    ...(show.coHost ? [show.coHost] : []),
    ...(show.performers ?? []).map(p => p.name),
    ...(show.artists ?? []).map(a => a.name),
    ...comics.map(c => c.name),
  ].filter(name => name?.trim());
}

// ── Duplicate ───────────────────────────────────────────────────────────────

const duplicate: AssistantTool = {
  scope: 'shows:write',
  definition: define('duplicate_show', 'Duplicate a show',
    'Make a new show from an existing one, the way the app’s Duplicate does: the setup, running order structure, staff and vendors carry over, while the lineup, recap, viewer link and per-night progress do not. Name defaults to "<name> (copy)" and the date to empty. ' + READ_FIRST,
    { id: idSchema, expected_revision: revisionSchema, name: { type: 'string', maxLength: 200 }, date: { type: 'string', maxLength: 10, description: 'YYYY-MM-DD for the new night, or empty.' } },
    ['id', 'expected_revision'], ADDS),
  async run(ctx, input) {
    const a = args(input, ['id', 'expected_revision', 'name', 'date']);
    const name = a.name === undefined ? undefined : requiredText(a.name, 'name', 200);
    const date = text(a.date, 'date', 10);
    if (date !== undefined && !validDate(date)) throw new AssistantToolError('Date must be a real YYYY-MM-DD date or empty.');
    const loaded = await loadShowAt(ctx, a.id, a.expected_revision);
    const copy = duplicateShow(loaded.show, { name, date });
    return result(copy, await saveShow(ctx, copy, null));
  },
};

// ── Lineup ──────────────────────────────────────────────────────────────────

const addPerformer: AssistantTool = {
  scope: 'shows:write',
  definition: define('add_performer', 'Add a performer or artist',
    'Book someone onto a show’s lineup (role "performer", the default) or its artists (role "artist"). Give comic_id to book someone from the Rolodex with their whole profile (needs rolodex:read), or name for someone new, who is filed in the Rolodex as the app files new names. surprise_guest books a performer as a surprise guest, kept off everything the public sees. Returns the new booking’s id. ' + READ_FIRST,
    {
      show_id: idSchema, expected_revision: revisionSchema,
      role: { type: 'string', enum: ['performer', 'artist'], default: 'performer' },
      comic_id: idSchema,
      name: { type: 'string', minLength: 1, maxLength: 200 },
      socialMedia: profileProperties.socialMedia,
      email: profileProperties.email,
      artistType: { type: 'string', maxLength: 100, description: 'For artists: their role, e.g. Singer or DJ.' },
      surprise_guest: { type: 'boolean', description: 'Performers only.' },
    },
    ['show_id', 'expected_revision'], ADDS),
  async run(ctx, input) {
    const a = args(input, ['show_id', 'expected_revision', 'role', 'comic_id', 'name', 'socialMedia', 'email', 'artistType', 'surprise_guest']);
    const role = a.role ?? 'performer';
    if (role !== 'performer' && role !== 'artist') throw new AssistantToolError('Role must be performer or artist.');
    if ((a.comic_id === undefined) === (a.name === undefined)) throw new AssistantToolError('Give either comic_id or name.');
    const guest = bool(a.surprise_guest, 'surprise_guest');
    if (guest && role === 'artist') throw new AssistantToolError('Only performers can be surprise guests.');
    const artistType = cleared(text(a.artistType, 'artistType', 100));
    if (artistType && role !== 'artist') throw new AssistantToolError('artistType is for artists.');
    let booked: Performer;
    if (a.comic_id !== undefined) {
      if (a.socialMedia !== undefined || a.email !== undefined) throw new AssistantToolError('A Rolodex booking takes its details from the Rolodex; edit them with update_comic.');
      requireScope(ctx.grant, 'rolodex:read');
      const comicId = itemId(a.comic_id, 'Rolodex');
      const comic = (await loadSettings(ctx)).settings?.potentialComics?.find(c => c.id === comicId);
      if (!comic) throw new AssistantToolError('That person is not in the Rolodex. Use list_rolodex for their id.');
      booked = role === 'artist' ? comicToArtist(comic) : comicToPerformer(comic);
    } else {
      // The app's add forms: a name, and for performers their social and email.
      if (role === 'artist' && (a.socialMedia !== undefined || a.email !== undefined)) throw new AssistantToolError('Add an artist by name, then update_performer for their details.');
      const details = profilePatch(a, role === 'performer' ? ['name', 'socialMedia', 'email'] : ['name']);
      booked = { id: crypto.randomUUID(), name: details.name!, ...(details.socialMedia ? { socialMedia: details.socialMedia } : {}), ...(details.email ? { email: details.email } : {}) };
    }
    if (guest) booked = { ...booked, surpriseGuest: true };
    if (artistType) booked = { ...booked, artistType } as Artist;
    const loaded = await loadShowAt(ctx, a.show_id, a.expected_revision);
    const list = role === 'artist' ? 'artists' : 'performers';
    const edited = showing({ ...loaded.show, [list]: [...(loaded.show[list] ?? []), booked] }, list);
    return { ...await commitLineup(ctx, loaded, edited), bookingId: booked.id };
  },
};

const updatePerformer: AssistantTool = {
  scope: 'shows:write',
  definition: define('update_performer', 'Update a performer or artist',
    'Change a booked performer’s or artist’s details. Their profile (name, contacts, notes, credits, walk-on) is shared with their Rolodex entry and every other booking of them, as in the app, so changing it for someone in the Rolodex also needs rolodex:write. Typing a different name over someone from the Rolodex is refused until the producer says, as the app asks them, whether it is the same person under a new name (same_person: true renames their entry and keeps their details) or a different act (same_person: false books this spot fresh and leaves the old entry alone). An empty string clears a field. surpriseGuest is for performers, artistType for artists. ' + READ_FIRST,
    {
      show_id: idSchema, expected_revision: revisionSchema, performer_id: idSchema,
      patch: {
        type: 'object', additionalProperties: false, minProperties: 1,
        properties: { ...profileProperties, artistType: { type: 'string', maxLength: 100 }, surpriseGuest: { type: 'boolean' } },
      },
      same_person: { type: 'boolean', description: 'Only for a new name on someone from the Rolodex: the producer’s answer to “same person, or someone else?”.' },
    },
    ['show_id', 'expected_revision', 'performer_id', 'patch'], CHANGES),
  async run(ctx, input) {
    const a = args(input, ['show_id', 'expected_revision', 'performer_id', 'patch', 'same_person']);
    const id = itemId(a.performer_id, 'performer');
    const patchInput = args(a.patch, [...PROFILE_TEXT_FIELDS, 'artistType', 'surpriseGuest']);
    if (Object.keys(patchInput).length === 0) throw new AssistantToolError('At least one detail is required.');
    const changes: Partial<Artist> = profilePatch(patchInput, PROFILE_TEXT_FIELDS);
    const artistType = text(patchInput.artistType, 'artistType', 100);
    const guest = bool(patchInput.surpriseGuest, 'surpriseGuest');
    const samePerson = bool(a.same_person, 'same_person');
    const loaded = await loadShowAt(ctx, a.show_id, a.expected_revision);
    const booking = findBooking(loaded.show, id);
    if (artistType !== undefined) {
      if (booking.list !== 'artists') throw new AssistantToolError('artistType is for artists.');
      changes.artistType = cleared(artistType);
    }
    if (guest !== undefined) {
      if (booking.list !== 'performers') throw new AssistantToolError('Only performers can be surprise guests.');
      changes.surpriseGuest = guest || undefined;
    }
    let next: Performer | Artist = { ...booking.person, ...changes };
    // PerformerProfile.saveProfile: a different name typed over a booked act
    // is either a rename or a different act, and only the producer knows
    // which. Taken as a rename, the new act wore the old one's headshot and
    // the old one's Rolodex entry took the new name.
    if (booking.person.comicId && changes.name && slotReassigned(booking.person, { name: changes.name })) {
      if (samePerson === undefined) {
        throw new AssistantToolError(`That changes the name from ${booking.person.name} to ${changes.name}. Ask the producer: is it the same person under a new name (their Rolodex entry is renamed and keeps its details), or a different act (this spot is booked fresh, and ${booking.person.name} stays in the Rolodex as they are)? Then call again with same_person true or false.`);
      }
      if (!samePerson) next = reassignSlot(next, booking.person);
    }
    return commitLineup(ctx, loaded, replaceBooking(loaded.show, booking, next));
  },
};

const removePerformer: AssistantTool = {
  scope: 'shows:write',
  definition: define('remove_performer', 'Remove a performer or artist',
    'Take someone off this show’s lineup or artists. Their Rolodex entry and other bookings are untouched; their walk-on row leaves the DJ list unless audio was put on it. ' + ASK_FIRST + ' ' + READ_FIRST,
    { show_id: idSchema, expected_revision: revisionSchema, performer_id: idSchema, confirm: confirmSchema },
    ['show_id', 'expected_revision', 'performer_id', 'confirm'], REMOVES),
  async run(ctx, input) {
    const a = args(input, ['show_id', 'expected_revision', 'performer_id', 'confirm']);
    confirmed(a.confirm);
    const id = itemId(a.performer_id, 'performer');
    const loaded = await loadShowAt(ctx, a.show_id, a.expected_revision);
    return commitLineup(ctx, loaded, replaceBooking(loaded.show, findBooking(loaded.show, id), null));
  },
};

const movePerformer: AssistantTool = {
  scope: 'shows:write',
  definition: define('move_performer', 'Move a performer or artist',
    'Move someone up or down the bill, which is the order the viewer link shows. As in the app, a performer moves among the performers on their own tab (surprise guests among surprise guests), and an artist among the artists. steps repeats the move. ' + READ_FIRST,
    { show_id: idSchema, expected_revision: revisionSchema, performer_id: idSchema, direction: { type: 'string', enum: ['up', 'down'] }, steps: { type: 'integer', minimum: 1, maximum: 100, default: 1 } },
    ['show_id', 'expected_revision', 'performer_id', 'direction'], REORDERS),
  async run(ctx, input) {
    const a = args(input, ['show_id', 'expected_revision', 'performer_id', 'direction', 'steps']);
    const id = itemId(a.performer_id, 'performer');
    const dir = direction(a.direction);
    const steps = integer(a.steps, 'steps', 1, 100) ?? 1;
    const loaded = await loadShowAt(ctx, a.show_id, a.expected_revision);
    const booking = findBooking(loaded.show, id);
    let people = [...(loaded.show[booking.list] ?? [])] as Performer[];
    for (let step = 0; step < steps; step++) {
      if (booking.list === 'performers') {
        people = moveWithinGroup(people, id, dir);
      } else {
        const index = people.findIndex(person => person.id === id);
        const target = index + dir;
        if (target < 0 || target >= people.length) break;
        people = [...people];
        [people[index], people[target]] = [people[target], people[index]];
      }
    }
    const before = loaded.show[booking.list] ?? [];
    if (people.every((person, i) => person === before[i])) return result(loaded.show, loaded.revision);
    return commitLineup(ctx, loaded, { ...loaded.show, [booking.list]: people });
  },
};

const setSurpriseGuest: AssistantTool = {
  scope: 'shows:write',
  definition: define('set_surprise_guest', 'Mark a surprise guest',
    'Mark a booked performer as a surprise guest (kept off the posted bill, the viewer link and anything public until they walk on) or back to a billed performer. The mark is on this booking only, never their Rolodex entry. A viewer link already made catches up only when the producer next opens the show in the app; pass on any note saying so. ' + READ_FIRST,
    { show_id: idSchema, expected_revision: revisionSchema, performer_id: idSchema, surprise_guest: { type: 'boolean' } },
    ['show_id', 'expected_revision', 'performer_id', 'surprise_guest'], FLAGS),
  async run(ctx, input) {
    const a = args(input, ['show_id', 'expected_revision', 'performer_id', 'surprise_guest']);
    const id = itemId(a.performer_id, 'performer');
    const guest = bool(a.surprise_guest, 'surprise_guest');
    if (guest === undefined) throw new AssistantToolError('surprise_guest is required.');
    const loaded = await loadShowAt(ctx, a.show_id, a.expected_revision);
    const booking = findBooking(loaded.show, id);
    if (booking.list !== 'performers') throw new AssistantToolError('Only performers can be surprise guests.');
    if (isSurpriseGuest(booking.person) === guest) return result(loaded.show, loaded.revision);
    return commitLineup(ctx, loaded, replaceBooking(loaded.show, booking, { ...booking.person, surpriseGuest: guest || undefined }));
  },
};

// ── Running order ───────────────────────────────────────────────────────────

const cueFields = {
  time: { type: 'string', maxLength: 20, description: 'When it happens, as the producer writes it (e.g. 20:15).' },
  description: { type: 'string', minLength: 1, maxLength: 500, description: 'What happens.' },
  performer: { type: 'string', maxLength: 200, description: 'Who is on stage, as free text for anyone not on the bill (the cue stops being linked to anyone on it), or empty.' },
  performer_id: { type: 'string', maxLength: 128, description: 'Put someone on the bill on stage for this cue (their name and walk-on go with it), or empty to unlink. Use performer instead for anyone not on the bill.' },
  durationMin: { type: ['integer', 'null'], minimum: 0, maximum: 600, description: 'Minutes; 0 or null clears it.' },
};

function findCue(show: Show, id: string): number {
  const index = (show.schedule ?? []).findIndex(item => item.id === id);
  if (index < 0) throw new AssistantToolError('That cue is not in this show’s running order. Read get_show for its id.');
  return index;
}

/** The cue fields given, as the app's cue editor saves them. */
function cuePatch(show: Show, input: Record<string, unknown>): Partial<ScheduleItem> {
  const patch: Partial<ScheduleItem> = {};
  const time = text(input.time, 'time', 20);
  if (time !== undefined) patch.time = time.trim();
  if (input.description !== undefined) patch.description = requiredText(input.description, 'description', 500);
  const performer = text(input.performer, 'performer', 200);
  // OnStagePicker: a name typed in is someone off the bill, so the cue lets
  // go of whoever it was linked to, or Run Show would still play their walk-on.
  if (performer !== undefined) {
    patch.performer = performer.trim() || undefined;
    patch.performerId = undefined;
  }
  if (input.performer_id !== undefined) {
    if (input.performer_id === '') {
      patch.performerId = undefined;
    } else {
      // OnStagePicker: picking someone on the bill puts their name on the cue.
      if (performer !== undefined) throw new AssistantToolError('Give performer_id for someone on the bill, or performer for anyone else, not both.');
      const id = itemId(input.performer_id, 'performer');
      const person = [...(show.performers ?? []), ...(show.artists ?? [])].find(p => p.id === id);
      if (!person) throw new AssistantToolError('That performer is not on this show. Read get_show for their id.');
      patch.performerId = id;
      patch.performer = person.name;
    }
  }
  if (input.durationMin !== undefined) {
    const minutes = input.durationMin === null ? 0 : integer(input.durationMin, 'durationMin', 0, 600)!;
    patch.durationMin = minutes > 0 ? minutes : undefined;
  }
  return patch;
}

function moveItem<T>(items: T[], from: number, dir: -1 | 1, steps: number): T[] {
  const next = [...items];
  let index = from;
  for (let step = 0; step < steps; step++) {
    const target = index + dir;
    if (target < 0 || target >= next.length) break;
    [next[index], next[target]] = [next[target], next[index]];
    index = target;
  }
  return next;
}

const addCue: AssistantTool = {
  scope: 'shows:write',
  definition: define('add_cue', 'Add a running-order cue',
    'Add a cue to a show’s running order, at the end unless position (0 = first) is given. A description that names someone the app knows fills in who is on stage, as typing it in the app does. ' + READ_FIRST,
    { show_id: idSchema, expected_revision: revisionSchema, ...cueFields, position: { type: 'integer', minimum: 0, maximum: 1000 } },
    ['show_id', 'expected_revision', 'description'], ADDS),
  async run(ctx, input) {
    const a = args(input, ['show_id', 'expected_revision', 'time', 'description', 'performer', 'performer_id', 'durationMin', 'position']);
    // Every cue has its text; the schema saying so is not enough.
    requiredText(a.description, 'description', 500);
    const position = integer(a.position, 'position', 0, 1000);
    const loaded = await loadShowAt(ctx, a.show_id, a.expected_revision);
    const show = loaded.show;
    const patch = cuePatch(show, a);
    const cue: ScheduleItem = { id: crypto.randomUUID(), time: patch.time ?? '', description: patch.description!, ...patch };
    if (!cue.performer) {
      const named = matchKnownName(cue.description, await knownNames(ctx, show));
      if (named) cue.performer = named;
    }
    const schedule = [...(show.schedule ?? [])];
    schedule.splice(position === undefined ? schedule.length : Math.min(position, schedule.length), 0, cue);
    return { ...await commit(ctx, loaded, showing({ ...show, schedule }, 'schedule')), cueId: cue.id };
  },
};

const updateCue: AssistantTool = {
  scope: 'shows:write',
  definition: define('update_cue', 'Update a running-order cue',
    'Change a cue’s time, description, who is on stage, or length. ' + READ_FIRST,
    { show_id: idSchema, expected_revision: revisionSchema, cue_id: idSchema, patch: { type: 'object', additionalProperties: false, minProperties: 1, properties: cueFields } },
    ['show_id', 'expected_revision', 'cue_id', 'patch'], CHANGES),
  async run(ctx, input) {
    const a = args(input, ['show_id', 'expected_revision', 'cue_id', 'patch']);
    const id = itemId(a.cue_id, 'cue');
    const fields = args(a.patch, Object.keys(cueFields));
    if (Object.keys(fields).length === 0) throw new AssistantToolError('At least one cue detail is required.');
    const loaded = await loadShowAt(ctx, a.show_id, a.expected_revision);
    const show = loaded.show;
    const index = findCue(show, id);
    const names = await knownNames(ctx, show);
    const schedule = show.schedule.map((item, i) => i === index ? withCueEdit(item, cuePatch(show, fields), names) : item);
    return commit(ctx, loaded, { ...show, schedule });
  },
};

const removeCue: AssistantTool = {
  scope: 'shows:write',
  definition: define('remove_cue', 'Remove a running-order cue',
    'Delete one cue from a show’s running order. ' + ASK_FIRST + ' ' + READ_FIRST,
    { show_id: idSchema, expected_revision: revisionSchema, cue_id: idSchema, confirm: confirmSchema },
    ['show_id', 'expected_revision', 'cue_id', 'confirm'], REMOVES),
  async run(ctx, input) {
    const a = args(input, ['show_id', 'expected_revision', 'cue_id', 'confirm']);
    confirmed(a.confirm);
    const id = itemId(a.cue_id, 'cue');
    const loaded = await loadShowAt(ctx, a.show_id, a.expected_revision);
    findCue(loaded.show, id);
    return commit(ctx, loaded, { ...loaded.show, schedule: loaded.show.schedule.filter(item => item.id !== id) });
  },
};

const moveCue: AssistantTool = {
  scope: 'shows:write',
  definition: define('move_cue', 'Move a running-order cue',
    'Move a cue up or down the running order; steps repeats the move. Times are not changed. ' + READ_FIRST,
    { show_id: idSchema, expected_revision: revisionSchema, cue_id: idSchema, direction: { type: 'string', enum: ['up', 'down'] }, steps: { type: 'integer', minimum: 1, maximum: 1000, default: 1 } },
    ['show_id', 'expected_revision', 'cue_id', 'direction'], REORDERS),
  async run(ctx, input) {
    const a = args(input, ['show_id', 'expected_revision', 'cue_id', 'direction', 'steps']);
    const id = itemId(a.cue_id, 'cue');
    const dir = direction(a.direction);
    const steps = integer(a.steps, 'steps', 1, 1000) ?? 1;
    const loaded = await loadShowAt(ctx, a.show_id, a.expected_revision);
    const index = findCue(loaded.show, id);
    const schedule = moveItem(loaded.show.schedule, index, dir, steps);
    if (schedule.every((item, i) => item === loaded.show.schedule[i])) return result(loaded.show, loaded.revision);
    return commit(ctx, loaded, { ...loaded.show, schedule });
  },
};

// ── Recap ───────────────────────────────────────────────────────────────────

const money = (description: string) => ({ type: ['number', 'null'], minimum: 0, description });

const updateRecap: AssistantTool = {
  scope: 'shows:write',
  definition: define('update_recap', 'Update the show recap',
    'Record how a night went: attendance, ticket and merch sales, other costs (door split, performer pay; vendors are counted from the Vendors section) and notes. Zero or null clears a figure, as in the app. Returns the recap with revenue, costs and profit or loss worked out. ' + READ_FIRST,
    {
      show_id: idSchema, expected_revision: revisionSchema,
      patch: {
        type: 'object', additionalProperties: false, minProperties: 1,
        properties: {
          attendance: { type: ['integer', 'null'], minimum: 0 },
          ticketSales: money('What the door took.'),
          merchSales: money('Merch sales.'),
          otherCosts: money('Costs beyond vendors.'),
          performerNotes: { type: 'string', maxLength: 20000 },
          improvementNotes: { type: 'string', maxLength: 20000 },
        },
      },
    },
    ['show_id', 'expected_revision', 'patch'], CHANGES),
  async run(ctx, input) {
    const a = args(input, ['show_id', 'expected_revision', 'patch']);
    const fields = args(a.patch, ['attendance', 'ticketSales', 'merchSales', 'otherCosts', 'performerNotes', 'improvementNotes']);
    if (Object.keys(fields).length === 0) throw new AssistantToolError('At least one recap detail is required.');
    const patch: ShowRecap = {};
    for (const key of ['attendance', 'ticketSales', 'merchSales', 'otherCosts'] as const) {
      if (fields[key] === undefined) continue;
      const value = fields[key] === null ? 0 : key === 'attendance' ? integer(fields[key], key, 0, 10_000_000)! : amount(fields[key], key)!;
      // The recap page stores a zero as no figure at all.
      patch[key] = value || undefined;
    }
    for (const key of ['performerNotes', 'improvementNotes'] as const) {
      const value = text(fields[key], key, 20000);
      if (value !== undefined) patch[key] = value.trim() ? value : undefined;
    }
    const loaded = await loadShowAt(ctx, a.show_id, a.expected_revision);
    return commit(ctx, loaded, showing({ ...loaded.show, recap: { ...loaded.show.recap, ...patch } }, 'recap'));
  },
};

// ── Staff and vendors ───────────────────────────────────────────────────────

const staffFields = {
  role: { type: 'string', minLength: 1, maxLength: 100, description: 'e.g. Sound, Lighting, Door Person, Stage Manager.' },
  personName: { type: 'string', minLength: 1, maxLength: 200 },
  phone: { type: 'string', maxLength: 50 },
};

function staffPatch(input: Record<string, unknown>): Partial<StaffMember> {
  const patch: Partial<StaffMember> = {};
  if (input.role !== undefined) patch.role = requiredText(input.role, 'role', 100);
  if (input.personName !== undefined) patch.personName = requiredText(input.personName, 'personName', 200);
  if (input.phone !== undefined) patch.phone = cleared(text(input.phone, 'phone', 50));
  return patch;
}

const vendorFields = {
  name: { type: 'string', minLength: 1, maxLength: 200 },
  category: { type: 'string', enum: VENDOR_CATEGORIES },
  contactName: { type: 'string', maxLength: 200 },
  phone: { type: 'string', maxLength: 50 },
  email: { type: 'string', maxLength: 320 },
  website: { type: 'string', maxLength: 2048, description: 'HTTPS link, or empty.' },
  cost: { type: ['number', 'null'], minimum: 0, description: 'Counted in the recap’s costs; null clears it.' },
  notes: { type: 'string', maxLength: 5000 },
  booked: { type: 'boolean' },
};

function vendorPatch(input: Record<string, unknown>): Partial<Vendor> {
  const patch: Partial<Vendor> = {};
  if (input.name !== undefined) patch.name = requiredText(input.name, 'name', 200);
  if (input.category !== undefined) {
    if (typeof input.category !== 'string' || !VENDOR_CATEGORIES.includes(input.category)) throw new AssistantToolError(`Category must be one of: ${VENDOR_CATEGORIES.join(', ')}.`);
    patch.category = input.category;
  }
  for (const [key, max] of [['contactName', 200], ['phone', 50], ['email', 320], ['notes', 5000]] as const) {
    if (input[key] !== undefined) patch[key] = cleared(text(input[key], key, max));
  }
  if (input.website !== undefined) patch.website = cleared(httpsLink(input.website, 'website'));
  if (input.cost !== undefined) patch.cost = input.cost === null ? undefined : amount(input.cost, 'cost');
  const booked = bool(input.booked, 'booked');
  if (booked !== undefined) patch.booked = booked;
  return patch;
}

type ListKey = 'staff' | 'vendors';

function listTools<T extends { id: string }>(options: {
  key: ListKey; noun: string; title: string; fields: Record<string, unknown>; required: string[];
  addDescription: string; create(patch: Partial<T>): T; parse(input: Record<string, unknown>): Partial<T>;
}): AssistantTool[] {
  const { key, noun, title, fields } = options;
  const idArg = `${noun}_id`;
  const find = (show: Show, id: string) => {
    const index = ((show[key] ?? []) as unknown as T[]).findIndex(item => item.id === id);
    if (index < 0) throw new AssistantToolError(`That ${noun} is not on this show. Read get_show for the id.`);
    return index;
  };
  return [
    {
      scope: 'shows:write',
      definition: define(`add_${noun}`, `Add ${title}`, `${options.addDescription} ${READ_FIRST}`,
        { show_id: idSchema, expected_revision: revisionSchema, ...fields }, ['show_id', 'expected_revision', ...options.required], ADDS),
      async run(ctx, input) {
        const a = args(input, ['show_id', 'expected_revision', ...Object.keys(fields)]);
        // The app's add forms will not save without these.
        const missing = options.required.find(field => a[field] === undefined);
        if (missing) throw new AssistantToolError(`${missing[0].toUpperCase()}${missing.slice(1)} is required.`);
        const item = options.create(options.parse(a));
        const loaded = await loadShowAt(ctx, a.show_id, a.expected_revision);
        const list = [...((loaded.show[key] ?? []) as unknown as T[]), item];
        return { ...await commit(ctx, loaded, showing({ ...loaded.show, [key]: list }, key)), [`${noun}Id`]: item.id };
      },
    },
    {
      scope: 'shows:write',
      definition: define(`update_${noun}`, `Update ${title}`, `Change a ${noun}’s details on a show. An empty string clears an optional field. ${READ_FIRST}`,
        { show_id: idSchema, expected_revision: revisionSchema, [idArg]: idSchema, patch: { type: 'object', additionalProperties: false, minProperties: 1, properties: fields } },
        ['show_id', 'expected_revision', idArg, 'patch'], CHANGES),
      async run(ctx, input) {
        const a = args(input, ['show_id', 'expected_revision', idArg, 'patch']);
        const id = itemId(a[idArg], noun);
        const fieldsGiven = args(a.patch, Object.keys(fields));
        if (Object.keys(fieldsGiven).length === 0) throw new AssistantToolError(`At least one ${noun} detail is required.`);
        const patch = options.parse(fieldsGiven);
        const loaded = await loadShowAt(ctx, a.show_id, a.expected_revision);
        const index = find(loaded.show, id);
        const list = ((loaded.show[key] ?? []) as unknown as T[]).map((item, i) => i === index ? { ...item, ...patch } : item);
        return commit(ctx, loaded, { ...loaded.show, [key]: list });
      },
    },
    {
      scope: 'shows:write',
      definition: define(`remove_${noun}`, `Remove ${title}`, `Remove a ${noun} from a show. ${ASK_FIRST} ${READ_FIRST}`,
        { show_id: idSchema, expected_revision: revisionSchema, [idArg]: idSchema, confirm: confirmSchema }, ['show_id', 'expected_revision', idArg, 'confirm'], REMOVES),
      async run(ctx, input) {
        const a = args(input, ['show_id', 'expected_revision', idArg, 'confirm']);
        confirmed(a.confirm);
        const id = itemId(a[idArg], noun);
        const loaded = await loadShowAt(ctx, a.show_id, a.expected_revision);
        find(loaded.show, id);
        const list = ((loaded.show[key] ?? []) as unknown as T[]).filter(item => item.id !== id);
        return commit(ctx, loaded, { ...loaded.show, [key]: list });
      },
    },
  ];
}

const staffTools = listTools<StaffMember>({
  key: 'staff', noun: 'staff', title: 'a staff member', fields: staffFields, required: ['role', 'personName'],
  addDescription: 'Add a crew member (sound, lights, door, photographer…) to a show’s staff.',
  parse: staffPatch,
  create: patch => ({ id: crypto.randomUUID(), role: patch.role!, personName: patch.personName!, ...(patch.phone ? { phone: patch.phone } : {}) }),
});

const vendorTools = listTools<Vendor>({
  key: 'vendors', noun: 'vendor', title: 'a vendor', fields: vendorFields, required: ['name'],
  addDescription: 'Add a vendor (catering, bar, rentals…) to a show. Category defaults to the app’s first, Catering, and booked to false; a cost counts toward the recap.',
  parse: vendorPatch,
  create: patch => ({ category: VENDOR_CATEGORIES[0], booked: false, ...stripUndefined(patch), id: crypto.randomUUID(), name: patch.name! }),
});

function stripUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as Partial<T>;
}

export const SHOW_EDIT_TOOLS: AssistantTool[] = [
  duplicate,
  addPerformer, updatePerformer, removePerformer, movePerformer, setSurpriseGuest,
  addCue, updateCue, removeCue, moveCue,
  updateRecap,
  ...staffTools, ...vendorTools,
];

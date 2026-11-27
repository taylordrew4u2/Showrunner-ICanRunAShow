/**
 * What a co-producer must say about someone new, and may not say.
 *
 * A co-producer who brings in a person the owner does not already have (a
 * new Rolodex entry, or a new name on a show's performers or artists) sends
 * exactly three things about them: their name, a tape (a link to a video of
 * their set, and whether it is a five-minute or a ten-minute one) and their
 * social media. Nothing else: no email, phone, notes, credits, headshot or
 * walk-on. The owner watches the tape and decides.
 *
 * The owner's own app is not held to any of this, and nor is a co-producer's
 * edit to someone already there (a new name for an entry the Rolodex has
 * included: the owner sees the old name beside the new), or their booking of
 * someone already in the Rolodex.
 *
 * One rule, read in four places: the co-producer's add form and review step
 * (so nothing is sent without them), the schema's refuse mode and the server
 * (so a hand-made request is refused), and the owner's plan (so nothing is
 * approved that got past both). Pure, with no DOM and no Node.
 */
import type { AppSettings, Show } from '../types';
import { rolodexKey } from '../utils/rolodex';
import { socialLink, toHandle } from '../utils/social';
import type { EditPayload, SettingsFieldEdit, ShowEdit } from './types';

export type TapeMinutes = 5 | 10;
/** The two lengths a tape comes in. */
export const TAPE_MINUTES: readonly TapeMinutes[] = [5, 10];

export function isTapeMinutes(value: unknown): value is TapeMinutes {
  return value === 5 || value === 10;
}

/** '5 minutes', '10 minutes'. */
export function tapeLengthLabel(minutes: TapeMinutes): string {
  return `${minutes} minutes`;
}

const MAX_LINK_CHARS = 2000;

/** Whether a stored value is a link a tape can live at: http or https, with no sign-in inside it. */
export function isTapeUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value === '' || value !== value.trim() || value.length > MAX_LINK_CHARS) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  return !url.username && !url.password && url.hostname.includes('.');
}

/**
 * A typed or pasted tape link as it is stored, or null when it is not one.
 * "youtube.com/watch?v=…" typed without its https:// gets it.
 */
export function normalizeTapeUrl(input: string | undefined): string | null {
  const text = input?.trim();
  if (!text) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`;
  return isTapeUrl(withScheme) ? withScheme : null;
}

/** A link with a scheme, or a "site.com/…" typed without one. */
const LINK_LIKE = /^(?:https?:\/\/\S+|(?:www\.)?(?:[a-z0-9-]+\.)+[a-z]{2,}\/\S*)$/i;
/** A handle: letters, digits, dots, dashes and underscores, with a letter or a digit among them. */
const HANDLE = /^@[\w.-]*[A-Za-z0-9][\w.-]*$/;
/** Sites where every profile has a handle, so a link with none in it is a post or a share link, not a person. */
const HANDLE_SITES = /(?:^|\.)(?:instagram\.com|x\.com|twitter\.com|tiktok\.com|threads\.net|threads\.com)$/i;

/**
 * Social media as it is stored for someone new: the handle the app's own
 * helpers read out of whatever was typed ("@name", "name", a profile link),
 * or the profile link itself where it has no handle in it. Null when it is
 * neither: punctuation, a bare scheme, a site's front page, a post.
 */
export function normalizeSocial(input: string | undefined): string | null {
  const text = typeof input === 'string' ? input.trim() : '';
  if (!text || text.length > MAX_LINK_CHARS) return null;
  const handle = toHandle(text);
  if (handle) return HANDLE.test(handle) ? handle : null;
  if (!LINK_LIKE.test(text)) return null;
  const link = socialLink(text);
  if (!link || !isTapeUrl(link)) return null;
  const url = new URL(link);
  // A profile link says whose it is: something after the site's name.
  if (url.pathname.replace(/\/+/g, '') === '' || HANDLE_SITES.test(url.hostname)) return null;
  return link;
}

// ── One person ────────────────────────────────────────────────────────────

/** What is still needed, in the order the form asks for it. */
export type NewComicNeed = 'name' | 'tape' | 'length' | 'social';
export interface NewComicCheck {
  missing: NewComicNeed[];
  /** Fields that hold something and may not. */
  extra: string[];
}

/** Everything a new Rolodex entry may hold. */
const ROLODEX_KEYS: ReadonlySet<string> = new Set(['id', 'name', 'videoLink', 'tapeMinutes', 'socialMedia']);
/**
 * A new person's booking may also say how they are booked: which Rolodex
 * entry it is, whether they are a surprise guest, and an artist's role.
 * Those are facts about the booking, and none of them reaches the Rolodex.
 */
const BOOKING_KEYS: ReadonlySet<string> = new Set([...ROLODEX_KEYS, 'comicId', 'surpriseGuest', 'artistType']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function own(value: unknown, key: string): unknown {
  return isRecord(value) && Object.prototype.hasOwnProperty.call(value, key) ? value[key] : undefined;
}
/** A key that holds nothing says nothing: absent, null and '' read the same, as they do once saved. */
function holds(value: unknown): boolean {
  return value !== undefined && value !== null && value !== '';
}

/** One new person against the rule. `where` says whether it is their Rolodex entry or their booking on a show. */
export function checkNewComic(row: unknown, where: 'rolodex' | 'booking' = 'rolodex'): NewComicCheck {
  const missing: NewComicNeed[] = [];
  const name = own(row, 'name');
  if (typeof name !== 'string' || !name.trim()) missing.push('name');
  if (!isTapeUrl(own(row, 'videoLink'))) missing.push('tape');
  if (!isTapeMinutes(own(row, 'tapeMinutes'))) missing.push('length');
  const social = own(row, 'socialMedia');
  if (typeof social !== 'string' || normalizeSocial(social) === null) missing.push('social');
  const allowed = where === 'rolodex' ? ROLODEX_KEYS : BOOKING_KEYS;
  const extra = isRecord(row) ? Object.keys(row).filter((key) => !allowed.has(key) && holds(row[key])) : [];
  return { missing, extra };
}

export function newComicOk(check: NewComicCheck): boolean {
  return check.missing.length === 0 && check.extra.length === 0;
}

const NEED_WORDS: Record<NewComicNeed, string> = {
  name: 'a name',
  tape: 'a tape link',
  length: 'the tape’s length (5 or 10 minutes)',
  social: 'their social media',
};

function listed(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** 'a tape link, the tape’s length (5 or 10 minutes) and their social media'. */
export function needsText(missing: readonly NewComicNeed[]): string {
  return listed(missing.map((need) => NEED_WORDS[need]));
}

const FIELD_WORDS: ReadonlyMap<string, string> = new Map([
  ['email', 'email'], ['phone', 'phone'], ['notes', 'notes'], ['credits', 'credits'], ['photo', 'headshot'],
  ['walkOnMusic', 'walk-on track'], ['walkOnMusicName', 'walk-on track name'], ['walkOnMusicArtist', 'walk-on artist'],
  ['walkOnMusicTimestamp', 'walk-on start time'], ['walkOnMusicLink', 'walk-on link'],
  ['walkOnStartSec', 'walk-on trim'], ['walkOnEndSec', 'walk-on trim'],
]);

// ── A whole request ───────────────────────────────────────────────────────

/** Who the owner already has, read from their own data. Names are rolodexKey()s. */
export interface KnownPeople {
  /** Every Rolodex entry's id. Only these: a link left behind by a deleted entry is nobody's. */
  comicIds: ReadonlySet<string>;
  rolodexNames: ReadonlySet<string>;
  /** Performers already on a show with no Rolodex entry behind them. */
  performerNames: ReadonlySet<string>;
  /** Artists already on a show with no Rolodex entry behind them. */
  artistNames: ReadonlySet<string>;
  /**
   * The name on every booking that carries each Rolodex link. A link whose
   * entry has been deleted stays on its bookings, and is good only for the
   * people those bookings name.
   */
  linkNames: ReadonlyMap<string, ReadonlySet<string>>;
  /** Performers booked with no Rolodex entry, as booked, by name. */
  unfiled: ReadonlyMap<string, readonly Record<string, unknown>[]>;
}

type Listed = 'performers' | 'artists';
const LISTS: readonly Listed[] = ['performers', 'artists'];

function nameKey(row: unknown): string {
  const name = own(row, 'name');
  return typeof name === 'string' ? rolodexKey(name) : '';
}
function linkOf(row: unknown): string | null {
  const id = own(row, 'comicId');
  return typeof id === 'string' && id !== '' ? id : null;
}
function rowsOf(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}
function whoOf(row: Record<string, unknown>): string {
  return typeof row.name === 'string' ? row.name.trim() : '';
}

/** The people an account already has: its Rolodex, and everyone on its shows and in Recently deleted. */
export function knownPeople(
  shows: readonly Show[],
  settings: Pick<AppSettings, 'potentialComics' | 'trash'> | null | undefined,
): KnownPeople {
  const comicIds = new Set<string>();
  const rolodexNames = new Set<string>();
  const unlinked: Record<Listed, Set<string>> = { performers: new Set(), artists: new Set() };
  const linkNames = new Map<string, Set<string>>();
  const unfiled = new Map<string, Record<string, unknown>[]>();
  const goesBy = (link: string, name: string) => {
    const names = linkNames.get(link);
    if (names) names.add(name);
    else linkNames.set(link, new Set([name]));
  };
  for (const comic of rowsOf(settings?.potentialComics)) {
    if (typeof comic.id === 'string') comicIds.add(comic.id);
    rolodexNames.add(nameKey(comic));
  }
  const all: unknown[] = [...shows, ...rowsOf(settings?.trash).map((item) => item.data)];
  for (const show of all) {
    for (const list of LISTS) {
      for (const row of rowsOf(own(show, list))) {
        const link = linkOf(row);
        const key = nameKey(row);
        if (link) {
          goesBy(link, key);
          continue;
        }
        unlinked[list].add(key);
        if (list !== 'performers') continue;
        const booked = unfiled.get(key);
        if (booked) booked.push(row);
        else unfiled.set(key, [row]);
      }
    }
  }
  return { comicIds, rolodexNames, performerNames: unlinked.performers, artistNames: unlinked.artists, linkNames, unfiled };
}

export interface NewPersonProblem {
  /** Where in the payload, in the schema's path grammar. */
  path: string;
  /** Their name as typed, or '' when they have none. */
  who: string;
  missing: NewComicNeed[];
  extra: string[];
  /** A booking that points at a Rolodex entry nobody has. */
  unknownLink?: true;
}

interface Candidate { row: Record<string, unknown>; path: string; list: Listed }

/** Every performer and artist row a show edit would write. */
function proposedBookings(edit: ShowEdit, at: number): Candidate[] {
  const out: Candidate[] = [];
  if (!isRecord(edit)) return out;
  const from = edit.op === 'create' ? ['show', edit.show] as const : edit.op === 'update' ? ['proposed', edit.proposed] as const : null;
  if (!from) return out;
  for (const list of LISTS) {
    rowsOf(own(from[1], list)).forEach((row, i) => out.push({ row, list, path: `shows[${at}].${from[0]}.${list}[${i}]` }));
  }
  return out;
}

/**
 * Rows of one show edit that put someone on the bill who was not in that
 * place before, as far as the request itself says. Only for a reader with
 * none of the owner's data: what a request says was there is its own word.
 */
function bookingCandidates(edit: ShowEdit, at: number): Candidate[] {
  if (!isRecord(edit) || edit.op !== 'update') return proposedBookings(edit, at);
  return proposedBookings(edit, at).filter(({ row, list }) => {
    const was = rowsOf(own(edit.base, list)).find((before) => before.id === row.id);
    // Someone else in the same slot is someone new on the bill: a different
    // Rolodex entry, or a different name where there is no entry.
    const same = was !== undefined && (linkOf(row) !== null || linkOf(was) !== null
      ? linkOf(row) === linkOf(was)
      : nameKey(row) === nameKey(was));
    return !same;
  });
}

function problemFor(row: Record<string, unknown>, path: string, where: 'rolodex' | 'booking'): NewPersonProblem | null {
  const check = checkNewComic(row, where);
  if (newComicOk(check)) return null;
  return { path, who: whoOf(row), ...check };
}

function sameValue(a: unknown, b: unknown): boolean {
  return Object.is(a, b) || JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Whether a new Rolodex entry is only the app filing someone the owner
 * already has on a bill with no entry: their name, and nothing about them
 * that the booking does not already say.
 */
function filesABooking(row: Record<string, unknown>, known: KnownPeople): boolean {
  const key = nameKey(row);
  if (!key || known.rolodexNames.has(key)) return false;
  return (known.unfiled.get(key) ?? []).some((booking) =>
    Object.keys(row).every((field) => field === 'id' || field === 'name' || !holds(row[field]) || sameValue(row[field], own(booking, field))));
}

/**
 * Everyone new in an edit who does not keep the rule.
 *
 * `known` is the owner's own data (knownPeople), which the server and both
 * apps have, and with it who is new is read from that data alone: an entry
 * is new when the Rolodex has no entry with its id, and a name on a bill is
 * new when the owner has nobody by it. What the request says was there
 * before (its base, its baseOrder) is the sender's word and is not asked.
 * Every row a show edit would write is read, changed or not.
 *
 * Without `known` only what the payload shows by itself is checked: its new
 * Rolodex entries, and the bookings that point at them.
 */
export function newPeopleProblems(payload: EditPayload, known?: KnownPeople): NewPersonProblem[] {
  const problems: NewPersonProblem[] = [];
  if (!isRecord(payload) || payload.kind !== 'edit') return problems;

  // New Rolodex entries. Someone already on a bill with no entry is not
  // new: filing them, as their booking has them, is the app's own bookkeeping.
  const fresh = new Set<string>();
  const filed = new Set<string>();
  const fields: SettingsFieldEdit[] = Array.isArray(payload.settings?.fields) ? payload.settings.fields : [];
  fields.forEach((edit, f) => {
    if (!isRecord(edit) || edit.field !== 'potentialComics' || edit.kind !== 'rows') return;
    const before: ReadonlySet<unknown> = known ? known.comicIds : new Set(Array.isArray(edit.baseOrder) ? edit.baseOrder : []);
    (Array.isArray(edit.proposed) ? edit.proposed : []).forEach((pair, i) => {
      if (!Array.isArray(pair) || typeof pair[0] !== 'string' || !isRecord(pair[1])) return;
      const [id, row] = pair as [string, Record<string, unknown>];
      if (before.has(id)) return;
      if (known && filesABooking(row, known)) {
        filed.add(id);
        return;
      }
      fresh.add(id);
      const problem = problemFor(row, `settings.fields[${f}].proposed[${i}][1]`, 'rolodex');
      if (problem) problems.push(problem);
    });
  });

  // Names on a bill.
  (Array.isArray(payload.shows) ? payload.shows : []).forEach((edit, at) => {
    for (const { row, list, path } of known ? proposedBookings(edit, at) : bookingCandidates(edit, at)) {
      const link = linkOf(row);
      const key = nameKey(row);
      if (link !== null) {
        // Booked from an entry this request adds is the same person, held to
        // the same rule below.
        if (!fresh.has(link)) {
          // Booked from an entry the owner has, whose profile approval writes
          // over the booking, name and all. A link to no entry writes over
          // nothing, so it is good only for whoever the owner already has
          // behind it: a booking left linked when its entry was deleted.
          const theirs = !known || known.comicIds.has(link) || filed.has(link) || known.linkNames.get(link)?.has(key) === true;
          if (!theirs) problems.push({ path, who: whoOf(row), missing: [], extra: [], unknownLink: true });
          continue;
        }
      } else if (!known) {
        // Whether a bare name is already on the owner's shows cannot be told from here.
        continue;
      } else if (known.rolodexNames.has(key) || (list === 'performers' ? known.performerNames : known.artistNames).has(key)) {
        continue;
      }
      const problem = problemFor(row, path, 'booking');
      if (problem) problems.push(problem);
    }
  });
  return problems;
}

/** One problem as a sentence for whoever is about to send it. */
export function describeNewPersonProblem(problem: NewPersonProblem): string {
  const who = problem.who || 'Someone new';
  if (problem.unknownLink) return `${who} is booked from a Rolodex entry that isn’t there. Take them off and add them again.`;
  const parts: string[] = [];
  if (problem.missing.length) parts.push(`${who} needs ${needsText(problem.missing)}.`);
  if (problem.extra.length) {
    const words = [...new Set(problem.extra.map((key) => FIELD_WORDS.get(key) ?? key))];
    parts.push(`${problem.missing.length ? 'Also take' : `${who} is new, so only a name, a tape and social media can be sent. Take`} off their ${listed(words)}.`);
  }
  return parts.join(' ');
}

/** The problems as the owner is told them, when a request that breaks the rule reaches their inbox anyway. */
export function ownerRefusal(problems: readonly NewPersonProblem[]): string {
  const names = listed([...new Set(problems.map((problem) => problem.who || 'someone'))]);
  if (problems.every((problem) => problem.unknownLink)) {
    return `This books ${names} from a Rolodex entry you no longer have. It can’t be approved. Ask them to send it again.`;
  }
  return `This adds ${names} without what a new person needs: a name, a 5 or 10 minute tape and their social media, and nothing else. It can’t be approved. Ask them to send it again.`;
}

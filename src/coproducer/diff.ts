/**
 * Changes in words: what is there now beside what is proposed, field by
 * field, for both producers.
 *
 * The co-producer's app uses it to show what they are about to send and what
 * is waiting (review mode, the default: bookkeeping the owner's app keeps by
 * itself is left out). The owner's inbox uses it with `complete: true` to show
 * everything approval would change, every id and timestamp included, so
 * nothing is applied that the owner was not shown.
 *
 * Every name and item comes from the reader's own data (`context.state`), not
 * from words the other producer typed; values are never cut (the list on
 * screen shortens long text for display, with a way to see it whole); and
 * invisible or direction-changing characters are made visible. Two raw
 * values that differ never read the same: when they would, both sides fall
 * back to their JSON.
 *
 * Pure and synchronous, with no DOM: the server can import it.
 */
import type { AppSettings, MusicTrack, Show } from '../types';
import { groupKeyForSettings, groupKeyForShow, sameValue, seg, SETTINGS_WORKSPACE_FIELDS } from './paths';
import type {
  ChangeGroup,
  Conflict,
  DownloadAction,
  FieldChange,
  HandOver,
  HeadshotSubject,
  MediaKind,
  RawConflict,
  RequestOutline,
  RequestPayload,
  SettingsKey,
  ShareAction,
  ShowEdit,
} from './types';
import { SETTINGS_ROW_FIELDS } from './types';

export interface DiffContext {
  rolodexPlural?: string;
  musicLibrary?: MusicTrack[];
  /** The data names and items come from: the owner's state in the inbox, truth in review mode. */
  state?: { shows: Show[]; settings: AppSettings };
  /** The owner's inbox: show every key. Off in review mode, where bookkeeping is noise. */
  complete?: boolean;
}

/** Internal: what describePayload knows that a bare diff does not. */
interface Ctx extends DiffContext {
  /** Shows this request brings back from Recently deleted. */
  restored?: ReadonlySet<string>;
}

type Row = Record<string, unknown>;

// ── Text ──────────────────────────────────────────────────────────────────

const INVISIBLE = /[\u202A-\u202E\u2066-\u2069\u200B-\u200F\uFEFF]|(?![\t\n])\p{Cc}/gu;

/**
 * Makes invisible and direction-changing characters visible: the direction
 * overrides and isolates, the zero-width characters, the byte order mark and
 * control characters other than tab and newline each become ⟨U+XXXX⟩.
 */
export function visibleText(value: string): string {
  return value.replace(INVISIBLE, (ch) => `⟨U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}⟩`);
}

/** 'walkOnMusicName' gives 'Walk on music name'. */
export function humanizeKey(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase();
  return words ? words[0].toUpperCase() + words.slice(1) : key;
}

/** The recipients, subject and body of a mailto: link; null when it does not parse. */
export function parseMailto(href: string): { to: string[]; cc: string[]; bcc: string[]; subject: string; body: string } | null {
  if (!/^mailto:/i.test(href)) return null;
  const rest = href.slice('mailto:'.length);
  const q = rest.indexOf('?');
  const addresses = q < 0 ? rest : rest.slice(0, q);
  const query = q < 0 ? '' : rest.slice(q + 1);
  const list = (text: string) =>
    decodeURIComponent(text)
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  try {
    const out = { to: list(addresses), cc: [] as string[], bcc: [] as string[], subject: '', body: '' };
    for (const part of query.split('&')) {
      if (!part) continue;
      const eq = part.indexOf('=');
      const name = (eq < 0 ? part : part.slice(0, eq)).toLowerCase();
      const value = eq < 0 ? '' : part.slice(eq + 1);
      if (name === 'to') out.to.push(...list(value));
      else if (name === 'cc') out.cc.push(...list(value));
      else if (name === 'bcc') out.bcc.push(...list(value));
      else if (name === 'subject') out.subject = decodeURIComponent(value);
      else if (name === 'body') out.body = decodeURIComponent(value);
    }
    return out;
  } catch {
    return null;
  }
}

// ── What each field is called ─────────────────────────────────────────────

type Hint =
  | 'text'
  | 'number'
  | 'yesno'
  | 'money'
  | 'mss'
  | 'date'
  | 'image'
  | 'audio'
  | 'pdf'
  | 'showStatus'
  | 'sceneStatus'
  | 'agreementType'
  | 'signed'
  | 'cues'
  | 'questions';
interface FieldSpec {
  label: string;
  hint?: Hint;
  /** The sibling field that names a file: musicName, walkOnMusicName, fileName. */
  name?: string;
  /** Bookkeeping: left out in review mode, under "Other details" in complete mode. */
  ignored?: boolean;
  /** A secret: never shown in any mode. */
  never?: boolean;
}
type Table = ReadonlyMap<string, FieldSpec>;

function table(entries: Record<string, FieldSpec | string>): Table {
  return new Map(Object.entries(entries).map(([key, spec]) => [key, typeof spec === 'string' ? { label: spec } : spec]));
}
const IGNORED: FieldSpec = { label: '', ignored: true };
const NEVER: FieldSpec = { label: '', never: true };

const PERSON_FIELDS: Record<string, FieldSpec | string> = {
  name: 'Name',
  photo: { label: 'Headshot', hint: 'image' },
  socialMedia: 'Social',
  email: 'Email',
  phone: 'Phone',
  notes: 'Notes',
  credits: 'Credits',
  videoLink: 'Video link',
  walkOnMusic: { label: 'Walk-on track', hint: 'audio', name: 'walkOnMusicName' },
  walkOnMusicName: 'Walk-on track name',
  walkOnMusicArtist: 'Walk-on artist',
  walkOnMusicTimestamp: 'Walk-on start time',
  walkOnMusicLink: 'Walk-on link',
  walkOnStartSec: { label: 'Walk-on starts at', hint: 'mss' },
  walkOnEndSec: { label: 'Walk-on ends at', hint: 'mss' },
  surpriseGuest: { label: 'Surprise guest', hint: 'yesno' },
  comicId: IGNORED,
  id: IGNORED,
};
const EXPENSE_FIELDS = table({
  category: 'Category',
  itemName: 'Item',
  cost: { label: 'Cost', hint: 'money' },
  date: { label: 'Date', hint: 'date' },
  notes: 'Notes',
  id: IGNORED,
});
const TRACK_FIELDS = {
  title: 'Title',
  artist: 'Artist',
  notes: 'Notes',
  music: { label: 'Audio', hint: 'audio', name: 'musicName' } as FieldSpec,
  musicName: 'File name',
  startSec: { label: 'Starts at', hint: 'mss' } as FieldSpec,
  endSec: { label: 'Ends at', hint: 'mss' } as FieldSpec,
  id: IGNORED,
};
const TEMPLATE_ITEM_FIELDS = table({
  time: 'Time',
  description: 'Segment',
  performer: 'On stage',
  durationMin: { label: 'Length (min)', hint: 'number' },
});

interface ListSpec {
  label: (ctx: Ctx) => string;
  idKey: string;
  title: (row: Row) => string;
  fields: Table;
  /** The label of the line for a removed row. */
  removed?: (row: Row, ctx: Ctx) => string;
  /** The label of the line for an added row, and whether its fields follow. */
  added?: string;
  addedFields?: boolean;
  /** A changed row's lines, where its fields are not the story (trash). */
  changed?: (before: Row, after: Row, prefix: string[], key: string, ctx: Ctx) => FieldChange[];
}

function str(value: unknown): string {
  return typeof value === 'string' ? visibleText(value.trim()) : '';
}
function joinTitle(parts: unknown[], sep: string, fallback: string): string {
  const text = parts.map(str).filter(Boolean).join(sep);
  return text || fallback;
}
const named = (fallback: string) => (row: Row) => joinTitle([row.name], '', fallback);
const fixed = (label: string) => () => label;

const SHOW_LISTS: ReadonlyMap<string, ListSpec> = new Map<string, ListSpec>([
  ['performers', { label: fixed('Performers'), idKey: 'id', title: named('Unnamed performer'), fields: table(PERSON_FIELDS) }],
  ['artists', { label: fixed('Artists'), idKey: 'id', title: named('Unnamed artist'), fields: table({ ...PERSON_FIELDS, artistType: 'Role' }) }],
  ['schedule', {
    label: fixed('Schedule'),
    idKey: 'id',
    title: (row) => joinTitle([row.time, row.description], ' · ', 'Cue'),
    fields: table({
      time: 'Time',
      description: 'Segment',
      performer: 'On stage',
      durationMin: { label: 'Length (min)', hint: 'number' },
      music: { label: 'Cue music', hint: 'audio', name: 'musicName' },
      musicName: 'Cue music name',
      musicDuration: { label: 'Cue music length (seconds)', hint: 'number' },
      musicStartSec: { label: 'Cue music starts at', hint: 'mss' },
      musicEndSec: { label: 'Cue music ends at', hint: 'mss' },
      performerId: IGNORED,
      id: IGNORED,
    }),
  }],
  ['hosts', {
    label: fixed('Hosts'),
    idKey: 'id',
    title: named('Unnamed host'),
    fields: table({ name: 'Name', notes: 'Notes', isHosting: { label: 'Hosting', hint: 'yesno' }, id: IGNORED }),
  }],
  ['djSongs', {
    label: fixed('DJ Music'),
    idKey: 'id',
    title: (row) => joinTitle([row.title, row.artist], ' — ', 'Untitled song'),
    fields: table({ ...TRACK_FIELDS, libraryId: IGNORED }),
  }],
  ['staff', {
    label: fixed('Staff'),
    idKey: 'id',
    title: (row) => joinTitle([row.role, row.personName], ': ', 'Crew'),
    fields: table({ role: 'Role', personName: 'Name', phone: 'Phone', id: IGNORED }),
  }],
  ['vendors', {
    label: fixed('Vendors'),
    idKey: 'id',
    title: named('Unnamed vendor'),
    fields: table({
      name: 'Name',
      category: 'Category',
      contactName: 'Contact',
      phone: 'Phone',
      email: 'Email',
      website: 'Website',
      cost: { label: 'Cost', hint: 'money' },
      notes: 'Notes',
      booked: { label: 'Booked', hint: 'yesno' },
      id: IGNORED,
    }),
  }],
  ['expenses', { label: fixed('Expenses'), idKey: 'id', title: (row) => joinTitle([row.itemName], '', 'Expense'), fields: EXPENSE_FIELDS }],
  ['scenes', {
    label: fixed('Scenes & Segments'),
    idKey: 'id',
    title: (row) => joinTitle([row.title], '', 'Untitled scene'),
    fields: table({
      title: 'Title',
      description: 'Description',
      duration: { label: 'Length (min)', hint: 'number' },
      status: { label: 'Status', hint: 'sceneStatus' },
      order: IGNORED,
      id: IGNORED,
    }),
  }],
  ['todos', {
    label: fixed('To-dos'),
    idKey: 'id',
    title: (row) => joinTitle([row.text], '', 'To-do'),
    fields: table({ text: 'To-do', completed: { label: 'Done', hint: 'yesno' }, id: IGNORED }),
  }],
]);

const SHOW_VALUES = table({
  name: 'Show name',
  date: { label: 'Date', hint: 'date' },
  time: 'Show time',
  venueName: 'Venue name',
  location: 'Location',
  status: { label: 'Status', hint: 'showStatus' },
  host: 'Host',
  hostSocial: 'Host’s social',
  coHost: 'Second host',
  coHostSocial: 'Second host’s social',
  ticketLink: 'Ticket link',
  flyer: { label: 'Flyer', hint: 'image' },
  performerTarget: { label: 'Booking target', hint: 'number' },
  productionNotes: 'Production notes',
  viewNote: 'Viewer page note',
  hiddenSections: 'Hidden sections',
  completions: 'Sections marked done',
  recap: 'Recap',
  djHiddenLibraryIds: 'Library tracks left out',
  sample: { label: 'Sample show', hint: 'yesno' },
});
/**
 * Keys the owner's app keeps on every show. A host's Rolodex link is one:
 * it changes when the host does, and the name and the handle say that.
 */
const SHOW_BOOKKEEPING = table({
  id: IGNORED, createdAt: IGNORED, updatedAt: NEVER, viewToken: { label: 'Viewer link' }, viewerKey: NEVER,
  hostComicId: IGNORED, coHostComicId: IGNORED,
});
const RECAP_FIELDS = table({
  attendance: { label: 'Attendance', hint: 'number' },
  ticketSales: { label: 'Ticket sales', hint: 'money' },
  merchSales: { label: 'Merch sales', hint: 'money' },
  otherCosts: { label: 'Other costs', hint: 'money' },
  performerNotes: 'Performer notes',
  improvementNotes: 'What to improve',
  profitLoss: NEVER,
});
const SECTION_NAMES: ReadonlyMap<string, string> = new Map([
  ['basic', 'Basic Info'],
  ['performers', 'Performers'],
  ['artists', 'Artists'],
  ['schedule', 'Schedule'],
  ['hosts', 'Hosts'],
  ['dj', 'DJ Music'],
  ['staff', 'Staff'],
  ['vendors', 'Vendors'],
  ['expenses', 'Expenses'],
  ['scenes', 'Scenes & Segments'],
  ['recap', 'Recap'],
]);
const SHOW_STATUS_NAMES: ReadonlyMap<string, string> = new Map([
  ['upcoming', 'Upcoming'],
  ['in-progress', 'In progress'],
  ['completed', 'Completed'],
  ['cancelled', 'Cancelled'],
]);

function trashName(row: Row): string {
  const data = row.data;
  return joinTitle([data && typeof data === 'object' ? (data as Row).name : undefined], '', 'Untitled show');
}

const SETTINGS_LISTS: ReadonlyMap<string, ListSpec> = new Map<string, ListSpec>([
  ['producers', { label: fixed('Producers'), idKey: 'id', title: named('Unnamed producer'), fields: table({ name: 'Name', role: 'Role', id: IGNORED }) }],
  ['potentialComics', {
    label: (ctx) => ctx.rolodexPlural || 'Rolodex',
    idKey: 'id',
    title: named('Unnamed'),
    // The owner's own note on an entry filed from the sample show. A
    // co-producer is never served it, and booking that person on a show
    // drops it as bookkeeping, not as a change to approve.
    fields: table({ ...PERSON_FIELDS, fromSample: NEVER }),
  }],
  ['emailList', {
    label: fixed('Email list'),
    idKey: 'email',
    title: (row) => joinTitle([row.email], '', 'Email'),
    fields: table({ email: 'Email', addedAt: IGNORED, id: IGNORED }),
    addedFields: false,
  }],
  ['expenses', { label: fixed('Expenses'), idKey: 'id', title: (row) => joinTitle([row.itemName], '', 'Expense'), fields: EXPENSE_FIELDS }],
  ['scheduleTemplates', {
    label: fixed('Running order templates'),
    idKey: 'id',
    title: named('Untitled template'),
    fields: table({ name: 'Name', items: { label: 'Cues', hint: 'cues' }, createdAt: IGNORED, id: IGNORED }),
  }],
  ['musicLibrary', {
    label: fixed('Music library'),
    idKey: 'id',
    title: (row) => joinTitle([row.title, row.artist], ' — ', 'Untitled track'),
    fields: table({ ...TRACK_FIELDS, addedAt: IGNORED }),
  }],
  ['contracts', {
    label: fixed('Contracts'),
    idKey: 'id',
    title: named('Untitled contract'),
    fields: table({
      name: 'Name',
      fileRef: { label: 'File', hint: 'pdf', name: 'fileName' },
      fileName: 'File name',
      fields: { label: 'Questions', hint: 'questions' },
      sizeBytes: IGNORED,
      uploadedAt: IGNORED,
      id: IGNORED,
    }),
  }],
  ['signedAgreements', {
    label: fixed('Signed agreements'),
    idKey: 'id',
    title: named('Untitled agreement'),
    fields: table({
      name: 'Name',
      category: { label: 'Type', hint: 'agreementType' },
      counterparty: 'Other party',
      fileRef: { label: 'File', hint: 'pdf', name: 'fileName' },
      fileName: 'File name',
      sizeBytes: IGNORED,
      uploadedAt: IGNORED,
      id: IGNORED,
    }),
  }],
  ['signatureRequests', {
    label: fixed('Contract links'),
    idKey: 'token',
    title: (row) => joinTitle([row.contractName, row.signerName], ' — ', 'Contract link'),
    fields: table({
      contractName: 'Contract',
      signerName: 'Signer',
      signerEmail: 'Email',
      signed: { label: 'Signed', hint: 'signed' },
      token: NEVER,
      key: NEVER,
      contractId: IGNORED,
      contactId: IGNORED,
      id: IGNORED,
      profileFiled: IGNORED,
      sentAt: IGNORED,
    }),
    removed: (row) => (row.signed ? 'Signed record deleted' : 'Link withdrawn'),
  }],
  ['profileRequests', {
    label: fixed('Details links'),
    idKey: 'token',
    title: (row) => joinTitle([row.personName], '', 'Details link'),
    fields: table({
      personName: 'Name',
      token: NEVER,
      key: NEVER,
      contactId: IGNORED,
      id: IGNORED,
      submitted: IGNORED,
      sentAt: IGNORED,
    }),
    removed: (row) => (row.submitted ? 'Details link and their answers removed' : 'Details link withdrawn'),
  }],
  ['trash', {
    label: fixed('Recently deleted'),
    idKey: 'id',
    title: trashName,
    fields: table({ data: IGNORED, type: IGNORED, deletedAt: IGNORED, id: IGNORED }),
    added: 'Moved to Recently deleted',
    addedFields: false,
    removed: (row, ctx) => {
      const data = row.data;
      const showId = data && typeof data === 'object' ? (data as Row).id : undefined;
      const back = typeof showId === 'string' && (ctx.restored?.has(showId) || ctx.state?.shows.some((show) => show.id === showId));
      return back ? 'Restored' : 'Deleted for good';
    },
    // The show kept in a trash row only changes through the owner's own app,
    // so in review mode a changed row is bookkeeping; the owner sees it all.
    changed: (before, after, prefix, rowKey, ctx) => {
      if (!ctx.complete) return [];
      const group = diffShowWith(before.data as Show, after.data as Show, ctx);
      return (group?.changes ?? []).map((change) => ({ ...change, key: `${rowKey}/data/${change.key}`, path: [...prefix, ...change.path] }));
    },
  }],
]);

const WORKSPACE_VALUES = table({
  brandName: 'Brand name',
  showTypes: 'Show types',
  rolodexTermSingular: 'Rolodex word (one)',
  rolodexTermPlural: 'Rolodex word (many)',
  brandBudget: { label: 'Brand budget', hint: 'money' },
  totalSpent: { label: 'Total spent', hint: 'money' },
  rules: 'Rules / Notes',
  remoteMusicKey: 'Stage remote key',
  deletedShowIds: { label: 'Shows kept deleted', ignored: true },
  onboarded: { label: 'Welcome finished', hint: 'yesno', ignored: true },
});
const WORKSPACE = new Set<string>(SETTINGS_WORKSPACE_FIELDS);
const SETTINGS_GROUP_ORDER: readonly string[] = [
  ...SETTINGS_WORKSPACE_FIELDS,
  'potentialComics',
  'emailList',
  'expenses',
  'scheduleTemplates',
  'musicLibrary',
  'contracts',
  'signedAgreements',
  'signatureRequests',
  'profileRequests',
  'trash',
];

/**
 * Every key the diff names, for the test that checks nothing in src/types
 * falls back to a made-up label: top-level show and settings keys, and the
 * fields of each list's rows.
 */
export function describedKeys(): { show: string[]; settings: string[]; lists: Record<string, string[]>; recap: string[] } {
  const lists: Record<string, string[]> = {};
  for (const [key, spec] of [...SHOW_LISTS, ...SETTINGS_LISTS]) lists[key] = [...new Set([...(lists[key] ?? []), ...spec.fields.keys()])];
  return {
    show: [...SHOW_VALUES.keys(), ...SHOW_LISTS.keys(), ...SHOW_BOOKKEEPING.keys()],
    settings: [...WORKSPACE_VALUES.keys(), ...SETTINGS_LISTS.keys()],
    lists,
    recap: [...RECAP_FIELDS.keys()],
  };
}

// ── Values in words ───────────────────────────────────────────────────────

function isRow(value: unknown): value is Row {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function own(value: unknown, key: string): unknown {
  return isRow(value) && Object.prototype.hasOwnProperty.call(value, key) ? value[key] : undefined;
}
function isBlank(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === 'string' && value.trim() === '') || (Array.isArray(value) && value.length === 0);
}

function mss(seconds: number): string {
  const sign = seconds < 0 ? '-' : '';
  const total = Math.abs(seconds);
  const minutes = Math.floor(total / 60);
  const rest = Math.round((total - minutes * 60) * 1000) / 1000;
  const whole = Math.floor(rest);
  const secs = rest === whole ? String(whole).padStart(2, '0') : `${whole < 10 ? '0' : ''}${rest}`;
  return `${sign}${minutes}:${secs}`;
}

function dateText(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return visibleText(value.trim());
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (Number.isNaN(date.getTime())) return visibleText(value.trim());
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function timestampDate(value: unknown): string {
  if (typeof value !== 'string') return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? visibleText(value) : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function json(value: unknown): string {
  return visibleText(JSON.stringify(value) ?? '');
}

/** One value in words, by its hint; null when there is nothing. */
function formatValue(raw: unknown, hint: Hint = 'text'): string | null {
  if (hint === 'yesno' && (raw === undefined || raw === null)) return 'No';
  if (isBlank(raw)) return null;
  switch (hint) {
    case 'yesno':
      return raw === true ? 'Yes' : raw === false ? 'No' : json(raw);
    case 'money':
      return typeof raw === 'number' ? raw.toLocaleString(undefined, { maximumFractionDigits: 2 }) : plain(raw);
    case 'mss':
      return typeof raw === 'number' && Number.isFinite(raw) ? mss(raw) : plain(raw);
    case 'date':
      return typeof raw === 'string' ? dateText(raw) : plain(raw);
    case 'showStatus':
      return typeof raw === 'string' && SHOW_STATUS_NAMES.has(raw) ? SHOW_STATUS_NAMES.get(raw)! : plain(raw);
    case 'sceneStatus':
      return typeof raw === 'string' && /^[a-z]+$/.test(raw) ? raw[0].toUpperCase() + raw.slice(1) : plain(raw);
    case 'agreementType':
      return raw === 'venue' ? 'Venue' : raw === 'producer' ? 'Producer' : plain(raw);
    case 'signed':
      return isRow(raw) ? signedText(raw) : plain(raw);
    default:
      return plain(raw);
  }
}

function plain(raw: unknown): string | null {
  if (isBlank(raw)) return null;
  if (typeof raw === 'string') return visibleText(raw.trim());
  if (typeof raw === 'number') return String(raw);
  if (typeof raw === 'boolean') return raw ? 'Yes' : 'No';
  if (Array.isArray(raw) && raw.every((item) => typeof item === 'string')) return visibleText((raw as string[]).map((item) => item.trim()).join(', '));
  return json(raw);
}

/** A signed contract in full: who, when, and every answer they gave. */
function signedText(record: Row): string {
  const who = str(record.signerName) || str(record.typedName) || 'Someone';
  const lines = [`${who} on ${timestampDate(record.signedAt)}`];
  const typed = str(record.typedName);
  if (typed && typed !== who) lines.push(`Signed as ${typed}`);
  if (Array.isArray(record.fields)) {
    for (const answer of record.fields) {
      if (isRow(answer)) lines.push(`${str(answer.label)}: ${str(answer.value)}`);
    }
  }
  const rule = str(record.cancellationRuleAcknowledged);
  if (rule) lines.push(`Agreed: ${rule}`);
  if (!isBlank(record.headshot)) lines.push('Sent a headshot');
  return lines.join('\n');
}

const MEDIA_WORDS: Record<MediaKind, { noun: string; onFile: string }> = {
  image: { noun: 'photo', onFile: 'Photo on file' },
  audio: { noun: 'audio file', onFile: 'Audio on file' },
  pdf: { noun: 'PDF', onFile: 'PDF on file' },
};
function mediaKindOf(hint: Hint | undefined): MediaKind | null {
  return hint === 'image' || hint === 'audio' || hint === 'pdf' ? hint : null;
}
function isFileRef(value: unknown): value is string {
  return typeof value === 'string' && (value.startsWith('media:') || value.startsWith('data:'));
}

/** The raw value as text, for when two different values would otherwise read the same. */
function rawText(value: unknown): string | null {
  if (value === undefined) return null;
  return visibleText(
    JSON.stringify(value, (_key, item: unknown) =>
      typeof item === 'number' && (!Number.isFinite(item) || Object.is(item, -0)) ? `${Object.is(item, -0) ? '-0' : String(item)} (number)` : item,
    ) ?? 'undefined',
  );
}

/** Both sides of one change in words, with the media previews when it is a file. */
function formatPair(
  before: unknown,
  after: unknown,
  spec: FieldSpec,
  beforeRow?: Row,
  afterRow?: Row,
): { before: string | null; after: string | null; media?: FieldChange['media'] } {
  const kind = mediaKindOf(spec.hint);
  let b: string | null;
  let a: string | null;
  let media: FieldChange['media'];
  if (kind) {
    const words = MEDIA_WORDS[kind];
    const suffix = (row?: Row) => {
      const name = spec.name ? str(own(row, spec.name)) : '';
      return name ? `: ${name}` : '';
    };
    const has = (value: unknown) => typeof value === 'string' && value.trim() !== '';
    b = has(before) ? `${words.onFile}${suffix(beforeRow)}` : null;
    a = has(after) ? `${has(before) ? 'Replaced' : 'New'} ${words.noun}${suffix(afterRow)}` : null;
    if (isFileRef(before) || isFileRef(after)) {
      media = { kind };
      if (isFileRef(before)) media.before = before;
      if (isFileRef(after)) media.after = after;
    }
  } else {
    b = formatValue(before, spec.hint);
    a = formatValue(after, spec.hint);
  }
  if (b === a && !sameValue(before, after)) {
    b = rawText(before);
    a = rawText(after);
    if (b === a) b = `${b ?? 'Nothing'} (before)`;
  }
  return media ? { before: b, after: a, media } : { before: b, after: a };
}

function changeKind(before: string | null, after: string | null): FieldChange['change'] {
  return before === null ? 'added' : after === null ? 'removed' : 'changed';
}

function fieldChange(
  key: string,
  path: string[],
  label: string,
  before: unknown,
  after: unknown,
  spec: FieldSpec,
  beforeRow?: Row,
  afterRow?: Row,
): FieldChange | null {
  if (sameValue(before, after)) return null;
  const pair = formatPair(before, after, spec, beforeRow, afterRow);
  const change: FieldChange = { key, path, label, before: pair.before, after: pair.after, change: changeKind(pair.before, pair.after) };
  if (pair.media) change.media = pair.media;
  return change;
}

function orderedKeys(known: Iterable<string>, ...values: unknown[]): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const key of known) {
    if (!seen.has(key)) {
      seen.add(key);
      keys.push(key);
    }
  }
  for (const value of values) {
    if (!isRow(value)) continue;
    for (const key of Object.keys(value)) {
      if (!seen.has(key)) {
        seen.add(key);
        keys.push(key);
      }
    }
  }
  return keys.filter((key) => values.some((value) => isRow(value) && Object.prototype.hasOwnProperty.call(value, key)));
}

// ── Lists of rows ─────────────────────────────────────────────────────────

function rowsOf(value: unknown): Row[] {
  return Array.isArray(value) ? value.filter(isRow) : [];
}

/** The order line for rows on both sides, when their relative order changed. */
function orderChange(key: string, path: string[], beforeIds: string[], afterIds: string[], titleOf: (id: string) => string): FieldChange | null {
  if (sameValue(beforeIds, afterIds)) return null;
  const before = beforeIds.map(titleOf).join(', ');
  let after = afterIds.map(titleOf).join(', ');
  if (before === after) {
    // Same titles, different rows: say where each one was.
    after = afterIds.map((id) => `${titleOf(id)} (was ${beforeIds.indexOf(id) + 1})`).join(', ');
  }
  return { key, path, label: 'Order', before, after, change: 'moved' };
}

/** Lines for the fields of one row that changed, or every non-empty field of an added one. */
function rowFieldChanges(spec: ListSpec, before: Row | undefined, after: Row, rowKey: string, path: string[], ctx: Ctx): FieldChange[] {
  const out: FieldChange[] = [];
  for (const field of orderedKeys(spec.fields.keys(), before, after)) {
    const fieldSpec = spec.fields.get(field);
    if (fieldSpec?.never) continue;
    const b = own(before, field);
    const a = own(after, field);
    if (!before && (isBlank(a) || a === false)) continue;
    if (fieldSpec?.hint === 'cues') {
      out.push(...cueChanges(rowsOf(b), rowsOf(a), `${rowKey}/${field}`, path));
      continue;
    }
    if (fieldSpec?.hint === 'questions') {
      out.push(...questionChanges(rowsOf(b), rowsOf(a), `${rowKey}/${field}`, path));
      continue;
    }
    if (!fieldSpec || fieldSpec.ignored) {
      if (fieldSpec?.ignored && !ctx.complete) continue;
      const other = ctx.complete ? [...path, 'Other details'] : path;
      const line = fieldChange(`${rowKey}/${field}`, other, humanizeKey(field), b, a, { label: humanizeKey(field) }, before, after);
      if (line) out.push(line);
      continue;
    }
    const line = fieldChange(`${rowKey}/${field}`, path, fieldSpec.label, b, a, fieldSpec, before, after);
    if (line) out.push(line);
  }
  return out;
}

function cueText(item: Row): string {
  const parts: string[] = [];
  for (const [field, spec] of TEMPLATE_ITEM_FIELDS) {
    const text = formatValue(own(item, field), spec.hint);
    if (text !== null) parts.push(`${spec.label}: ${text}`);
  }
  return parts.join(' · ') || json(item);
}

/** A template's cues, one line per cue added, removed or changed. */
function cueChanges(before: Row[], after: Row[], key: string, path: string[]): FieldChange[] {
  const out: FieldChange[] = [];
  for (let i = 0; i < Math.max(before.length, after.length); i++) {
    if (sameValue(before[i], after[i])) continue;
    let b = before[i] ? cueText(before[i]) : null;
    let a = after[i] ? cueText(after[i]) : null;
    if (b === a) {
      b = rawText(before[i]);
      a = rawText(after[i]);
    }
    out.push({ key: `${key}/${i}`, path, label: `Cue ${i + 1}`, before: b, after: a, change: changeKind(b, a) });
  }
  return out;
}

function questionText(field: Row): string {
  const parts = [str(field.label) || 'Untitled question'];
  if (field.required === true) parts.push('required');
  if (field.multiline === true) parts.push('several lines');
  const hint = str(field.placeholder);
  if (hint) parts.push(`hint “${hint}”`);
  return parts.join(' · ');
}

/** A contract's questions, by id: one line per question added, removed or changed, and their order. */
function questionChanges(before: Row[], after: Row[], key: string, path: string[]): FieldChange[] {
  const out: FieldChange[] = [];
  const idOf = (row: Row, index: number) => (typeof row.id === 'string' ? row.id : `#${index}`);
  const beforeById = new Map(before.map((row, i) => [idOf(row, i), row]));
  const afterById = new Map(after.map((row, i) => [idOf(row, i), row]));
  after.forEach((row, index) => {
    const old = beforeById.get(idOf(row, index));
    if (old && sameValue(old, row)) return;
    let b = old ? questionText(old) : null;
    let a: string | null = questionText(row);
    if (b === a) {
      b = rawText(old);
      a = rawText(row);
    }
    out.push({ key: `${key}/${index}`, path, label: 'Question', before: b, after: a, change: changeKind(b, a) });
  });
  before.forEach((row, index) => {
    if (afterById.has(idOf(row, index))) return;
    out.push({ key: `${key}/${index}`, path, label: 'Question', before: questionText(row), after: null, change: 'removed' });
  });
  const both = (rows: Row[], other: Map<string, Row>) => rows.map(idOf).filter((id) => other.has(id));
  const titles = (id: string) => {
    const row = afterById.get(id) ?? beforeById.get(id);
    return row ? str(row.label) || 'Untitled question' : id;
  };
  const order = orderChange(`${key}#order`, path, both(before, afterById), both(after, beforeById), titles);
  if (order) out.push({ ...order, label: 'Question order' });
  return out;
}

/** Every line for one list of rows: added, changed, removed, and the order. */
function listChanges(spec: ListSpec, listKey: string, before: unknown, after: unknown, prefix: string[], ctx: Ctx): FieldChange[] {
  const out: FieldChange[] = [];
  const label = spec.label(ctx);
  const beforeRows = rowsOf(before);
  const afterRows = rowsOf(after);
  const idOf = (row: Row) => (typeof row[spec.idKey] === 'string' ? (row[spec.idKey] as string) : null);
  const beforeById = new Map<string, Row>();
  for (const row of beforeRows) {
    const id = idOf(row);
    if (id !== null && !beforeById.has(id)) beforeById.set(id, row);
  }
  const afterById = new Map<string, Row>();
  for (const row of afterRows) {
    const id = idOf(row);
    if (id !== null && !afterById.has(id)) afterById.set(id, row);
  }
  const listPath = [...prefix, label];
  for (const [id, row] of afterById) {
    const rowKey = `${listKey}/${seg(id)}`;
    const old = beforeById.get(id);
    const title = spec.title(row);
    if (!old) {
      out.push({ key: rowKey, path: listPath, label: spec.added ?? 'Added', before: null, after: title, change: 'added' });
      if (spec.addedFields !== false) out.push(...rowFieldChanges(spec, undefined, row, rowKey, [...listPath, title], ctx));
      continue;
    }
    if (sameValue(old, row)) continue;
    if (spec.changed) out.push(...spec.changed(old, row, [...listPath, title], rowKey, ctx));
    else out.push(...rowFieldChanges(spec, old, row, rowKey, [...listPath, title], ctx));
  }
  for (const [id, row] of beforeById) {
    if (afterById.has(id)) continue;
    out.push({ key: `${listKey}/${seg(id)}`, path: listPath, label: spec.removed ? spec.removed(row, ctx) : 'Removed', before: spec.title(row), after: null, change: 'removed' });
  }
  const beforeOrder = [...beforeById.keys()].filter((id) => afterById.has(id));
  const afterOrder = [...afterById.keys()].filter((id) => beforeById.has(id));
  const titleOf = (id: string) => spec.title(afterById.get(id) ?? beforeById.get(id)!);
  const order = orderChange(`${listKey}#order`, listPath, beforeOrder, afterOrder, titleOf);
  if (order) out.push(order);
  return out;
}

/** Set-like lists (hidden sections, library tracks left out, show types): one line per item added or removed. */
function setChanges(key: string, path: string[], label: string, before: unknown, after: unknown, name: (item: unknown) => string): FieldChange[] {
  const out: FieldChange[] = [];
  const b = Array.isArray(before) ? before : [];
  const a = Array.isArray(after) ? after : [];
  const itemKey = (item: unknown) => (typeof item === 'string' ? item : JSON.stringify(item) ?? '');
  const inBefore = new Set(b.map(itemKey));
  const inAfter = new Set(a.map(itemKey));
  for (const item of a) {
    if (!inBefore.has(itemKey(item))) out.push({ key: `${key}/${seg(itemKey(item))}`, path, label, before: null, after: name(item), change: 'added' });
  }
  for (const item of b) {
    if (!inAfter.has(itemKey(item))) out.push({ key: `${key}/${seg(itemKey(item))}`, path, label, before: name(item), after: null, change: 'removed' });
  }
  if (out.length === 0 && !sameValue(before, after)) {
    // The same items, reordered or repeated: say so rather than nothing.
    const line = fieldChange(key, path, label, before, after, { label });
    if (line) out.push(line);
  }
  return out;
}

function sectionName(item: unknown): string {
  return typeof item === 'string' && SECTION_NAMES.has(item) ? SECTION_NAMES.get(item)! : plain(item) ?? 'Nothing';
}

// ── Shows ─────────────────────────────────────────────────────────────────

function showTitle(show: Partial<Show> | null | undefined): string {
  return joinTitle([show?.name], '', 'Untitled show');
}

function viewerWord(present: boolean, hadOne: boolean): string {
  return present ? 'On' : hadOne ? 'Withdrawn' : 'Off';
}

function viewerChange(before: unknown, after: unknown): FieldChange | null {
  const had = typeof before === 'string' && before !== '';
  const has = typeof after === 'string' && after !== '';
  if (had === has && (!had || before === after)) return null;
  const b = viewerWord(had, false);
  const a = had && has ? 'New link' : viewerWord(has, had);
  return { key: 'viewToken', path: [], label: 'Viewer link', before: b, after: a, change: has && !had ? 'added' : had && !has ? 'removed' : 'changed' };
}

/** The lines for every key of a show that differs. */
function showChanges(before: Row, after: Row, ctx: Ctx): FieldChange[] {
  const out: FieldChange[] = [];
  const created = Object.keys(before).length === 0;
  const keys = orderedKeys([...SHOW_VALUES.keys(), ...SHOW_LISTS.keys(), ...SHOW_BOOKKEEPING.keys()], before, after);
  for (const key of keys) {
    const b = own(before, key);
    const a = own(after, key);
    if (sameValue(b, a)) continue;
    if (created && (isBlank(a) || a === false)) continue;
    const list = SHOW_LISTS.get(key);
    if (list) {
      out.push(...listChanges(list, key, b, a, [], ctx));
      continue;
    }
    if (key === 'recap' || key === 'completions') {
      const fields = key === 'recap' ? RECAP_FIELDS : null;
      const label = SHOW_VALUES.get(key)!.label;
      for (const sub of orderedKeys(fields ? fields.keys() : SECTION_NAMES.keys(), b, a)) {
        const spec: FieldSpec = fields
          ? fields.get(sub) ?? { label: humanizeKey(sub) }
          : { label: SECTION_NAMES.get(sub) ?? humanizeKey(sub), hint: 'yesno' };
        if (spec.never) continue;
        const sb = own(b, sub);
        const sa = own(a, sub);
        if (created && (isBlank(sa) || sa === false)) continue;
        const line = fieldChange(`${key}/${seg(sub)}`, [label], spec.label, sb, sa, spec);
        if (line) out.push(line);
      }
      continue;
    }
    if (key === 'hiddenSections') {
      out.push(...setChanges(key, [], SHOW_VALUES.get(key)!.label, b, a, sectionName));
      continue;
    }
    if (key === 'djHiddenLibraryIds') {
      const library = ctx.musicLibrary ?? ctx.state?.settings.musicLibrary ?? [];
      const trackName = (item: unknown) => {
        const track = library.find((t) => t.id === item);
        return track ? joinTitle([track.title], '', 'Untitled track') : `Track ${plain(item) ?? ''}`.trim();
      };
      out.push(...setChanges(key, [], SHOW_VALUES.get(key)!.label, b, a, trackName));
      continue;
    }
    if (key === 'viewToken') {
      if (!ctx.complete) continue;
      const line = viewerChange(b, a);
      if (line) out.push(line);
      continue;
    }
    const value = SHOW_VALUES.get(key);
    const bookkeeping = SHOW_BOOKKEEPING.get(key);
    if (bookkeeping?.never) continue;
    if (value) {
      const line = fieldChange(key, [], value.label, b, a, value, before, after);
      if (line) out.push(line);
      continue;
    }
    // Bookkeeping (id, createdAt) and keys the tables do not know.
    if (bookkeeping?.ignored && !ctx.complete) continue;
    const line = fieldChange(key, ctx.complete ? ['Other details'] : [], humanizeKey(key), b, a, { label: humanizeKey(key) });
    if (line) out.push(line);
  }
  return out;
}

function diffShowWith(before: Show | null, after: Show | null, ctx: Ctx): ChangeGroup | null {
  if (!before && !after) return null;
  const show = (after ?? before)!;
  const key = groupKeyForShow(typeof show.id === 'string' ? show.id : '');
  if (!before) {
    const changes = showChanges({}, after as unknown as Row, ctx);
    return { key, title: showTitle(after), note: 'New show', changes };
  }
  if (!after) {
    const changes: FieldChange[] = [{ key: 'show', path: [], label: 'Show', before: showTitle(before), after: null, change: 'removed' }];
    if (typeof before.viewToken === 'string' && before.viewToken !== '') {
      changes.push({ key: 'viewToken', path: [], label: 'Viewer link', before: 'On', after: 'Withdrawn', change: 'removed' });
    }
    return { key, title: showTitle(before), note: 'Show deleted', changes };
  }
  const changes = showChanges(before as unknown as Row, after as unknown as Row, ctx);
  return changes.length > 0 ? { key, title: showTitle(after), changes } : null;
}

/** One group per show; null when nothing differs. before null = new show, after null = deleted show. */
export function diffShow(before: Show | null, after: Show | null, context: DiffContext = {}): ChangeGroup | null {
  return diffShowWith(before, after, context);
}

// ── Settings ──────────────────────────────────────────────────────────────

function settingsGroupTitle(field: string, ctx: Ctx): string {
  if (WORKSPACE.has(field)) return 'Settings';
  const list = SETTINGS_LISTS.get(field);
  return list ? list.label(ctx) : humanizeKey(field);
}

function deletedShowName(id: string, before: Row, after: Row, ctx: Ctx): string {
  for (const settings of [after, before, ctx.state?.settings as unknown as Row | undefined]) {
    for (const row of rowsOf(own(settings, 'trash'))) {
      const data = row.data;
      if (isRow(data) && data.id === id) return `“${showTitle(data as Partial<Show>)}”`;
    }
  }
  const show = ctx.state?.shows.find((s) => s.id === id);
  return show ? `“${showTitle(show)}”` : 'A show';
}

function settingsFieldChanges(field: string, b: unknown, a: unknown, before: Row, after: Row, ctx: Ctx): FieldChange[] {
  const list = SETTINGS_LISTS.get(field);
  if (list) {
    // Producers sit in the Settings group, under their own heading; every
    // other list is a group of its own, headed by its name.
    return listChanges(list, field, b, a, [], ctx);
  }
  if (field === 'showTypes') {
    return setChanges(field, [], WORKSPACE_VALUES.get(field)!.label, b, a, (item) => plain(item) ?? 'Nothing');
  }
  if (field === 'deletedShowIds') {
    if (!ctx.complete) return [];
    const label = WORKSPACE_VALUES.get(field)!.label;
    return setChanges(field, [], label, b, a, (item) => `${deletedShowName(String(item), before, after, ctx)} stays deleted`);
  }
  const spec = WORKSPACE_VALUES.get(field);
  if (spec?.ignored && !ctx.complete) return [];
  const line = fieldChange(field, [], spec?.label ?? humanizeKey(field), b, a, spec ?? { label: humanizeKey(field) });
  return line ? [line] : [];
}

function diffSettingsWith(before: Partial<AppSettings>, after: Partial<AppSettings>, ctx: Ctx): ChangeGroup[] {
  const b = before as unknown as Row;
  const a = after as unknown as Row;
  const groups = new Map<string, ChangeGroup>();
  for (const field of orderedKeys(SETTINGS_GROUP_ORDER, b, a)) {
    const bv = own(b, field);
    const av = own(a, field);
    if (sameValue(bv, av)) continue;
    const changes = settingsFieldChanges(field, bv, av, b, a, ctx);
    if (changes.length === 0) continue;
    const key = groupKeyForSettings(field as SettingsKey);
    const group = groups.get(key) ?? { key, title: settingsGroupTitle(field, ctx), changes: [] };
    group.changes.push(...changes);
    groups.set(key, group);
  }
  return [...groups.values()];
}

/** One group per changed top-level field, in the settings order (the Settings-group fields share 'settings:workspace'). */
export function diffSettings(before: Partial<AppSettings>, after: Partial<AppSettings>, context: DiffContext = {}): ChangeGroup[] {
  return diffSettingsWith(before, after, context);
}

// ── Requests ──────────────────────────────────────────────────────────────

function stateShow(id: string, ctx: Ctx): Show | undefined {
  return ctx.state?.shows.find((show) => show.id === id);
}

function quotedShow(id: string | undefined, ctx: Ctx): string | null {
  if (id === undefined) return null;
  const show = stateShow(id, ctx);
  return show ? `“${showTitle(show)}”` : null;
}

function describeShowEdit(edit: ShowEdit, ctx: Ctx): ChangeGroup | null {
  if (edit.op === 'create') {
    const group = diffShowWith(null, edit.show, ctx);
    if (group && ctx.restored?.has(edit.showId)) group.note = 'Restored';
    return group;
  }
  if (edit.op === 'delete') return diffShowWith(edit.base, null, ctx);
  const current = stateShow(edit.showId, ctx);
  const before: Row = { ...(current as unknown as Row | undefined), id: edit.showId };
  for (const key of edit.keys) {
    if (Object.prototype.hasOwnProperty.call(edit.base, key)) before[key] = (edit.base as Row)[key];
    else delete before[key];
  }
  const after: Row = { ...before };
  for (const key of edit.keys) {
    if (Object.prototype.hasOwnProperty.call(edit.proposed, key)) after[key] = (edit.proposed as Row)[key];
    else delete after[key];
  }
  return diffShowWith(before as unknown as Show, after as unknown as Show, ctx);
}

function describeSettingsEdit(payload: Extract<RequestPayload, { kind: 'edit' }>, ctx: Ctx): ChangeGroup[] {
  const settings = payload.settings;
  if (!settings) return [];
  const before: Row = {};
  const after: Row = {};
  for (const edit of settings.fields) {
    if (edit.kind === 'value') {
      if (Object.prototype.hasOwnProperty.call(edit, 'base')) before[edit.field] = edit.base;
      if (Object.prototype.hasOwnProperty.call(edit, 'proposed')) after[edit.field] = edit.proposed;
      continue;
    }
    const idField = SETTINGS_ROW_FIELDS.get(edit.field) ?? edit.idField;
    const current = new Map<string, unknown>();
    for (const row of rowsOf(own(ctx.state?.settings, edit.field))) {
      const id = row[idField];
      if (typeof id === 'string' && !current.has(id)) current.set(id, row);
    }
    const base = new Map(edit.base);
    const proposed = new Map(edit.proposed);
    before[edit.field] = edit.baseOrder.map((id) => base.get(id) ?? current.get(id)).filter(isRow);
    after[edit.field] = edit.proposedOrder.map((id) => proposed.get(id) ?? base.get(id) ?? current.get(id)).filter(isRow);
  }
  return diffSettingsWith(before as Partial<AppSettings>, after as Partial<AppSettings>, ctx);
}

/** Shows a request brings back: creates of a show whose id is in Recently deleted, with that row removed. */
function restoredIds(payload: Extract<RequestPayload, { kind: 'edit' }>, ctx: Ctx): Set<string> {
  const trashEdit = payload.settings?.fields.find((field) => field.field === 'trash');
  const removed = new Set<string>();
  if (trashEdit && trashEdit.kind === 'rows') {
    const kept = new Set(trashEdit.proposedOrder);
    const base = new Map(trashEdit.base);
    const current = new Map(rowsOf(ctx.state?.settings.trash).map((row) => [row.id, row]));
    for (const id of trashEdit.baseOrder) {
      if (kept.has(id)) continue;
      const row = base.get(id) ?? current.get(id);
      const data = isRow(row) ? row.data : undefined;
      if (isRow(data) && typeof data.id === 'string') removed.add(data.id);
    }
  }
  const out = new Set<string>();
  for (const edit of payload.shows) if (edit.op === 'create' && removed.has(edit.showId)) out.add(edit.showId);
  return out;
}

/** Everything a request asks for, as groups. */
export function describePayload(payload: RequestPayload, context: DiffContext = {}): ChangeGroup[] {
  if (payload.kind === 'edit') {
    const ctx: Ctx = { ...context, restored: restoredIds(payload, context) };
    const groups: ChangeGroup[] = [];
    for (const edit of payload.shows) {
      const group = describeShowEdit(edit, ctx);
      if (group && group.changes.length > 0) groups.push(group);
    }
    return [...groups, ...describeSettingsEdit(payload, ctx)];
  }
  const facts = factsOf(payload.action);
  const { sentence, handOver } = describeAction(facts, context, payload.action);
  const word = payload.kind === 'share' ? 'Share' : 'Download';
  return [{
    key: payload.kind,
    title: word,
    changes: [{ key: payload.action.type, path: [], label: word, before: null, after: sentence, change: 'added' }],
    handOver,
  }];
}

// ── Shares and downloads in words ─────────────────────────────────────────

/** What an action is about, from a whole action or from an outline (which has no free text). */
interface ActionFacts {
  type: ShareAction['type'] | DownloadAction['type'];
  showId?: string;
  contractId?: string;
  contactId?: string;
  agreementId?: string;
  requestIds?: string[];
  subject?: HeadshotSubject;
  source?: string;
  includesGuests?: boolean;
}

function factsOf(action: ShareAction | DownloadAction): ActionFacts {
  const facts: ActionFacts = { type: action.type };
  switch (action.type) {
    case 'copy-text':
    case 'email':
      facts.source = action.source;
      facts.showId = action.showId;
      break;
    case 'signing-link':
      facts.contractId = action.contractId;
      facts.contactId = action.signer.contactId;
      break;
    case 'existing-signing-link':
      facts.requestIds = action.requestIds;
      break;
    case 'existing-profile-link':
      facts.requestIds = [action.requestId];
      break;
    case 'profile-link':
      facts.contactId = action.contactId;
      break;
    case 'headshot':
      facts.subject = action.subject;
      break;
    case 'headshot-pack':
      facts.showId = action.showId;
      facts.includesGuests = action.includesGuests;
      break;
    case 'signed-agreement':
      facts.agreementId = action.agreementId;
      break;
    case 'backup':
      break;
    default:
      facts.showId = action.showId;
  }
  return facts;
}

function factsOfOutline(action: NonNullable<RequestOutline['action']>): ActionFacts {
  const parts = action.key.split(':');
  const facts: ActionFacts = {
    type: action.type,
    showId: action.showId,
    contractId: action.contractId,
    contactId: action.contactId,
    agreementId: action.agreementId,
    requestIds: action.requestIds,
    subject: action.subject,
  };
  if (action.type === 'copy-text' || action.type === 'email') facts.source = parts[2];
  if (action.type === 'headshot-pack') facts.includesGuests = parts[3] === 'with-guests';
  return facts;
}

const NOT_FOUND = '(not found)';
const GONE = 'Not in your account any more';

function contactName(id: string | undefined, ctx: Ctx): string | null {
  if (id === undefined) return null;
  const comic = ctx.state?.settings.potentialComics.find((c) => c.id === id);
  return comic ? joinTitle([comic.name], '', 'Unnamed') : null;
}

function personName(subject: HeadshotSubject, ctx: Ctx): { name: string | null; photo?: string } {
  if (subject.kind === 'contact') {
    const comic = ctx.state?.settings.potentialComics.find((c) => c.id === subject.contactId);
    return comic ? { name: joinTitle([comic.name], '', 'Unnamed'), photo: comic.photo } : { name: null };
  }
  const show = stateShow(subject.showId, ctx);
  const people = subject.kind === 'performer' ? show?.performers : show?.artists;
  const person = people?.find((p) => p.id === subject.personId);
  return person ? { name: joinTitle([person.name], '', 'Unnamed'), photo: person.photo } : { name: null };
}

function emailSentence(href: string | undefined, ctx: Ctx): { sentence: string; details: HandOver['details'] } | null {
  if (href === undefined) return null;
  const mail = parseMailto(href);
  if (!mail) return { sentence: 'Open an email', details: [{ label: 'Link', value: visibleText(href) }] };
  const everyone = [...mail.to, ...mail.cc, ...mail.bcc];
  let sentence: string;
  if (everyone.length === 1) {
    const address = everyone[0].toLowerCase();
    const people = [
      ...(ctx.state?.settings.potentialComics ?? []),
      ...(ctx.state?.shows ?? []).flatMap((show) => [...show.performers, ...show.artists]),
    ];
    const person = people.find((p) => (p.email ?? '').trim().toLowerCase() === address);
    sentence = `Open an email to ${person ? joinTitle([person.name], '', visibleText(everyone[0])) : visibleText(everyone[0])}`;
  } else {
    sentence = `Open an email to ${everyone.length} people`;
  }
  const details: HandOver['details'] = [];
  const recipients = (label: string, list: string[]) => {
    if (list.length > 0) details.push({ label, value: visibleText(`${list.length}: ${list.join(', ')}`) });
  };
  recipients('To', mail.to);
  recipients('Cc', mail.cc);
  recipients('Bcc', mail.bcc);
  if (mail.subject) details.push({ label: 'Subject', value: visibleText(mail.subject) });
  if (mail.body) details.push({ label: 'Body', value: visibleText(mail.body) });
  return { sentence, details };
}

/** The sentence and hand-over for one action, every name from the reader's own data. */
function describeAction(facts: ActionFacts, ctx: Ctx, action?: ShareAction | DownloadAction): { sentence: string; handOver: HandOver } {
  const show = quotedShow(facts.showId, ctx);
  const showWords = show ?? NOT_FOUND;
  const missing = (sentence: string): { sentence: string; handOver: HandOver } => ({ sentence, handOver: { what: GONE, details: [] } });
  switch (facts.type) {
    case 'copy-text': {
      const sentence =
        facts.source === 'announce-post' ? `Copy the post for ${showWords}`
        : facts.source === 'announce-tags' ? `Copy the tags for ${showWords}`
        : 'Copy the season pitch';
      const text = action?.type === 'copy-text' ? action.text : undefined;
      if (facts.source !== 'season-pitch' && facts.showId !== undefined && !show) return missing(sentence);
      return { sentence, handOver: { what: sentence, details: text === undefined ? [] : [{ label: 'Text', value: visibleText(text) }] } };
    }
    case 'email': {
      const mail = emailSentence(action?.type === 'email' ? action.href : undefined, ctx);
      if (mail) return { sentence: mail.sentence, handOver: { what: mail.sentence.replace(/^Open an email/, 'An email'), details: mail.details } };
      const sentence =
        facts.source === 'lineup' ? `Open an email to the lineup of ${showWords}`
        : facts.source === 'rolodex-all' ? `Open an email to everyone in the ${(ctx.rolodexPlural || 'Rolodex')}`
        : 'Open an email';
      return { sentence, handOver: { what: sentence, details: [] } };
    }
    case 'signing-link': {
      const contract = ctx.state?.settings.contracts.find((c) => c.id === facts.contractId);
      const contractWords = contract ? `“${joinTitle([contract.name], '', 'Untitled contract')}”` : NOT_FOUND;
      const signer = action?.type === 'signing-link' ? action.signer : undefined;
      const entry = contactName(facts.contactId, ctx);
      const who = signer ? visibleText(signer.name.trim()) : entry ?? 'someone';
      const sentence = `Send ${contractWords} to ${who} to sign`;
      if (!contract) return missing(sentence);
      const details: HandOver['details'] = [{ label: 'Contract', value: joinTitle([contract.name], '', 'Untitled contract') }];
      if (signer) {
        details.push({ label: 'Signer', value: `${visibleText(signer.name.trim())} (as typed by them)` });
        if (signer.email) details.push({ label: 'Email', value: visibleText(signer.email.trim()) });
      }
      if (entry) {
        const differs = signer && entry.toLowerCase() !== visibleText(signer.name.trim()).toLowerCase();
        details.push({ label: 'Rolodex entry', value: differs ? `${entry} (differs from the name typed)` : entry });
      }
      return { sentence, handOver: { what: `A signing link for ${contractWords}`, details } };
    }
    case 'existing-signing-link': {
      const ids = facts.requestIds ?? [];
      const requests = ctx.state?.settings.signatureRequests ?? [];
      const found = ids.map((id) => requests.find((r) => r.id === id));
      const line = (r: (typeof requests)[number] | undefined) =>
        r
          ? `${joinTitle([r.signerName], '', 'Someone')} — ${joinTitle([r.contractName], '', 'a contract')} (${r.signed ? 'signed' : 'not signed yet'})`
          : 'A link that’s no longer there';
      const details = found.map((r) => ({ label: 'Link', value: line(r) }));
      if (ids.length === 1) {
        const r = found[0];
        const sentence = r
          ? `Pass on ${joinTitle([r.signerName], '', 'someone')}’s signing link for “${joinTitle([r.contractName], '', 'a contract')}”`
          : `Pass on a signing link ${NOT_FOUND}`;
        if (!r) return missing(sentence);
        return { sentence, handOver: { what: sentence.replace(/^Pass on /, ''), details } };
      }
      const sentence = `Pass on ${ids.length} signing links`;
      if (found.every((r) => !r)) return missing(sentence);
      return { sentence, handOver: { what: `${ids.length} signing links`, details } };
    }
    case 'profile-link': {
      const name = contactName(facts.contactId, ctx);
      const sentence = `Ask ${name ?? NOT_FOUND} for their details`;
      if (!name) return missing(sentence);
      return { sentence, handOver: { what: `A details link for ${name}`, details: [{ label: 'Rolodex entry', value: name }] } };
    }
    case 'existing-profile-link': {
      const id = facts.requestIds?.[0];
      const request = ctx.state?.settings.profileRequests?.find((r) => r.id === id);
      const name = request ? joinTitle([request.personName], '', 'someone') : null;
      const sentence = `Pass on ${name ? `${name}’s` : NOT_FOUND} details link`;
      if (!request) return missing(sentence);
      return {
        sentence,
        handOver: {
          what: `${name}’s details link`,
          details: [
            { label: 'Sent', value: timestampDate(request.sentAt) },
            { label: 'Answered', value: request.submitted ? 'Yes' : 'No' },
          ],
        },
      };
    }
    case 'viewer-link': {
      const sentence = `Share the viewer link for ${showWords}`;
      const target = facts.showId !== undefined ? stateShow(facts.showId, ctx) : undefined;
      if (!target) return missing(sentence);
      return {
        sentence,
        handOver: {
          what: `The viewer link for ${showWords}`,
          details: [
            { label: 'Link', value: target.viewToken ? 'Already made' : 'Made when you approve' },
            { label: 'Viewer page note', value: formatValue(target.viewNote) ?? 'Nothing' },
          ],
        },
      };
    }
    case 'backup':
      return { sentence: 'Download a backup of everything', handOver: { what: 'Every show, the Rolodex, contracts and settings, as one file', details: [] } };
    case 'headshot': {
      const person = facts.subject ? personName(facts.subject, ctx) : { name: null };
      const sentence = `Download ${person.name ? `${person.name}’s` : NOT_FOUND} headshot`;
      if (!person.name) return missing(sentence);
      const handOver: HandOver = { what: `${person.name}’s headshot`, details: [] };
      if (person.photo) handOver.media = { kind: 'image', ref: person.photo };
      return { sentence, handOver };
    }
    case 'headshot-pack': {
      const sentence = `Download the headshots for ${showWords}${facts.includesGuests ? ', surprise guests included' : ''}`;
      const target = facts.showId !== undefined ? stateShow(facts.showId, ctx) : undefined;
      if (!target) return missing(sentence);
      const people = target.performers.filter((p) => facts.includesGuests || p.surpriseGuest !== true);
      return {
        sentence,
        handOver: {
          what: `The headshots for ${showWords}`,
          details: [{ label: 'People', value: people.map((p) => joinTitle([p.name], '', 'Unnamed')).join(', ') || 'Nobody yet' }],
        },
      };
    }
    case 'flyer': {
      const sentence = `Download the flyer for ${showWords}`;
      const target = facts.showId !== undefined ? stateShow(facts.showId, ctx) : undefined;
      if (!target) return missing(sentence);
      const handOver: HandOver = { what: `The flyer for ${showWords}`, details: [] };
      if (target.flyer) handOver.media = { kind: 'image', ref: target.flyer };
      return { sentence, handOver };
    }
    case 'signed-agreement': {
      const agreement = ctx.state?.settings.signedAgreements?.find((a) => a.id === facts.agreementId);
      const name = agreement ? `“${joinTitle([agreement.name], '', 'Untitled agreement')}”` : NOT_FOUND;
      const sentence = `Download ${name}`;
      if (!agreement) return missing(sentence);
      return { sentence, handOver: { what: name, details: [{ label: 'File', value: joinTitle([agreement.fileName], '', 'Nothing') }] } };
    }
    case 'dj-list-text':
    case 'runsheet-pdf':
    case 'dj-list-pdf': {
      const sentence =
        facts.type === 'dj-list-text' ? `Download the DJ list for ${showWords} as text`
        : facts.type === 'runsheet-pdf' ? `Print or save the run sheet for ${showWords}`
        : `Print or save the DJ list for ${showWords}`;
      if (!show) return missing(sentence);
      const what =
        facts.type === 'dj-list-text' ? `The DJ list for ${show}, as text`
        : facts.type === 'runsheet-pdf' ? `The run sheet for ${show}`
        : `The DJ list for ${show}`;
      return { sentence, handOver: { what, details: [] } };
    }
  }
}

function lowerFirst(text: string): string {
  return text ? text[0].toLowerCase() + text.slice(1) : text;
}

/** A lowercase verb phrase that reads after "You asked to" or "Sam asked to", from the outline and the reader's own data. */
export function headline(outline: RequestOutline, context: DiffContext = {}): string {
  if (outline.kind !== 'edit') {
    return outline.action ? lowerFirst(describeAction(factsOfOutline(outline.action), context).sentence) : 'do something';
  }
  const shows = outline.shows ?? [];
  const fields = outline.settingsFields ?? [];
  const groups = new Set(fields.map((field) => groupKeyForSettings(field)));
  const nameOf = (id: string) => quotedShow(id, context) ?? 'a show';
  if (shows.length === 1) {
    const only = shows[0];
    if (only.op === 'update') return `change ${nameOf(only.id)}`;
    if (groups.size === 0 && only.op === 'create') {
      return only.createName && only.createName.trim() ? `add the show “${visibleText(only.createName.trim())}”` : 'add a show';
    }
    if (groups.size === 0 && only.op === 'delete') return `delete ${nameOf(only.id)}`;
  }
  if (shows.length === 0 && groups.size === 1) return `change ${settingsGroupTitle(fields[0], context).toLowerCase()}`;
  const count = shows.length + groups.size;
  return `make ${count} change${count === 1 ? '' : 's'}`;
}

// ── Conflicts ─────────────────────────────────────────────────────────────

function unseg(part: string): string {
  try {
    return decodeURIComponent(part);
  } catch {
    return part;
  }
}

/** A value in words for a conflict: one side at a time. */
function conflictValue(raw: unknown, spec: FieldSpec, row?: Row): string | null {
  const kind = mediaKindOf(spec.hint);
  if (kind) {
    if (typeof raw !== 'string' || raw.trim() === '') return null;
    const name = spec.name ? str(own(row, spec.name)) : '';
    return `${MEDIA_WORDS[kind].onFile}${name ? `: ${name}` : ''}`;
  }
  return formatValue(raw, spec.hint);
}

function rowText(row: unknown, spec: ListSpec): string | null {
  if (!isRow(row)) return row === undefined ? null : plain(row);
  const lines = [spec.title(row)];
  for (const [field, fieldSpec] of spec.fields) {
    if (fieldSpec.never || fieldSpec.ignored || fieldSpec.hint === 'cues' || fieldSpec.hint === 'questions') continue;
    const text = conflictValue(own(row, field), fieldSpec, row);
    if (text !== null && fieldSpec.hint !== 'yesno') lines.push(`${fieldSpec.label}: ${text}`);
  }
  return lines.join('\n');
}

/** A merge conflict in words, with the same labels and value formatting as diffShow and diffSettings. */
export function describeConflict(raw: RawConflict, context: DiffContext = {}): Conflict {
  const out = (path: string[], label: string, format: (value: unknown) => string | null): Conflict => ({
    groupKey: raw.groupKey,
    key: raw.path,
    path,
    label,
    asked: format(raw.base),
    now: format(raw.current),
    proposed: format(raw.proposed),
  });
  const ordered = raw.path.endsWith('#order');
  const parts = (ordered ? raw.path.slice(0, -'#order'.length) : raw.path).split('/');
  const top = unseg(parts[0] ?? '');
  const showId = raw.groupKey.startsWith('show:') ? raw.groupKey.slice('show:'.length) : null;
  const container: Row | undefined = showId !== null
    ? (stateShow(showId, context) as unknown as Row | undefined)
    : (context.state?.settings as unknown as Row | undefined);
  const lists = showId !== null ? SHOW_LISTS : SETTINGS_LISTS;
  const list = lists.get(top);

  if (top === 'show' && parts.length === 1) return out([], 'Show', (value) => (isRow(value) ? showTitle(value as Partial<Show>) : plain(value)));

  if (list) {
    const label = list.label(context);
    const rows = rowsOf(own(container, top));
    const titleOf = (id: string) => {
      const row = rows.find((r) => r[list.idKey] === id);
      return row ? list.title(row) : visibleText(id);
    };
    if (ordered) {
      return out([label], 'Order', (value) => (Array.isArray(value) ? value.map((id) => titleOf(String(id))).join(', ') : plain(value)));
    }
    if (parts.length === 1) return out([], label, (value) => plain(value));
    const id = unseg(parts[1]);
    const rowFrom = (value: unknown) => (isRow(value) ? value : undefined);
    const title = (() => {
      const known = rows.find((r) => r[list.idKey] === id);
      if (known) return list.title(known);
      const fromRaw = rowFrom(raw.proposed) ?? rowFrom(raw.base) ?? rowFrom(raw.current);
      return fromRaw && parts.length === 2 ? list.title(fromRaw) : visibleText(id);
    })();
    if (parts.length === 2) return out([label], title, (value) => rowText(value, list));
    const field = unseg(parts[2]);
    const spec = list.fields.get(field) ?? { label: humanizeKey(field) };
    const row = rows.find((r) => r[list.idKey] === id);
    const path = spec.ignored || !list.fields.has(field) ? [label, title, 'Other details'] : [label, title];
    return out(path, spec.ignored ? humanizeKey(field) : spec.label, (value) => conflictValue(value, spec, row));
  }

  if (showId !== null) {
    if ((top === 'recap' || top === 'completions') && parts.length >= 2) {
      const sub = unseg(parts[1]);
      const spec: FieldSpec = top === 'recap'
        ? RECAP_FIELDS.get(sub) ?? { label: humanizeKey(sub) }
        : { label: SECTION_NAMES.get(sub) ?? humanizeKey(sub), hint: 'yesno' };
      return out([SHOW_VALUES.get(top)!.label], spec.label, (value) => conflictValue(value, spec));
    }
    if (top === 'viewToken') {
      return out([], 'Viewer link', (value) => (typeof value === 'string' && value !== '' ? 'On' : 'Off'));
    }
    const spec = SHOW_VALUES.get(top);
    if (spec) return out([], spec.label, (value) => conflictValue(value, spec, container));
    return out(context.complete ? ['Other details'] : [], humanizeKey(top), (value) => plain(value));
  }

  const spec = WORKSPACE_VALUES.get(top) ?? { label: humanizeKey(top) };
  return out([], spec.label, (value) => conflictValue(value, spec));
}

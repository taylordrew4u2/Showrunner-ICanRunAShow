/**
 * The strict schema for everything that crosses between the two producers.
 *
 * It is src/types read leaf by leaf, and it runs two ways:
 *
 * - Drop mode (sanitizeShow, sanitizeSettings) on what a co-producer is
 *   served. The owner's data is the owner's, so nothing is refused: a leaf
 *   of the wrong type, an unknown key or an unknown enum value is removed
 *   (a required one is replaced by its type's default), and lengths are not
 *   capped, so long notes and big lists arrive whole. What is left is what
 *   the co-producer's screens are built to render.
 * - Refuse mode (validatePayload) on what a co-producer asks for. Anything
 *   of the wrong type anywhere refuses the request; every value the request
 *   changes must also be within its caps, a file must be one uploaded for
 *   approval rather than embedded, and a link must not point back into the
 *   app's own sign-in or API. The server runs it when a request arrives and
 *   the owner's app runs it again before showing or applying one.
 *
 * Strings may hold any text, `<` and quotes included: escaping is the
 * renderer's job (pdfExport, React). The schema guarantees types and sizes.
 *
 * No DOM and no Node: the server imports this too.
 */
import type { AppSettings, Show } from '../types';
import { healShow } from '../utils/showHealing';
import { sameValue } from './paths';
import { checkUntrusted, FORBIDDEN_KEYS } from './untrusted';
import {
  COPRODUCER_LIMITS,
  DOWNLOAD_TYPES,
  REDACTED_TOKEN_PREFIX,
  REMOVE_ONLY_ROW_FIELDS,
  SETTINGS_DERIVED_FIELDS,
  SETTINGS_ROW_FIELDS,
  SHARE_TYPES,
  type EditPayload,
  type RequestPayload,
  type SettingsKey,
  type ShowKey,
} from './types';

export interface SchemaProblem { path: string; problem: string }
export interface ValidateContext {
  /** Origins a URL field may not point at, except a public page: the app's own and the review origin. */
  appOrigins: string[];
}

// ── Leaves and shapes ─────────────────────────────────────────────────────

type Leaf =
  | { t: 'showId' }
  | { t: 'rowId' }
  | { t: 'short' }
  | { t: 'long' }
  | { t: 'timestamp' }
  | { t: 'money' }
  | { t: 'count'; max: number }
  | { t: 'seconds' }
  | { t: 'minutes' }
  | { t: 'order' }
  | { t: 'flag' }
  | { t: 'enum'; values: readonly string[] }
  | { t: 'media' }
  | { t: 'url' };
interface Field { node: Shape; required: boolean }
interface ObjectShape { t: 'object'; fields: ReadonlyMap<string, Field> }
/** `idKey`: the field rows are known by, for unique ids and for lining rows up with their base. */
interface ListShape { t: 'list'; of: Shape; max: number; idKey?: string }
type Shape = Leaf | ObjectShape | ListShape;

const SHOW_ID: Leaf = { t: 'showId' };
const ROW_ID: Leaf = { t: 'rowId' };
const SHORT: Leaf = { t: 'short' };
const LONG: Leaf = { t: 'long' };
const TIMESTAMP: Leaf = { t: 'timestamp' };
const MONEY: Leaf = { t: 'money' };
const SECONDS: Leaf = { t: 'seconds' };
const MINUTES: Leaf = { t: 'minutes' };
const ORDER: Leaf = { t: 'order' };
const FLAG: Leaf = { t: 'flag' };
const MEDIA: Leaf = { t: 'media' };
const URL_LEAF: Leaf = { t: 'url' };
const count = (max: number): Leaf => ({ t: 'count', max });
const oneOf = (values: readonly string[]): Leaf => ({ t: 'enum', values });
const list = (of: Shape, max = 1000, idKey?: string): ListShape => ({ t: 'list', of, max, idKey });
const rows = (of: Shape, max = 1000): ListShape => list(of, max, 'id');

/** A field that must be there. */
function req(node: Shape): Field {
  return { node, required: true };
}
function object(fields: Record<string, Shape | Field>): ObjectShape {
  const map = new Map<string, Field>();
  for (const [key, spec] of Object.entries(fields)) {
    map.set(key, 'required' in spec && 'node' in spec ? spec : { node: spec as Shape, required: false });
  }
  return { t: 'object', fields: map };
}

const SECTION_KEYS = ['basic', 'performers', 'artists', 'schedule', 'hosts', 'dj', 'staff', 'vendors', 'expenses', 'scenes', 'recap'] as const;
const SHOW_STATUSES = ['upcoming', 'in-progress', 'completed', 'cancelled'] as const;
const SCENE_STATUSES = ['planned', 'rehearsed', 'filmed', 'done'] as const;

const PERSON_FIELDS = {
  id: req(ROW_ID),
  comicId: ROW_ID,
  name: req(SHORT),
  photo: MEDIA,
  socialMedia: SHORT,
  email: SHORT,
  phone: SHORT,
  notes: LONG,
  walkOnMusic: MEDIA,
  walkOnMusicName: SHORT,
  walkOnMusicArtist: SHORT,
  walkOnMusicTimestamp: SHORT,
  walkOnMusicLink: URL_LEAF,
  walkOnStartSec: SECONDS,
  walkOnEndSec: SECONDS,
  credits: LONG,
  videoLink: URL_LEAF,
  surpriseGuest: FLAG,
};
const PERFORMER = object(PERSON_FIELDS);
const ARTIST = object({ ...PERSON_FIELDS, artistType: SHORT });
const SCHEDULE_ITEM = object({
  id: req(ROW_ID),
  time: req(SHORT),
  description: req(LONG),
  performer: SHORT,
  durationMin: MINUTES,
  performerId: ROW_ID,
  music: MEDIA,
  musicName: SHORT,
  musicDuration: SECONDS,
  musicStartSec: SECONDS,
  musicEndSec: SECONDS,
});
const HOST = object({ id: req(ROW_ID), name: req(SHORT), notes: LONG, isHosting: req(FLAG) });
const DJ_SONG = object({
  id: req(ROW_ID),
  title: req(SHORT),
  artist: req(SHORT),
  notes: LONG,
  music: MEDIA,
  musicName: SHORT,
  libraryId: ROW_ID,
  startSec: SECONDS,
  endSec: SECONDS,
});
const STAFF = object({ id: req(ROW_ID), role: req(SHORT), personName: req(SHORT), phone: SHORT });
const VENDOR = object({
  id: req(ROW_ID),
  name: req(SHORT),
  category: SHORT,
  contactName: SHORT,
  phone: SHORT,
  email: SHORT,
  website: URL_LEAF,
  cost: MONEY,
  notes: LONG,
  booked: FLAG,
});
const EXPENSE = object({ id: req(ROW_ID), category: req(SHORT), itemName: req(SHORT), cost: req(MONEY), date: SHORT, notes: LONG });
const SCENE = object({
  id: req(ROW_ID),
  title: req(SHORT),
  description: req(LONG),
  duration: req(MINUTES),
  status: req(oneOf(SCENE_STATUSES)),
  order: req(ORDER),
});
const RECAP = object({
  attendance: count(10_000_000),
  ticketSales: MONEY,
  merchSales: MONEY,
  otherCosts: MONEY,
  performerNotes: LONG,
  improvementNotes: LONG,
  profitLoss: MONEY,
});
const COMPLETIONS = object(Object.fromEntries(SECTION_KEYS.map((key) => [key, FLAG])));
const TODO = object({ id: req(ROW_ID), text: req(LONG), completed: req(FLAG) });

const SHOW = object({
  id: req(SHOW_ID),
  name: req(SHORT),
  date: req(SHORT),
  time: req(SHORT),
  location: req(SHORT),
  venueName: req(SHORT),
  status: req(oneOf(SHOW_STATUSES)),
  ticketLink: URL_LEAF,
  flyer: MEDIA,
  performers: req(rows(PERFORMER)),
  artists: req(rows(ARTIST)),
  schedule: req(rows(SCHEDULE_ITEM)),
  hosts: req(rows(HOST)),
  djSongs: req(rows(DJ_SONG)),
  djHiddenLibraryIds: list(ROW_ID, 5000),
  staff: req(rows(STAFF)),
  vendors: rows(VENDOR),
  expenses: req(rows(EXPENSE)),
  scenes: rows(SCENE),
  recap: RECAP,
  completions: COMPLETIONS,
  hiddenSections: list(oneOf(SECTION_KEYS)),
  performerTarget: count(1000),
  productionNotes: LONG,
  host: SHORT,
  todos: rows(TODO),
  viewToken: SHORT,
  viewerKey: SHORT,
  viewNote: LONG,
  sample: FLAG,
  createdAt: req(TIMESTAMP),
  updatedAt: req(TIMESTAMP),
});

const PRODUCER = object({ id: req(ROW_ID), name: req(SHORT), role: req(SHORT) });
const DELETED_ITEM = object({ id: req(ROW_ID), type: req(oneOf(['show'])), data: req(SHOW), deletedAt: req(TIMESTAMP) });
const COMIC = object({
  id: req(ROW_ID),
  name: req(SHORT),
  notes: LONG,
  socialMedia: SHORT,
  email: SHORT,
  phone: SHORT,
  photo: MEDIA,
  credits: LONG,
  walkOnMusic: MEDIA,
  walkOnMusicName: SHORT,
  walkOnMusicArtist: SHORT,
  walkOnMusicTimestamp: SHORT,
  walkOnMusicLink: URL_LEAF,
  walkOnStartSec: SECONDS,
  walkOnEndSec: SECONDS,
  videoLink: URL_LEAF,
});
const EMAIL_ENTRY = object({ id: req(ROW_ID), email: req(SHORT), addedAt: req(TIMESTAMP) });
const TEMPLATE_ITEM = object({ time: req(SHORT), description: req(LONG), performer: SHORT, durationMin: MINUTES });
const TEMPLATE = object({ id: req(ROW_ID), name: req(SHORT), items: req(list(TEMPLATE_ITEM, 500)), createdAt: req(TIMESTAMP) });
const TRACK = object({
  id: req(ROW_ID),
  title: req(SHORT),
  artist: req(SHORT),
  notes: LONG,
  music: req(MEDIA),
  musicName: SHORT,
  addedAt: req(TIMESTAMP),
  startSec: SECONDS,
  endSec: SECONDS,
});
const AGREEMENT = object({
  id: req(ROW_ID),
  name: req(SHORT),
  category: req(oneOf(['venue', 'producer'])),
  counterparty: req(SHORT),
  fileRef: req(MEDIA),
  fileName: req(SHORT),
  sizeBytes: req(count(10_000_000_000)),
  uploadedAt: req(TIMESTAMP),
});
const CONTRACT_FIELD = object({ id: req(ROW_ID), label: req(SHORT), placeholder: SHORT, required: FLAG, multiline: FLAG });
const CONTRACT = object({
  id: req(ROW_ID),
  name: req(SHORT),
  fileRef: req(MEDIA),
  fileName: req(SHORT),
  sizeBytes: req(count(10_000_000_000)),
  uploadedAt: req(TIMESTAMP),
  fields: rows(CONTRACT_FIELD, 100),
});
const ANSWER = object({ label: req(SHORT), value: req(LONG) });
const SIGNATURE_RECORD = object({
  signedAt: req(TIMESTAMP),
  typedName: req(SHORT),
  signerName: SHORT,
  fields: list(ANSWER, 200),
  headshot: MEDIA,
  cancellationRuleAcknowledged: LONG,
  documentHash: req(SHORT),
  userAgent: SHORT,
});
const SIGNATURE_REQUEST = object({
  id: req(ROW_ID),
  token: req(SHORT),
  key: req(SHORT),
  contractId: req(ROW_ID),
  contractName: req(SHORT),
  contactId: ROW_ID,
  signerName: req(SHORT),
  signerEmail: SHORT,
  sentAt: req(TIMESTAMP),
  signed: SIGNATURE_RECORD,
  profileFiled: FLAG,
});
const SUBMISSION = object({ submittedAt: req(TIMESTAMP), typedName: req(SHORT), fields: req(list(ANSWER, 200)), photoChunks: count(64) });
const PROFILE_REQUEST = object({
  id: req(ROW_ID),
  token: req(SHORT),
  key: req(SHORT),
  contactId: ROW_ID,
  personName: req(SHORT),
  sentAt: req(TIMESTAMP),
  submitted: SUBMISSION,
});

const SETTINGS = object({
  brandName: req(SHORT),
  producers: req(rows(PRODUCER)),
  rules: req(LONG),
  brandBudget: req(MONEY),
  totalSpent: req(MONEY),
  trash: req(rows(DELETED_ITEM)),
  potentialComics: req(rows(COMIC)),
  expenses: req(rows(EXPENSE)),
  emailList: req(list(EMAIL_ENTRY, 100_000, 'email')),
  scheduleTemplates: req(rows(TEMPLATE)),
  musicLibrary: req(rows(TRACK)),
  signedAgreements: rows(AGREEMENT),
  contracts: req(rows(CONTRACT)),
  signatureRequests: req(list(SIGNATURE_REQUEST, 1000, 'token')),
  profileRequests: list(PROFILE_REQUEST, 1000, 'token'),
  deletedShowIds: list(SHOW_ID, 2000),
  showTypes: req(list(SHORT, 50)),
  onboarded: req(FLAG),
  rolodexTermSingular: SHORT,
  rolodexTermPlural: SHORT,
  remoteMusicKey: SHORT,
});

/** Show keys a request may change: every key but the ones the owner's app keeps. */
const SHOW_KEYS: ReadonlySet<string> = new Set(
  [...SHOW.fields.keys()].filter((key) => !['id', 'createdAt', 'updatedAt', 'viewToken', 'viewerKey'].includes(key)),
);
/** Settings fields a request may change: every field but the derived ones. */
export const EDITABLE_SETTINGS_FIELDS: ReadonlySet<SettingsKey> = new Set(
  [...SETTINGS.fields.keys()].filter((key) => !SETTINGS_DERIVED_FIELDS.includes(key as SettingsKey)) as SettingsKey[],
);

/** Every top-level Show key the schema knows, in the order src/types lists them. */
export const SCHEMA_SHOW_KEYS: readonly string[] = [...SHOW.fields.keys()];
/** Every AppSettings key the schema knows, in the order src/types lists them. */
export const SCHEMA_SETTINGS_KEYS: readonly SettingsKey[] = [...SETTINGS.fields.keys()] as SettingsKey[];

// ── Small helpers ─────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}
function ownValue(value: unknown, key: string): unknown {
  return isRecord(value) && hasOwn(value, key) ? value[key] : undefined;
}

const STRING_KINDS = new Set(['showId', 'rowId', 'short', 'long', 'timestamp', 'media', 'url', 'enum']);
const NUMBER_KINDS = new Set(['money', 'count', 'seconds', 'minutes', 'order']);

/** Whether a value has the right type for a leaf (drop mode's only question). */
function leafTypeOk(leaf: Leaf, value: unknown): boolean {
  if (leaf.t === 'flag') return typeof value === 'boolean';
  if (NUMBER_KINDS.has(leaf.t)) return typeof value === 'number' && Number.isFinite(value);
  if (leaf.t === 'enum') return typeof value === 'string' && leaf.values.includes(value);
  return STRING_KINDS.has(leaf.t) && typeof value === 'string';
}

function defaultFor(shape: Shape): unknown {
  switch (shape.t) {
    case 'object':
      return drop(shape, {});
    case 'list':
      return [];
    case 'flag':
      return false;
    case 'enum':
      return shape.values[0];
    default:
      return NUMBER_KINDS.has(shape.t) ? 0 : '';
  }
}

// ── Drop mode ─────────────────────────────────────────────────────────────

/** The value with every leaf that breaks its shape removed; undefined when the value itself does. */
function drop(shape: Shape, value: unknown): unknown {
  if (shape.t === 'object') {
    if (!isRecord(value)) return undefined;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      const field = shape.fields.get(key);
      if (!field) continue;
      const kept = value[key] == null ? undefined : drop(field.node, value[key]);
      if (kept !== undefined) out[key] = kept;
    }
    for (const [key, field] of shape.fields) {
      if (field.required && !hasOwn(out, key)) out[key] = defaultFor(field.node);
    }
    return out;
  }
  if (shape.t === 'list') {
    if (!Array.isArray(value)) return undefined;
    const out: unknown[] = [];
    for (const item of value) {
      const kept = drop(shape.of, item);
      if (kept !== undefined) out.push(kept);
    }
    return out;
  }
  return leafTypeOk(shape, value) ? value : undefined;
}

function copyOf(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value)) as unknown;
}

/**
 * A show as a co-producer is served it (drop mode): healed as the app heals
 * a loaded show, then every leaf of the wrong type, unknown key and unknown
 * enum value removed, a required one replaced by its type's default. Lengths
 * are not capped. Null only for a value with no string id. Works on its own
 * copy; the value passed in is left alone.
 */
export function sanitizeShow(value: unknown): Show | null {
  if (!isRecord(value)) return null;
  const healed = healShow(copyOf(value));
  if (!healed) return null;
  return drop(SHOW, healed) as Show;
}

/**
 * Settings as a co-producer is served them (drop mode), healed the way the
 * app heals saved settings: lists that should be there are, and an account
 * whose settings exist has finished onboarding. Null when not an object.
 */
export function sanitizeSettings(value: unknown): AppSettings | null {
  if (!isRecord(value)) return null;
  const settings = drop(SETTINGS, copyOf(value)) as AppSettings;
  if (typeof value.onboarded !== 'boolean') settings.onboarded = true;
  return settings;
}

// ── Refuse mode ───────────────────────────────────────────────────────────

const MAX_PROBLEMS = 100;
const ID_CONTROL = /[\p{Cc}\p{Cf}]/u;
const MEDIA_REF = /^media:([A-Za-z0-9-]{8,64})#([1-9]|[1-5][0-9]|6[0-4])$/;
/** Direction overrides and isolates, and control characters other than tab, CR and LF. */
const ACTION_TEXT_FORBIDDEN = /[\u202A-\u202E\u2066-\u2069]|(?![\t\n\r])\p{Cc}/u;
const PUBLIC_APP_PATHS = ['/live', '/sign', '/details'];
const PUBLIC_APP_PREFIXES = ['/tour/', '/guides/'];

class Checker {
  readonly problems: SchemaProblem[] = [];
  /** Media ids in changed values, in the order met. */
  readonly media: string[] = [];
  readonly ctx: ValidateContext;

  constructor(ctx: ValidateContext) {
    this.ctx = ctx;
  }

  fail(path: string, problem: string): void {
    if (this.problems.length < MAX_PROBLEMS) this.problems.push({ path, problem });
  }

  /**
   * Check a value against its shape. `hasBase` and `base` are what is there
   * now at the same place; with `changed` on, a leaf that differs from it
   * (or every leaf, with no base) must also keep the changed-value rules.
   */
  value(shape: Shape, value: unknown, path: string, changed: boolean, hasBase: boolean, base: unknown): void {
    if (shape.t === 'object') return this.object(shape, value, path, changed, hasBase, base);
    if (shape.t === 'list') return this.list(shape, value, path, changed, hasBase, base);
    if (!leafTypeOk(shape, value)) {
      this.fail(path, shape.t === 'enum' ? 'not one of the allowed values' : `wrong type for ${shape.t}`);
      return;
    }
    if (changed && (!hasBase || !sameValue(value, base))) this.changedLeaf(shape, value, path);
  }

  private object(shape: ObjectShape, value: unknown, path: string, changed: boolean, hasBase: boolean, base: unknown): void {
    if (!isRecord(value)) {
      this.fail(path, 'not an object');
      return;
    }
    for (const key of Object.keys(value)) {
      if (!shape.fields.has(key)) this.fail(join(path, key), 'unknown key');
    }
    for (const [key, field] of shape.fields) {
      const child = join(path, key);
      if (!hasOwn(value, key) || value[key] == null) {
        if (field.required) this.fail(child, 'missing');
        continue;
      }
      const baseHas = hasBase && isRecord(base) && hasOwn(base, key);
      this.value(field.node, value[key], child, changed, baseHas, baseHas ? (base as Record<string, unknown>)[key] : undefined);
    }
  }

  private list(shape: ListShape, value: unknown, path: string, changed: boolean, hasBase: boolean, base: unknown): void {
    if (!Array.isArray(value)) {
      this.fail(path, 'not a list');
      return;
    }
    const differs = changed && (!hasBase || !sameValue(value, base));
    if (differs && value.length > shape.max) this.fail(path, `more than ${shape.max} items`);
    const baseList = hasBase && Array.isArray(base) ? base : null;
    const idKey = shape.idKey;
    const baseById = new Map<string, unknown>();
    if (idKey && baseList) {
      for (const row of baseList) {
        const id = ownValue(row, idKey);
        if (typeof id === 'string' && !baseById.has(id)) baseById.set(id, row);
      }
    }
    const seen = new Set<string>();
    value.forEach((item, index) => {
      const itemPath = `${path}[${index}]`;
      if (idKey) {
        const id = ownValue(item, idKey);
        if (typeof id === 'string') {
          if (differs && seen.has(id)) this.fail(itemPath, 'repeats an id');
          seen.add(id);
          this.value(shape.of, item, itemPath, changed, baseById.has(id), baseById.get(id));
          return;
        }
      }
      const atIndex = baseList !== null && index < baseList.length;
      this.value(shape.of, item, itemPath, changed, atIndex, atIndex ? baseList![index] : undefined);
    });
  }

  private changedLeaf(leaf: Leaf, value: unknown, path: string): void {
    switch (leaf.t) {
      case 'showId':
        if (!isShowId(value as string)) this.fail(path, 'not a show id');
        return;
      case 'rowId':
        if (!isRowId(value as string)) this.fail(path, 'not an id');
        return;
      case 'short':
        if ((value as string).length > 2000) this.fail(path, 'longer than 2,000 characters');
        return;
      case 'long':
        if ((value as string).length > 50_000) this.fail(path, 'longer than 50,000 characters');
        return;
      case 'timestamp':
        if ((value as string).length > 40) this.fail(path, 'not a timestamp');
        return;
      case 'money':
        if (Math.abs(value as number) > 1_000_000_000) this.fail(path, 'out of range');
        return;
      case 'count':
        if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > leaf.max) this.fail(path, 'out of range');
        return;
      case 'seconds':
        if ((value as number) < 0 || (value as number) > 86_400) this.fail(path, 'out of range');
        return;
      case 'minutes':
        if ((value as number) < 0 || (value as number) > 1_440) this.fail(path, 'out of range');
        return;
      case 'order':
        if (!Number.isInteger(value) || Math.abs(value as number) > 1_000_000) this.fail(path, 'out of range');
        return;
      case 'media': {
        const text = value as string;
        if (text === '') return;
        const ref = MEDIA_REF.exec(text);
        if (ref) {
          this.media.push(ref[1]);
          return;
        }
        // A data: URL is legacy media, kept as it was. A new file is
        // uploaded for approval and arrives as a media: reference.
        this.fail(path, text.startsWith('data:') ? 'a new file must be uploaded, not embedded' : 'not a file reference');
        return;
      }
      case 'url':
        if (!this.urlAllowed(value as string)) this.fail(path, 'not an allowed link');
        return;
      default:
        return;
    }
  }

  urlAllowed(text: string): boolean {
    if (text === '') return true;
    let url: URL;
    try {
      url = new URL(text);
    } catch {
      return false;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    if (url.username || url.password) return false;
    if (!this.ctx.appOrigins.includes(url.origin)) return true;
    // The app's own pages a link may usefully point at: the public ones.
    // Never sign-in, the API, the assistant's consent page or a co-producer link.
    return PUBLIC_APP_PATHS.includes(url.pathname) || PUBLIC_APP_PREFIXES.some((prefix) => url.pathname.startsWith(prefix));
  }
}

function join(path: string, key: string): string {
  return path ? `${path}.${key}` : key;
}

function isShowId(value: string): boolean {
  return /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

/** 1-128 characters with no control or format characters, and never a name that reaches a prototype. */
function isRowId(value: string): boolean {
  return value.length >= 1 && value.length <= 128 && !ID_CONTROL.test(value) && !FORBIDDEN_KEYS.has(value);
}

function exactKeys(c: Checker, value: Record<string, unknown>, path: string, allowed: readonly string[], required: readonly string[] = allowed): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) c.fail(join(path, key), 'unknown key');
  }
  for (const key of required) {
    if (!hasOwn(value, key)) c.fail(join(path, key), 'missing');
  }
}

function checkRevision(c: Checker, value: unknown, path: string): void {
  if (value !== null && (typeof value !== 'string' || value.length > 128)) c.fail(path, 'not a revision');
}

function distinctStrings(c: Checker, value: unknown, path: string, check?: (item: string) => boolean, problem = 'not an id'): string[] | null {
  if (!Array.isArray(value)) {
    c.fail(path, 'not a list');
    return null;
  }
  const seen = new Set<string>();
  value.forEach((item, index) => {
    if (typeof item !== 'string' || (check && !check(item))) c.fail(`${path}[${index}]`, problem);
    else if (seen.has(item)) c.fail(`${path}[${index}]`, 'repeated');
    else seen.add(item);
  });
  return value.every((item) => typeof item === 'string') ? (value as string[]) : null;
}

function showField(key: string): Field {
  return SHOW.fields.get(key)!;
}

function checkShowEdit(c: Checker, edit: unknown, path: string): string | null {
  if (!isRecord(edit)) {
    c.fail(path, 'not an object');
    return null;
  }
  if (edit.target !== 'show') c.fail(join(path, 'target'), 'not a show edit');
  const showId = edit.showId;
  if (typeof showId !== 'string' || !isShowId(showId)) c.fail(join(path, 'showId'), 'not a show id');
  switch (edit.op) {
    case 'create': {
      exactKeys(c, edit, path, ['target', 'op', 'showId', 'show']);
      const show = edit.show;
      c.value(SHOW, show, join(path, 'show'), true, false, undefined);
      if (isRecord(show)) {
        if (show.id !== showId) c.fail(join(path, 'show.id'), 'does not match showId');
        if (hasOwn(show, 'viewerKey')) c.fail(join(path, 'show.viewerKey'), 'not allowed');
        if (hasOwn(show, 'viewToken') && !(typeof show.viewToken === 'string' && show.viewToken.startsWith(REDACTED_TOKEN_PREFIX))) {
          c.fail(join(path, 'show.viewToken'), 'not allowed');
        }
      }
      break;
    }
    case 'update': {
      exactKeys(c, edit, path, ['target', 'op', 'showId', 'baseRevision', 'keys', 'base', 'proposed']);
      checkRevision(c, edit.baseRevision, join(path, 'baseRevision'));
      const keys = distinctStrings(c, edit.keys, join(path, 'keys'), (key) => SHOW_KEYS.has(key), 'not a key a request may change');
      if (keys && keys.length === 0) c.fail(join(path, 'keys'), 'empty');
      const base = edit.base;
      const proposed = edit.proposed;
      if (!isRecord(base)) c.fail(join(path, 'base'), 'not an object');
      if (!isRecord(proposed)) c.fail(join(path, 'proposed'), 'not an object');
      if (!keys || !isRecord(base) || !isRecord(proposed)) break;
      const named = new Set(keys);
      for (const key of Object.keys(base)) if (!named.has(key)) c.fail(join(path, `base.${key}`), 'not in keys');
      for (const key of Object.keys(proposed)) if (!named.has(key)) c.fail(join(path, `proposed.${key}`), 'not in keys');
      for (const key of keys) {
        if (!SHOW_KEYS.has(key)) continue;
        const field = showField(key);
        const baseHas = hasOwn(base, key) && base[key] != null;
        if (baseHas) c.value(field.node, base[key], join(path, `base.${key}`), false, false, undefined);
        if (hasOwn(proposed, key) && proposed[key] != null) {
          c.value(field.node, proposed[key], join(path, `proposed.${key}`), true, baseHas, baseHas ? base[key] : undefined);
        } else if (field.required) {
          c.fail(join(path, `proposed.${key}`), 'cannot be removed');
        }
      }
      break;
    }
    case 'delete': {
      exactKeys(c, edit, path, ['target', 'op', 'showId', 'baseRevision', 'base']);
      checkRevision(c, edit.baseRevision, join(path, 'baseRevision'));
      c.value(SHOW, edit.base, join(path, 'base'), false, false, undefined);
      if (isRecord(edit.base) && edit.base.id !== showId) c.fail(join(path, 'base.id'), 'does not match showId');
      break;
    }
    default:
      c.fail(join(path, 'op'), 'not create, update or delete');
  }
  return typeof showId === 'string' ? showId : null;
}

function checkPairs(c: Checker, value: unknown, path: string, idField: string, order: Set<string> | null): Map<string, unknown> {
  const out = new Map<string, unknown>();
  if (!Array.isArray(value)) {
    c.fail(path, 'not a list');
    return out;
  }
  value.forEach((pair, index) => {
    const pairPath = `${path}[${index}]`;
    if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== 'string' || !isRecord(pair[1])) {
      c.fail(pairPath, 'not an [id, row] pair');
      return;
    }
    const [id, data] = pair as [string, Record<string, unknown>];
    if (out.has(id)) c.fail(pairPath, 'repeats an id');
    if (ownValue(data, idField) !== id) c.fail(pairPath, `row ${idField} does not match its id`);
    if (order && !order.has(id)) c.fail(pairPath, 'not in its order');
    out.set(id, data);
  });
  return out;
}

function checkSettingsField(c: Checker, edit: unknown, path: string): string | null {
  if (!isRecord(edit)) {
    c.fail(path, 'not an object');
    return null;
  }
  const field = edit.field;
  if (typeof field !== 'string' || !EDITABLE_SETTINGS_FIELDS.has(field as SettingsKey)) {
    c.fail(join(path, 'field'), 'not a field a request may change');
    return typeof field === 'string' ? field : null;
  }
  const key = field as SettingsKey;
  const shape = SETTINGS.fields.get(key)!.node;
  const idField = SETTINGS_ROW_FIELDS.get(key);
  if (idField === undefined) {
    if (edit.kind !== 'value') c.fail(join(path, 'kind'), 'must be value');
    exactKeys(c, edit, path, ['field', 'kind', 'base', 'proposed'], ['field', 'kind']);
    const baseHas = hasOwn(edit, 'base') && edit.base != null;
    if (baseHas) c.value(shape, edit.base, join(path, 'base'), false, false, undefined);
    if (hasOwn(edit, 'proposed') && edit.proposed != null) {
      c.value(shape, edit.proposed, join(path, 'proposed'), true, baseHas, baseHas ? edit.base : undefined);
    } else if (SETTINGS.fields.get(key)!.required) {
      c.fail(join(path, 'proposed'), 'cannot be removed');
    }
    return key;
  }

  if (edit.kind !== 'rows') c.fail(join(path, 'kind'), 'must be rows');
  exactKeys(c, edit, path, ['field', 'kind', 'idField', 'baseOrder', 'proposedOrder', 'base', 'proposed']);
  if (edit.idField !== idField) c.fail(join(path, 'idField'), `must be ${idField}`);
  const listShape = shape as ListShape;
  const baseOrder = distinctStrings(c, edit.baseOrder, join(path, 'baseOrder'));
  const proposedOrder = distinctStrings(c, edit.proposedOrder, join(path, 'proposedOrder'));
  if (proposedOrder && proposedOrder.length > listShape.max) c.fail(join(path, 'proposedOrder'), `more than ${listShape.max} rows`);
  const base = checkPairs(c, edit.base, join(path, 'base'), idField, baseOrder && new Set(baseOrder));
  const proposed = checkPairs(c, edit.proposed, join(path, 'proposed'), idField, proposedOrder && new Set(proposedOrder));
  let index = 0;
  for (const row of base.values()) {
    c.value(listShape.of, row, join(path, `base[${index++}][1]`), false, false, undefined);
  }
  index = 0;
  for (const [id, row] of proposed) {
    const baseRow = base.get(id);
    c.value(listShape.of, row, join(path, `proposed[${index++}][1]`), true, baseRow !== undefined, baseRow);
  }
  if (REMOVE_ONLY_ROW_FIELDS.has(key)) {
    if (proposed.size > 0) c.fail(join(path, 'proposed'), 'rows here can only be removed');
    if (baseOrder && proposedOrder) {
      const kept = baseOrder.filter((id) => proposedOrder.includes(id));
      if (kept.length !== proposedOrder.length || kept.some((id, i) => id !== proposedOrder[i])) {
        c.fail(join(path, 'proposedOrder'), 'rows here can only be removed');
      }
    }
  }
  if (idField === 'id' && proposedOrder) {
    proposedOrder.forEach((id, i) => {
      if (!isRowId(id)) c.fail(join(path, `proposedOrder[${i}]`), 'not an id');
    });
  }
  return key;
}

function checkEdit(c: Checker, payload: Record<string, unknown>): void {
  exactKeys(c, payload, '', ['kind', 'shows', 'settings']);
  const shows = payload.shows;
  let showCount = 0;
  if (!Array.isArray(shows)) {
    c.fail('shows', 'not a list');
  } else {
    showCount = shows.length;
    if (shows.length > COPRODUCER_LIMITS.maxShowEdits) c.fail('shows', `more than ${COPRODUCER_LIMITS.maxShowEdits} show edits`);
    const seen = new Set<string>();
    shows.forEach((edit, index) => {
      const id = checkShowEdit(c, edit, `shows[${index}]`);
      if (id !== null) {
        if (seen.has(id)) c.fail(`shows[${index}].showId`, 'repeated');
        seen.add(id);
      }
    });
  }
  const settings = payload.settings;
  let fieldCount = 0;
  if (settings !== null) {
    if (!isRecord(settings)) {
      c.fail('settings', 'not an object');
    } else {
      exactKeys(c, settings, 'settings', ['target', 'baseRevision', 'fields']);
      if (settings.target !== 'settings') c.fail('settings.target', 'not a settings edit');
      checkRevision(c, settings.baseRevision, 'settings.baseRevision');
      const fields = settings.fields;
      if (!Array.isArray(fields)) {
        c.fail('settings.fields', 'not a list');
      } else {
        fieldCount = fields.length;
        if (fields.length === 0) c.fail('settings.fields', 'empty');
        if (fields.length > COPRODUCER_LIMITS.maxSettingsFields) c.fail('settings.fields', `more than ${COPRODUCER_LIMITS.maxSettingsFields} fields`);
        const seen = new Set<string>();
        fields.forEach((edit, index) => {
          const field = checkSettingsField(c, edit, `settings.fields[${index}]`);
          if (field !== null) {
            if (seen.has(field)) c.fail(`settings.fields[${index}].field`, 'repeated');
            seen.add(field);
          }
        });
      }
    }
  }
  if (showCount === 0 && fieldCount === 0) c.fail('', 'changes nothing');
}

function actionText(c: Checker, value: unknown, path: string, min: number, max: number): void {
  if (typeof value !== 'string') {
    c.fail(path, 'not text');
    return;
  }
  if (value.length < min || value.length > max) c.fail(path, `must be ${min} to ${max} characters`);
  if (ACTION_TEXT_FORBIDDEN.test(value)) c.fail(path, 'holds control or direction characters');
}

function actionId(c: Checker, value: unknown, path: string, kind: 'show' | 'row'): void {
  if (typeof value !== 'string' || !(kind === 'show' ? isShowId(value) : isRowId(value))) c.fail(path, kind === 'show' ? 'not a show id' : 'not an id');
}

function checkAction(c: Checker, kind: 'share' | 'download', action: unknown): void {
  const path = 'action';
  if (!isRecord(action)) {
    c.fail(path, 'not an object');
    return;
  }
  const type = action.type;
  const types: readonly string[] = kind === 'share' ? SHARE_TYPES : DOWNLOAD_TYPES;
  if (typeof type !== 'string' || !types.includes(type)) {
    c.fail('action.type', `not a ${kind}`);
    return;
  }
  const keys = (allowed: string[], required: string[] = allowed) => exactKeys(c, action, path, ['type', ...allowed], ['type', ...required]);
  const showId = (required: boolean) => {
    if (hasOwn(action, 'showId')) actionId(c, action.showId, 'action.showId', 'show');
    else if (required) c.fail('action.showId', 'missing');
  };
  switch (type) {
    case 'copy-text':
      keys(['source', 'showId', 'text'], ['source', 'text']);
      if (!['announce-post', 'announce-tags', 'season-pitch'].includes(action.source as string)) c.fail('action.source', 'not a source');
      showId(false);
      actionText(c, action.text, 'action.text', 0, 50_000);
      return;
    case 'email':
      keys(['source', 'showId', 'href'], ['source', 'href']);
      if (!['lineup', 'rolodex-all', 'person'].includes(action.source as string)) c.fail('action.source', 'not a source');
      showId(false);
      actionText(c, action.href, 'action.href', 7, 20_000);
      if (typeof action.href === 'string' && !action.href.startsWith('mailto:')) c.fail('action.href', 'not a mailto: link');
      return;
    case 'signing-link': {
      keys(['contractId', 'signer']);
      actionId(c, action.contractId, 'action.contractId', 'row');
      const signer = action.signer;
      if (!isRecord(signer)) {
        c.fail('action.signer', 'not an object');
        return;
      }
      exactKeys(c, signer, 'action.signer', ['name', 'email', 'contactId'], ['name']);
      actionText(c, signer.name, 'action.signer.name', 1, 200);
      if (hasOwn(signer, 'email')) actionText(c, signer.email, 'action.signer.email', 0, 320);
      if (hasOwn(signer, 'contactId')) actionId(c, signer.contactId, 'action.signer.contactId', 'row');
      return;
    }
    case 'existing-signing-link': {
      keys(['requestIds']);
      const ids = distinctStrings(c, action.requestIds, 'action.requestIds', isRowId);
      if (ids && (ids.length < 1 || ids.length > COPRODUCER_LIMITS.maxShareRequestIds)) {
        c.fail('action.requestIds', `must name 1 to ${COPRODUCER_LIMITS.maxShareRequestIds} links`);
      }
      return;
    }
    case 'profile-link':
      keys(['contactId']);
      actionId(c, action.contactId, 'action.contactId', 'row');
      return;
    case 'existing-profile-link':
      keys(['requestId']);
      actionId(c, action.requestId, 'action.requestId', 'row');
      return;
    case 'viewer-link':
    case 'flyer':
    case 'dj-list-text':
    case 'runsheet-pdf':
    case 'dj-list-pdf':
      keys(['showId']);
      showId(true);
      return;
    case 'backup':
      keys([]);
      return;
    case 'headshot-pack':
      keys(['showId', 'includesGuests']);
      showId(true);
      if (typeof action.includesGuests !== 'boolean') c.fail('action.includesGuests', 'not yes or no');
      return;
    case 'signed-agreement':
      keys(['agreementId']);
      actionId(c, action.agreementId, 'action.agreementId', 'row');
      return;
    case 'headshot': {
      keys(['subject']);
      const subject = action.subject;
      if (!isRecord(subject)) {
        c.fail('action.subject', 'not an object');
        return;
      }
      if (subject.kind === 'contact') {
        exactKeys(c, subject, 'action.subject', ['kind', 'contactId']);
        actionId(c, subject.contactId, 'action.subject.contactId', 'row');
      } else if (subject.kind === 'performer' || subject.kind === 'artist') {
        exactKeys(c, subject, 'action.subject', ['kind', 'showId', 'personId']);
        actionId(c, subject.showId, 'action.subject.showId', 'show');
        actionId(c, subject.personId, 'action.subject.personId', 'row');
      } else {
        c.fail('action.subject.kind', 'not performer, artist or contact');
      }
      return;
    }
  }
}

/**
 * Refuse mode over a whole request: the payload, or the problems with it
 * (the server answers with the first 20).
 */
export function validatePayload(
  value: unknown,
  ctx: ValidateContext,
): { payload: RequestPayload; problems: [] } | { payload: null; problems: SchemaProblem[] } {
  const c = new Checker(ctx);
  try {
    checkUntrusted(value);
  } catch {
    return { payload: null, problems: [{ path: '', problem: 'not a safe value' }] };
  }
  if (!isRecord(value)) {
    c.fail('', 'not an object');
  } else if (value.kind === 'edit') {
    checkEdit(c, value);
  } else if (value.kind === 'share' || value.kind === 'download') {
    exactKeys(c, value, '', ['kind', 'action']);
    checkAction(c, value.kind, value.action);
  } else {
    c.fail('kind', 'not edit, share or download');
  }
  if (c.problems.length > 0) return { payload: null, problems: c.problems };
  return { payload: value as unknown as RequestPayload, problems: [] };
}

/**
 * Every `media:` id in an edit's changed values: all of a create's files,
 * the files in an update's proposed values that differ from its base, and
 * the files in settings values and rows that differ from theirs. Ids from
 * files only (a note that happens to read "media:…" is text), each once.
 */
export function changedMediaIds(payload: EditPayload): string[] {
  const c = new Checker({ appOrigins: [] });
  checkEdit(c, payload as unknown as Record<string, unknown>);
  return [...new Set(c.media)];
}

/** Show keys a request may change, for tests and the capture. */
export function isShowKey(key: string): key is ShowKey {
  return SHOW_KEYS.has(key);
}

// ── Files ─────────────────────────────────────────────────────────────────

/** The kinds of file a co-producer may send for approval. */
export const ALLOWED_MEDIA_TYPES: readonly string[] = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'audio/mpeg',
  'audio/mp4',
  'audio/aac',
  'audio/wav',
  'audio/ogg',
  'audio/webm',
  'application/pdf',
];

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function decodeBase64Head(text: string): number[] | null {
  const head = text.slice(0, 64).replace(/=+$/, '');
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const ch of head) {
    const digit = BASE64.indexOf(ch);
    if (digit < 0) return null;
    buffer = (buffer << 6) | digit;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  return bytes;
}

function startsWith(bytes: number[], at: number, ascii: string): boolean {
  for (let i = 0; i < ascii.length; i++) {
    if (bytes[at + i] !== ascii.charCodeAt(i)) return false;
  }
  return true;
}

/**
 * The type a file's first bytes say it is (its magic numbers), from the
 * first 64 base64 characters after a data URL's comma, or null. What a file
 * calls itself is not trusted: an SVG or HTML page labelled as a photo is
 * markup, and a recording a browser labels video/mp4 is still audio.
 */
export function sniffMediaType(base64Head: string): string | null {
  const b = decodeBase64Head(base64Head);
  if (!b || b.length < 4) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x89 && startsWith(b, 1, 'PNG')) return 'image/png';
  if (startsWith(b, 0, 'RIFF') && startsWith(b, 8, 'WEBP')) return 'image/webp';
  if (startsWith(b, 0, 'GIF8')) return 'image/gif';
  if (startsWith(b, 0, 'RIFF') && startsWith(b, 8, 'WAVE')) return 'audio/wav';
  if (startsWith(b, 0, '%PDF')) return 'application/pdf';
  if (startsWith(b, 0, 'OggS')) return 'audio/ogg';
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'audio/webm';
  if (startsWith(b, 4, 'ftyp')) return 'audio/mp4';
  if (startsWith(b, 0, 'ID3')) return 'audio/mpeg';
  if (b[0] === 0xff && (b[1] === 0xf1 || b[1] === 0xf9)) return 'audio/aac';
  if (b[0] === 0xff && (b[1] & 0xf0) === 0xf0) return 'audio/mpeg';
  return null;
}

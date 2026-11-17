/**
 * What approving a co-producer's edit would do to the owner's account, worked
 * out in full before anything is written.
 *
 * A request says what the co-producer saw (`base`, their redacted view of the
 * owner's data when they made it) and what they want instead (`proposed`).
 * The owner may have changed things since, so a request is merged, not
 * copied: field by field, row by row, three ways (what they saw, what the
 * owner has now, what they asked for). Where the owner has changed a value
 * the request also changes, to something else, that is a conflict: the
 * request is marked stale, the owner is shown both, and only an explicit
 * "Approve anyway" puts theirs in place.
 *
 * Conflicts are found on raw values, at exactly the granularity the merge
 * writes (a row's field, a recap figure, a list's order), so nothing the
 * owner typed is overwritten without being listed, and nothing the request
 * did not name is touched: a to-do the co-producer ticked never removes one
 * the owner added meanwhile.
 *
 * planEdit then does everything the owner's own app would do around the same
 * change (trash and the deleted-show record for a delete, the Rolodex
 * reconciliation, the links a removal withdraws) and diffs the complete
 * before and after, so the card shows everything approval changes. Approve
 * plans again on the latest state, in the same tick as the commit, and
 * refuses when the result's fingerprint differs from what was on screen.
 *
 * Pure and synchronous. Nothing from a payload is used as a property name on
 * an object that could reach a prototype: rows are read into Maps, values
 * are read with own-property lookups and written as own properties.
 */
import type { AppSettings, DeletedItem, ProfileRequest, Show, SignatureRequest } from '../types';
import { MAX_DELETED_SHOW_IDS } from '../types';
import { liveMediaIds, orphanedRefs, settingsMediaRefs, showMediaRefs } from '../utils/mediaCleanup';
import { settleRecapProfit } from '../utils/recapMoney';
import { reconcileRolodexProfiles, syncShowsWithRolodex } from '../utils/rolodex';
import { healSettings } from '../utils/secure-storage';
import { normalizeComicSettings } from '../utils/sharedComicSettings';
import { stripLegacySettingsMedia, stripLegacyShowMedia } from '../utils/stripMedia';
import { MAX_TRASH_ITEMS, stripShowMediaForTrash } from '../utils/trash';
import { describeConflict, diffSettings, diffShow, visibleText, type DiffContext } from './diff';
import { groupKeyForSettings, groupKeyForShow, sameMeaning, sameValue, seg } from './paths';
import { viewOfSettings, viewOfShow, type OwnerState, type PseudonymIndex } from './redaction';
import { changedMediaIds, EDITABLE_SETTINGS_FIELDS, isShowKey } from './schema';
import {
  REMOVE_ONLY_ROW_FIELDS,
  SETTINGS_DERIVED_FIELDS,
  SETTINGS_ROW_FIELDS,
  type ChangeGroup,
  type Conflict,
  type EditPayload,
  type RawConflict,
  type SettingsEdit,
  type SettingsKey,
  type ShowUpdate,
} from './types';

export type { OwnerState } from './redaction';

export interface PlanContext {
  index: PseudonymIndex;
  /** The request's own staged files (row.mediaIds). */
  mediaIds: readonly string[];
  /** ISO time used for updatedAt, createdAt and deletedAt. The same for every plan of one card, so a re-plan reads the same. */
  now: string;
  /** The id of a trash row the plan makes for a deleted show: stable, so re-planning gives the same id. */
  trashId(showId: string): string;
  /**
   * Ids for rows the owner's own bookkeeping makes on the way (a Rolodex
   * entry the reconciliation files, a walk-on song it adds to a DJ list),
   * which would otherwise be random and differ between two plans of the
   * same request. Defaults to trashId('new-' + seed).
   */
  newId?(seed: string): string;
  context: DiffContext;
}

export type Withdrawal =
  | { kind: 'signature'; request: SignatureRequest }
  | { kind: 'profile'; request: ProfileRequest }
  | { kind: 'viewer'; token: string; showId: string; showName: string };

export interface AppliedPlan {
  after: OwnerState;
  /** Show ids to insert or replace, and to remove; every other show is left as it is. */
  upsert: string[];
  remove: string[];
  settingsChanged: boolean;
  withdrawals: Withdrawal[];
}

export type PlanResult =
  | ({ ok: true; before: OwnerState; changes: ChangeGroup[]; conflicts: Conflict[]; notes: string[]; fingerprint: string } & AppliedPlan)
  | { ok: false; reason: string };

export interface MergeOutcome<T> { value: T; conflicts: RawConflict[]; notes: string[] }

export const PLAN_REASONS = {
  missingFile: 'A file in this request is missing. Ask them to send it again.',
  nothingLeft: 'Everything this asked to change has been deleted since.',
  noChange: "This doesn't change anything any more.",
  notAllowed: "This asks to change something only your own app keeps. It can't be approved.",
} as const;

type Row = Record<string, unknown>;

function isRow(value: unknown): value is Row {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function own(value: unknown, key: string): unknown {
  return isRow(value) && hasOwn(value, key) ? value[key] : undefined;
}

/** Set an own property, whatever its name (a plain `obj[key] =` with '__proto__' would set the prototype instead). */
function setOwn(target: Row, key: string, value: unknown): void {
  Object.defineProperty(target, key, { value, writable: true, enumerable: true, configurable: true });
}

function write(target: Row, key: string, value: unknown): void {
  if (value === undefined) delete target[key];
  else setOwn(target, key, value);
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function quoted(name: string | null | undefined): string {
  const clean = name ? visibleText(name.trim()) : '';
  return clean ? `“${clean}”` : 'A show';
}

// ── Lists and how their rows are called ──────────────────────────────────

interface ListInfo { label: string; title(row: Row): string }

const person: ListInfo['title'] = (row) => visibleText(text(row.name)) || 'Someone';

const SHOW_LISTS = new Map<string, ListInfo>([
  ['performers', { label: 'Performers', title: person }],
  ['artists', { label: 'Artists', title: person }],
  ['schedule', { label: 'Schedule', title: (row) => visibleText([text(row.time), text(row.description)].filter(Boolean).join(' · ')) || 'Cue' }],
  ['hosts', { label: 'Hosts', title: person }],
  ['djSongs', { label: 'DJ Music', title: (row) => visibleText([text(row.title), text(row.artist)].filter(Boolean).join(' — ')) || 'Song' }],
  ['staff', {
    label: 'Staff',
    title: (row) => {
      const role = text(row.role);
      const name = text(row.personName);
      return visibleText(role && name ? `${role}: ${name}` : role || name) || 'Staff member';
    },
  }],
  ['vendors', { label: 'Vendors', title: (row) => visibleText(text(row.name)) || 'Vendor' }],
  ['expenses', { label: 'Expenses', title: (row) => visibleText(text(row.itemName)) || 'Expense' }],
  ['scenes', { label: 'Scenes & Segments', title: (row) => visibleText(text(row.title)) || 'Scene' }],
  ['todos', { label: 'To-dos', title: (row) => visibleText(text(row.text)) || 'To-do' }],
]);

const SHOW_SUB_OBJECTS = new Set(['recap', 'completions']);
const SHOW_SETS = new Set(['hiddenSections', 'djHiddenLibraryIds']);

function settingsListInfo(field: string, settings: AppSettings): ListInfo {
  switch (field) {
    case 'potentialComics':
      return { label: visibleText(text(settings.rolodexTermPlural)) || 'Rolodex', title: person };
    case 'producers':
      return { label: 'Producers', title: person };
    case 'expenses':
      return { label: 'Expenses', title: (row) => visibleText(text(row.itemName)) || 'Expense' };
    case 'emailList':
      return { label: 'Email list', title: (row) => visibleText(text(row.email)) || 'An address' };
    case 'scheduleTemplates':
      return { label: 'Running order templates', title: (row) => visibleText(text(row.name)) || 'Template' };
    case 'musicLibrary':
      return { label: 'Music library', title: (row) => visibleText([text(row.title), text(row.artist)].filter(Boolean).join(' — ')) || 'Track' };
    case 'contracts':
      return { label: 'Contracts', title: (row) => visibleText(text(row.name)) || 'Contract' };
    case 'signedAgreements':
      return { label: 'Signed agreements', title: (row) => visibleText(text(row.name)) || 'Agreement' };
    default:
      return { label: field, title: (row) => visibleText(text(row.name)) || 'An entry' };
  }
}

// ── Three-way merges ──────────────────────────────────────────────────────

interface Sink { conflicts: RawConflict[]; notes: string[] }

/** Rows with a string id, in order (the first of any repeated id wins), and the id order. */
function rowsById(list: unknown, idKey: string): { order: string[]; rows: Map<string, Row> } {
  const rows = new Map<string, Row>();
  const order: string[] = [];
  if (!Array.isArray(list)) return { order, rows };
  for (const item of list) {
    if (!isRow(item)) continue;
    const id = own(item, idKey);
    if (typeof id !== 'string' || rows.has(id)) continue;
    rows.set(id, item);
    order.push(id);
  }
  return { order, rows };
}

function pairsById(pairs: [string, unknown][]): Map<string, Row> {
  const rows = new Map<string, Row>();
  for (const pair of pairs) {
    if (!Array.isArray(pair)) continue;
    const [id, row] = pair;
    if (typeof id === 'string' && isRow(row) && !rows.has(id)) rows.set(id, row);
  }
  return rows;
}

/**
 * One value, three ways. `view` is the owner's value as the co-producer
 * would see it now. Returns what to write ('keep' for nothing).
 */
function threeWay(groupKey: string, path: string, base: unknown, view: unknown, proposed: unknown, sink: Sink): { write: boolean; value: unknown } {
  if (sameValue(base, proposed)) return { write: false, value: undefined };
  if (sameValue(view, base)) return { write: true, value: proposed };
  if (sameValue(view, proposed)) return { write: false, value: undefined };
  sink.conflicts.push({ groupKey, path, base, current: view, proposed });
  return { write: true, value: proposed };
}

interface ListMerge {
  groupKey: string;
  /** The list's own key, the first part of every path in it. */
  list: string;
  info: ListInfo;
  idKey: string;
  baseOrder: string[];
  proposedOrder: string[];
  base: Map<string, Row>;
  proposed: Map<string, Row>;
  current: unknown;
  view: unknown;
}

/**
 * A list of records merged row by row and field by field. Rows the request
 * did not change are left as the owner has them; rows the owner added
 * meanwhile stay; a row the owner deleted stays deleted (with a note when the
 * request changed it).
 */
function mergeList(spec: ListMerge, sink: Sink): { changed: boolean; value: unknown[] } {
  const { groupKey, list, info, idKey } = spec;
  const result: unknown[] = Array.isArray(spec.current) ? [...spec.current] : [];
  const currentRows = rowsById(spec.current, idKey).rows;
  const view = rowsById(spec.view, idKey);
  const baseIds = new Set(spec.baseOrder);
  const proposedIds = new Set(spec.proposedOrder);
  let changed = false;

  const indexOf = (id: string) => result.findIndex((row) => isRow(row) && own(row, idKey) === id);

  // Changed rows, field by field.
  for (const id of spec.baseOrder) {
    if (!proposedIds.has(id)) continue;
    const before = spec.base.get(id);
    const after = spec.proposed.get(id);
    if (!before || !after || sameValue(before, after)) continue;
    const at = indexOf(id);
    if (at < 0) {
      sink.notes.push(`You removed ${info.title(before)} from ${info.label}, so their change to it wasn't applied.`);
      continue;
    }
    const current = result[at] as Row;
    const seen = view.rows.get(id) ?? current;
    let next: Row | null = null;
    const fields = [...new Set([...Object.keys(before), ...Object.keys(after)])];
    for (const field of fields) {
      const outcome = threeWay(groupKey, `${list}/${seg(id)}/${field}`, own(before, field), own(seen, field), own(after, field), sink);
      if (!outcome.write) continue;
      next ??= { ...current };
      write(next, field, outcome.value);
    }
    if (next) {
      result[at] = next;
      changed = true;
    }
  }

  // Removed rows.
  for (const id of spec.baseOrder) {
    if (proposedIds.has(id)) continue;
    const at = indexOf(id);
    if (at < 0) continue;
    const before = spec.base.get(id);
    if (before && !sameValue(view.rows.get(id), before)) {
      sink.conflicts.push({ groupKey, path: `${list}/${seg(id)}`, base: before, current: view.rows.get(id), proposed: undefined });
    }
    result.splice(at, 1);
    changed = true;
  }

  // Added rows, next to the rows they were added beside.
  spec.proposedOrder.forEach((id, i) => {
    if (baseIds.has(id)) return;
    const row = spec.proposed.get(id);
    if (!row) return;
    if (currentRows.has(id) || indexOf(id) >= 0) {
      sink.notes.push(`${info.title(row)} is already there.`);
      return;
    }
    let placed = false;
    for (let j = i - 1; j >= 0 && !placed; j--) {
      const at = indexOf(spec.proposedOrder[j]);
      if (at >= 0) {
        result.splice(at + 1, 0, row);
        placed = true;
      }
    }
    for (let j = i + 1; j < spec.proposedOrder.length && !placed; j++) {
      const at = indexOf(spec.proposedOrder[j]);
      if (at >= 0) {
        result.splice(at, 0, row);
        placed = true;
      }
    }
    if (!placed) result.push(row);
    changed = true;
  });

  // Order of the rows on both sides and still here.
  const inResult = (id: string) => indexOf(id) >= 0;
  const proposedOrder = spec.proposedOrder.filter((id) => baseIds.has(id) && inResult(id));
  const common = new Set(proposedOrder);
  const baseOrder = spec.baseOrder.filter((id) => common.has(id));
  if (!sameValue(proposedOrder, baseOrder)) {
    const viewOrder = view.order.filter((id) => common.has(id));
    if (!sameValue(viewOrder, baseOrder) && !sameValue(viewOrder, proposedOrder)) {
      sink.conflicts.push({ groupKey, path: `${list}#order`, base: baseOrder, current: viewOrder, proposed: proposedOrder });
    }
    const slots = result
      .map((row, at) => (isRow(row) && common.has(own(row, idKey) as string) ? at : -1))
      .filter((at) => at >= 0);
    const byId = new Map(slots.map((at) => [own(result[at], idKey) as string, result[at]]));
    const before = slots.map((at) => result[at]);
    slots.forEach((at, k) => {
      result[at] = byId.get(proposedOrder[k]);
    });
    if (slots.some((at, k) => result[at] !== before[k])) changed = true;
  }

  return { changed, value: result };
}

/** Each sub-key of an object (recap, completions) three ways; absent on a side means unset. */
function mergeSubObject(groupKey: string, key: string, base: unknown, view: unknown, proposed: unknown, current: unknown, sink: Sink, skip: ReadonlySet<string>): { changed: boolean; value: unknown } {
  const b = isRow(base) ? base : {};
  const p = isRow(proposed) ? proposed : {};
  const v = isRow(view) ? view : {};
  let next: Row | null = null;
  for (const sub of [...new Set([...Object.keys(b), ...Object.keys(p)])]) {
    if (skip.has(sub)) continue;
    const outcome = threeWay(groupKey, `${key}/${seg(sub)}`, own(b, sub), own(v, sub), own(p, sub), sink);
    if (!outcome.write) continue;
    next ??= isRow(current) ? { ...current } : {};
    write(next, sub, outcome.value);
  }
  if (!next) return { changed: false, value: current };
  if (Object.keys(next).length === 0 && !isRow(proposed)) return { changed: true, value: undefined };
  return { changed: true, value: next };
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

/** A list used as a set: what the request added goes in, what it took out comes out; nothing conflicts. */
function mergeSet(base: unknown, proposed: unknown, current: unknown): { changed: boolean; value: unknown } {
  const b = new Set(strings(base));
  const p = new Set(strings(proposed));
  const now = Array.isArray(current) ? current : [];
  const next = now.filter((item) => !(typeof item === 'string' && b.has(item) && !p.has(item)));
  for (const item of p) if (!b.has(item) && !next.includes(item)) next.push(item);
  if (sameValue(next, now)) return { changed: false, value: current };
  return { changed: true, value: next };
}

const RECAP_DERIVED = new Set(['profitLoss']);
const NOTHING_SKIPPED = new Set<string>();

/**
 * A show update merged into the owner's current show. `view` is
 * viewOfShow(current): conflicts compare like with like (redacted,
 * sanitised); writes go into `current`. Only the keys the request names are
 * read or written. The same object comes back when nothing was written.
 */
export function mergeRequestShow(edit: ShowUpdate, current: Show, view: Show): MergeOutcome<Show> {
  const sink: Sink = { conflicts: [], notes: [] };
  const groupKey = groupKeyForShow(edit.showId);
  const base = edit.base as unknown as Row;
  const proposed = edit.proposed as unknown as Row;
  const cur = current as unknown as Row;
  let next: Row | null = null;
  const put = (key: string, value: unknown) => {
    next ??= { ...cur };
    write(next, key, value);
  };
  for (const key of [...new Set(edit.keys as string[])]) {
    if (!isShowKey(key)) continue;
    const b = own(base, key);
    const p = own(proposed, key);
    const v = own(view, key);
    const list = SHOW_LISTS.get(key);
    if (list) {
      const before = rowsById(b, 'id');
      const after = rowsById(p, 'id');
      const merged = mergeList({
        groupKey, list: key, info: list, idKey: 'id',
        baseOrder: before.order, proposedOrder: after.order, base: before.rows, proposed: after.rows,
        current: own(cur, key), view: v,
      }, sink);
      if (merged.changed) put(key, merged.value);
    } else if (SHOW_SUB_OBJECTS.has(key)) {
      const merged = mergeSubObject(groupKey, key, b, v, p, own(cur, key), sink, key === 'recap' ? RECAP_DERIVED : NOTHING_SKIPPED);
      if (merged.changed) put(key, merged.value);
    } else if (SHOW_SETS.has(key)) {
      const merged = mergeSet(b, p, own(cur, key));
      if (merged.changed) put(key, merged.value);
    } else {
      const outcome = threeWay(groupKey, key, b, v, p, sink);
      if (outcome.write) put(key, outcome.value);
    }
  }
  if (!next) return { value: current, ...sink };
  return { value: settleRecapProfit(next as unknown as Show), ...sink };
}

const WITHDRAW_GONE = "A link they asked to withdraw isn't there any more.";

/**
 * A settings edit merged into the owner's current settings, field by field.
 * `view` is viewOfSettings(current). Rows of Recently deleted, contract links
 * and details links can only be removed: a link row only when its pseudonym
 * resolves, through `index`, to a current row with the same id.
 */
export function mergeRequestSettings(edit: SettingsEdit, current: AppSettings, view: AppSettings, index: PseudonymIndex): MergeOutcome<AppSettings> {
  const sink: Sink = { conflicts: [], notes: [] };
  const cur = current as unknown as Row;
  let next: Row | null = null;
  const put = (key: string, value: unknown) => {
    next ??= { ...cur };
    write(next, key, value);
  };
  const seen = new Set<string>();
  for (const fieldEdit of edit.fields) {
    const field = fieldEdit.field as string;
    if (seen.has(field) || !EDITABLE_SETTINGS_FIELDS.has(field as SettingsKey)) continue;
    seen.add(field);
    const groupKey = groupKeyForSettings(field as SettingsKey);
    const idKey = SETTINGS_ROW_FIELDS.get(field as SettingsKey);
    const now = own(next ?? cur, field);
    if (fieldEdit.kind === 'value') {
      if (idKey) continue;
      const b = own(fieldEdit, 'base');
      const p = own(fieldEdit, 'proposed');
      if (field === 'showTypes') {
        const merged = mergeSet(b, p, now);
        if (merged.changed) put(field, merged.value);
        continue;
      }
      const outcome = threeWay(groupKey, field, b, own(view, field), p, sink);
      if (outcome.write) put(field, outcome.value);
      continue;
    }
    if (!idKey || fieldEdit.idField !== idKey) continue;
    const baseRows = pairsById(fieldEdit.base);
    const proposedRows = pairsById(fieldEdit.proposed);
    const kept = new Set(fieldEdit.proposedOrder);
    if (REMOVE_ONLY_ROW_FIELDS.has(field as SettingsKey)) {
      const list = Array.isArray(now) ? now : [];
      let rows = list;
      for (const id of fieldEdit.baseOrder) {
        if (kept.has(id)) continue;
        if (field === 'trash') {
          rows = rows.filter((row) => !(isRow(row) && own(row, 'id') === id));
          continue;
        }
        const resolved = (field === 'signatureRequests' ? index.signature : index.profile).get(id);
        const asked = baseRows.get(id);
        const target = resolved && asked && own(asked, 'id') === resolved.id
          ? rows.findIndex((row) => isRow(row) && own(row, 'token') === resolved.token && own(row, 'id') === resolved.id)
          : -1;
        if (target < 0) {
          sink.notes.push(WITHDRAW_GONE);
          continue;
        }
        rows = rows.filter((_, at) => at !== target);
      }
      if (rows.length !== list.length) put(field, rows);
      continue;
    }
    const merged = mergeList({
      groupKey, list: field, info: settingsListInfo(field, current), idKey,
      baseOrder: fieldEdit.baseOrder, proposedOrder: fieldEdit.proposedOrder, base: baseRows, proposed: proposedRows,
      current: now, view: own(view, field),
    }, sink);
    if (merged.changed) put(field, merged.value);
  }
  return { value: (next ?? current) as AppSettings, ...sink };
}

// ── Planning ──────────────────────────────────────────────────────────────

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function showName(id: string, state: OwnerState, fallback?: unknown): string | null {
  const show = state.shows.find((s) => s.id === id);
  if (show) return show.name;
  const trashed = (state.settings.trash ?? []).find((item) => item?.data?.id === id);
  if (trashed) return trashed.data.name;
  return typeof fallback === 'string' ? fallback : null;
}

/** What a payload asks that no co-producer may ask (the server and the schema refuse it first; this is the last net). */
function forbidden(payload: EditPayload): boolean {
  for (const edit of payload.settings?.fields ?? []) {
    const field = edit.field;
    if (SETTINGS_DERIVED_FIELDS.includes(field) || !EDITABLE_SETTINGS_FIELDS.has(field)) return true;
    if (REMOVE_ONLY_ROW_FIELDS.has(field)) {
      if (edit.kind !== 'rows' || edit.proposed.length > 0) return true;
      const removed = new Set(edit.baseOrder.filter((id) => !edit.proposedOrder.includes(id)));
      const kept = edit.baseOrder.filter((id) => !removed.has(id));
      if (!sameValue(kept, edit.proposedOrder)) return true;
    }
  }
  return false;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Every id-shaped string in a value, in a fixed walk order. */
function collectIds(value: unknown, into: (id: string) => void): void {
  const stack: unknown[] = [value];
  while (stack.length) {
    const item = stack.pop();
    if (typeof item === 'string') {
      if (UUID.test(item)) into(item);
    } else if (Array.isArray(item)) {
      for (let i = item.length - 1; i >= 0; i--) stack.push(item[i]);
    } else if (isRow(item)) {
      const keys = Object.keys(item);
      for (let i = keys.length - 1; i >= 0; i--) stack.push(item[keys[i]]);
    }
  }
}

/** The value with every string in `names` renamed; the same object wherever nothing inside changed. */
function rename<T>(value: T, names: ReadonlyMap<string, string>): T {
  if (typeof value === 'string') return (names.get(value) ?? value) as T;
  if (Array.isArray(value)) {
    let out: unknown[] | null = null;
    value.forEach((item, i) => {
      const renamed = rename(item, names);
      if (renamed !== item) {
        out ??= [...value];
        out[i] = renamed;
      }
    });
    return (out ?? value) as T;
  }
  if (isRow(value)) {
    let out: Row | null = null;
    for (const key of Object.keys(value)) {
      const renamed = rename(value[key], names);
      if (renamed !== value[key]) {
        out ??= { ...value };
        setOwn(out, key, renamed);
      }
    }
    return (out ?? value) as T;
  }
  return value;
}

/**
 * The owner's bookkeeping makes a few rows of its own on the way (a Rolodex
 * entry for a newly booked name, a walk-on song on the DJ list), with random
 * ids. Renamed here to ids derived from the request, so two plans of the same
 * request on the same state read the same and Approve applies what was shown.
 */
function settleNewIds(next: OwnerState, state: OwnerState, payload: EditPayload, ctx: PlanContext): OwnerState {
  const stateShows = new Map(state.shows.map((show) => [show.id, show]));
  const changedShows = next.shows.filter((show) => stateShows.get(show.id) !== show);
  const settingsChanged = next.settings !== state.settings;
  if (changedShows.length === 0 && !settingsChanged) return next;
  const candidates: string[] = [];
  const seen = new Set<string>();
  const note = (id: string) => {
    if (!seen.has(id)) {
      seen.add(id);
      candidates.push(id);
    }
  };
  collectIds(changedShows, note);
  if (settingsChanged) collectIds(next.settings, note);
  if (candidates.length === 0) return next;
  const known = new Set<string>();
  collectIds(state, (id) => known.add(id));
  collectIds(payload, (id) => known.add(id));
  const fresh = candidates.filter((id) => !known.has(id));
  if (fresh.length === 0) return next;
  const make = ctx.newId ?? ((seed: string) => ctx.trashId(`new-${seed}`));
  const names = new Map(fresh.map((id, i) => [id, make(String(i + 1))]));
  return {
    shows: next.shows.map((show) => (stateShows.get(show.id) === show ? show : rename(show, names))),
    settings: settingsChanged ? rename(next.settings, names) : next.settings,
  };
}

function withdrawalsBetween(before: OwnerState, after: OwnerState): Withdrawal[] {
  const out: Withdrawal[] = [];
  const keptSignatures = new Set((after.settings.signatureRequests ?? []).map((request) => request?.token));
  for (const request of before.settings.signatureRequests ?? []) {
    if (request?.token && !keptSignatures.has(request.token)) out.push({ kind: 'signature', request });
  }
  const keptProfiles = new Set((after.settings.profileRequests ?? []).map((request) => request?.token));
  for (const request of before.settings.profileRequests ?? []) {
    if (request?.token && !keptProfiles.has(request.token)) out.push({ kind: 'profile', request });
  }
  const viewerTokens = (state: OwnerState) => [
    ...state.shows.map((show) => ({ token: show.viewToken, show })),
    ...(state.settings.trash ?? []).map((item) => ({ token: item?.data?.viewToken, show: item?.data })),
  ];
  const keptViewers = new Set(viewerTokens(after).map((entry) => entry.token).filter(Boolean));
  const listed = new Set<string>();
  for (const { token, show } of viewerTokens(before)) {
    if (!token || typeof token !== 'string' || keptViewers.has(token) || listed.has(token) || !show) continue;
    listed.add(token);
    out.push({ kind: 'viewer', token, showId: show.id, showName: show.name });
  }
  return out;
}

function fingerprintOf(changes: ChangeGroup[], conflicts: Conflict[], notes: string[], withdrawals: Withdrawal[]): string {
  return JSON.stringify([
    changes.map((group) => [group.key, group.note ?? null, group.changes.map((change) => [change.key, change.before, change.after])]),
    conflicts.map((conflict) => [conflict.groupKey, conflict.key, conflict.asked, conflict.now, conflict.proposed]),
    notes,
    withdrawals.map((w) => [w.kind, w.kind === 'viewer' ? w.showId : w.request.id]),
  ]);
}

/**
 * Everything approving an edit would do to `state`, or why it cannot be
 * approved. See the module comment.
 */
export function planEdit(payload: EditPayload, state: OwnerState, ctx: PlanContext): PlanResult {
  if (payload?.kind !== 'edit' || forbidden(payload)) return { ok: false, reason: PLAN_REASONS.notAllowed };

  // 1. Files: each one the request points at is one it carries, or one the account already has.
  const known = liveMediaIds(state.shows, state.settings);
  const carried = new Set(ctx.mediaIds);
  for (const id of changedMediaIds(payload)) {
    if (!carried.has(id) && !known.has(id)) return { ok: false, reason: PLAN_REASONS.missingFile };
  }

  const sink: Sink = { conflicts: [], notes: [] };
  const conflicts: Conflict[] = [];
  let gone = false;
  let shows = [...state.shows];
  let settings = state.settings;
  const restored = new Set<string>();
  const trashAdded: DeletedItem[] = [];
  const deletedIds: string[] = [];

  const trashEdit = payload.settings?.fields.find((field) => field.field === 'trash');
  const trashRemoved = new Set(
    trashEdit && trashEdit.kind === 'rows' ? trashEdit.baseOrder.filter((id) => !trashEdit.proposedOrder.includes(id)) : [],
  );

  // 2. Shows, in the request's order.
  for (const edit of payload.shows) {
    const at = shows.findIndex((show) => show.id === edit.showId);
    if (edit.op === 'create') {
      const trashed = (state.settings.trash ?? []).find((item) => item?.data?.id === edit.showId && trashRemoved.has(item.id));
      if (trashed) {
        if (!sameMeaning(edit.show, viewOfShow(trashed.data, ctx.index))) {
          return { ok: false, reason: `This asks to restore ${quoted(trashed.data.name)} with changes. Ask them to restore it first, then make the changes.` };
        }
        if (at >= 0) {
          sink.notes.push(`${quoted(trashed.data.name)} is already there.`);
          continue;
        }
        // The owner's own copy goes back, its real viewer link included.
        shows = [trashed.data, ...shows];
        restored.add(edit.showId);
        continue;
      }
      if (at >= 0) {
        sink.notes.push(`${quoted(edit.show.name)} is already there.`);
        continue;
      }
      const created = { ...edit.show, createdAt: ctx.now, updatedAt: ctx.now } as Show;
      delete created.viewToken;
      delete created.viewerKey;
      shows = [created, ...shows];
      continue;
    }
    if (edit.op === 'update') {
      if (at < 0) {
        sink.notes.push(`${quoted(showName(edit.showId, state, own(edit.base, 'name') ?? own(edit.proposed, 'name')))} has been deleted since they asked, so their changes to it weren't applied.`);
        gone = true;
        continue;
      }
      const current = shows[at];
      const outcome = mergeRequestShow(edit, current, viewOfShow(current, ctx.index));
      sink.conflicts.push(...outcome.conflicts);
      sink.notes.push(...outcome.notes);
      if (outcome.notes.some((line) => line.startsWith('You removed'))) gone = true;
      if (outcome.value !== current) {
        shows = [...shows];
        shows[at] = { ...outcome.value, updatedAt: ctx.now };
      }
      continue;
    }
    if (at < 0) {
      sink.notes.push(`${quoted(showName(edit.showId, state, edit.base?.name))} was already deleted.`);
      gone = true;
      continue;
    }
    const current = shows[at];
    if (!sameMeaning(viewOfShow(current, ctx.index), edit.base)) {
      conflicts.push({ groupKey: groupKeyForShow(edit.showId), key: 'show', path: [], label: 'Changed since they asked to delete it', asked: 'As it was', now: 'Changed', proposed: 'Deleted' });
    }
    shows = shows.filter((_, i) => i !== at);
    // As the owner's own delete does: the show goes to Recently deleted, and
    // its id on the record of shows deleted on purpose.
    trashAdded.unshift({ id: ctx.trashId(edit.showId), type: 'show', data: stripShowMediaForTrash(current), deletedAt: ctx.now });
    deletedIds.unshift(edit.showId);
  }

  if (trashAdded.length || deletedIds.length || restored.size) {
    const added = new Set(deletedIds);
    settings = {
      ...settings,
      trash: [...trashAdded, ...(settings.trash ?? [])],
      deletedShowIds: [...deletedIds, ...(settings.deletedShowIds ?? []).filter((id) => !added.has(id) && !restored.has(id))].slice(0, MAX_DELETED_SHOW_IDS),
    };
  }

  // 3. Settings.
  if (payload.settings) {
    const outcome = mergeRequestSettings(payload.settings, settings, viewOfSettings(settings, ctx.index), ctx.index);
    sink.conflicts.push(...outcome.conflicts);
    sink.notes.push(...outcome.notes);
    if (outcome.notes.some((line) => line.startsWith('You removed'))) gone = true;
    if (outcome.value !== settings) {
      const healed = stripLegacySettingsMedia(healSettings(clone(outcome.value)));
      settings = normalizeComicSettings(healed, state.settings);
    }
  }
  if (trashAdded.length && (settings.trash ?? []).length > MAX_TRASH_ITEMS) {
    settings = { ...settings, trash: (settings.trash ?? []).slice(0, MAX_TRASH_ITEMS) };
  }

  // 4. The Rolodex, as the owner's own saves keep it.
  const stateShows = new Map(state.shows.map((show) => [show.id, show]));
  const showsTouched = shows.length !== state.shows.length || shows.some((show) => stateShows.get(show.id) !== show);
  if (showsTouched || settings !== state.settings) {
    const shared = reconcileRolodexProfiles(settings.potentialComics ?? [], shows);
    if (shared.comics !== settings.potentialComics) settings = { ...settings, potentialComics: shared.comics };
    shows = syncShowsWithRolodex(shared.comics, shared.shows);
  }

  let next = settleNewIds({ shows, settings }, state, payload, ctx);

  // 6. What gets written: changed shows without legacy media, and every
  // show whose content did not change as the owner's own object.
  const afterShows = next.shows.map((show) => {
    const before = stateShows.get(show.id);
    if (before === show) return show;
    const stripped = stripLegacyShowMedia(clone(show));
    return before && sameValue(before, stripped) ? before : stripped;
  });
  const afterSettings = sameValue(next.settings, state.settings) ? state.settings : next.settings;
  next = { shows: afterShows, settings: afterSettings };
  const after = next;

  // 5. Links approval withdraws.
  const withdrawals = withdrawalsBetween(state, after);
  const withdrawnViewers = new Set(withdrawals.flatMap((w) => (w.kind === 'viewer' ? [w.token] : [])));

  const afterIds = new Set(after.shows.map((show) => show.id));
  const upsert = after.shows.filter((show) => stateShows.get(show.id) !== show).map((show) => show.id);
  const remove = state.shows.filter((show) => !afterIds.has(show.id)).map((show) => show.id);
  const settingsChanged = after.settings !== state.settings;

  // 7. The complete before and after.
  const diffContext: DiffContext = { ...ctx.context, complete: true, state: after };
  const changes: ChangeGroup[] = [];
  const afterById = new Map(after.shows.map((show) => [show.id, show]));
  const ids = [...after.shows.map((show) => show.id), ...remove];
  for (const id of ids) {
    const before = stateShows.get(id) ?? null;
    const now = afterById.get(id) ?? null;
    if (before === now) continue;
    const group = diffShow(before, now, diffContext);
    if (!group) continue;
    if (restored.has(id)) group.note = 'Restored';
    // A deleted show keeps its viewer link in Recently deleted; only a link
    // this approval really withdraws reads as withdrawn.
    const token = before?.viewToken;
    if (!now && token && !withdrawnViewers.has(token)) group.changes = group.changes.filter((change) => change.key !== 'viewToken');
    changes.push(group);
  }
  if (settingsChanged) changes.push(...diffSettings(state.settings, after.settings, diffContext));

  if (upsert.length === 0 && remove.length === 0 && !settingsChanged) {
    return { ok: false, reason: gone ? PLAN_REASONS.nothingLeft : PLAN_REASONS.noChange };
  }

  const notes = [...new Set(sink.notes)];
  const candidates = [
    ...[...upsert, ...remove].flatMap((id) => {
      const before = stateShows.get(id);
      return before ? showMediaRefs(before) : [];
    }),
    ...(settingsChanged ? settingsMediaRefs(state.settings) : []),
  ];
  const orphaned = orphanedRefs(candidates, after.shows, after.settings).length;
  if (orphaned === 1) notes.push('1 file this replaces stays in your account until you use Free up space in Settings.');
  else if (orphaned > 1) notes.push(`${orphaned} files this replaces stay in your account until you use Free up space in Settings.`);

  // 8. Conflicts in words, against what the owner has now.
  const conflictContext: DiffContext = { ...ctx.context, complete: true, state };
  conflicts.push(...sink.conflicts.map((raw) => describeConflict(raw, conflictContext)));

  return {
    ok: true,
    before: state,
    after,
    upsert,
    remove,
    settingsChanged,
    withdrawals,
    changes,
    conflicts,
    notes,
    fingerprint: fingerprintOf(changes, conflicts, notes, withdrawals),
  };
}

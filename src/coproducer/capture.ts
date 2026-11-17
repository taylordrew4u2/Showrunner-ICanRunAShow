/**
 * What a co-producer's edits ask for, worked out from two copies of the
 * account: truth (what the server last served) and the working copy every
 * screen edits.
 *
 * Pure, and the one place an edit becomes an EditPayload. Nothing is read
 * from how the edit was made: a gesture that touched several things (a show
 * deleted, so the trash and the deleted record too) is one comparison, and so
 * one request. Only what differs travels, and only what the owner's app does
 * not work out for itself: timestamps, the viewer link, the recap's stored
 * profit, the deleted record, onboarding, trash entries and the bookkeeping
 * on link rows are the owner app's to make.
 */
import type { AppSettings, Show } from '../types';
import { getRolodexTerm } from '../utils/terminology';
import type { DiffContext } from './diff';
import { sameMeaning, sameValue } from './paths';
import { changedMediaIds, EDITABLE_SETTINGS_FIELDS, isShowKey } from './schema';
import {
  REDACTED_TOKEN_PREFIX,
  REMOVE_ONLY_ROW_FIELDS,
  SETTINGS_DERIVED_FIELDS,
  SETTINGS_ROW_FIELDS,
  type EditPayload,
  type SettingsFieldEdit,
  type SettingsKey,
  type ShowEdit,
  type ShowKey,
} from './types';

/** What the server last served, tidied as the app tidies it. */
export interface ReviewTruth {
  shows: Show[];
  settings: AppSettings;
  /** Each show's revision as served, by id. */
  showRevisions: Record<string, string>;
  settingsRevision: string | null;
}

/** How co-producer view describes a change: names and items from truth, in the account's own words. */
export function reviewDiffContext(truth: Pick<ReviewTruth, 'shows' | 'settings'>): DiffContext {
  return {
    state: { shows: truth.shows, settings: truth.settings },
    musicLibrary: truth.settings.musicLibrary,
    rolodexPlural: getRolodexTerm(truth.settings).plural,
  };
}

type Loose = Record<string, unknown>;

function own(value: object, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(value, key) ? (value as Loose)[key] : undefined;
}

/** The same value with what neither producer types left out, for telling which keys changed. */
function meaningOf(key: string, value: unknown): unknown {
  if (key !== 'recap' || !value || typeof value !== 'object' || Array.isArray(value)) return value;
  const rest: Loose = { ...(value as Loose) };
  delete rest.profitLoss;
  return rest;
}

/** A show as a request may carry it: never the viewer link's audio key. */
function withoutViewerKey(show: Show): Show {
  if (!Object.prototype.hasOwnProperty.call(show, 'viewerKey')) return show;
  const copy = { ...show };
  delete copy.viewerKey;
  return copy;
}

function updateFor(base: Show, working: Show, revision: string | null): ShowEdit | null {
  const keys: ShowKey[] = [];
  const before: Loose = {};
  const after: Loose = {};
  for (const key of new Set([...Object.keys(base), ...Object.keys(working)])) {
    if (!isShowKey(key)) continue;
    const was = own(base, key);
    const now = own(working, key);
    if (sameValue(meaningOf(key, was), meaningOf(key, now))) continue;
    keys.push(key);
    if (was !== undefined) before[key] = was;
    if (now !== undefined) after[key] = now;
  }
  if (keys.length === 0) return null;
  return {
    target: 'show',
    op: 'update',
    showId: working.id,
    baseRevision: revision,
    keys,
    base: before as Partial<Show>,
    proposed: after as Partial<Show>,
  };
}

/**
 * A new show as a request carries it. Its viewer link can only be one the
 * owner's trash already holds: a show the co-producer restored keeps the
 * pseudonym the server showed them (the owner's app puts back its own copy,
 * real link and all); anything else made here never has one.
 */
function createFor(working: Show, restoredIds: ReadonlySet<string>): ShowEdit {
  const show: Show = { ...withoutViewerKey(working) };
  const token = show.viewToken;
  const restore = restoredIds.has(show.id) && typeof token === 'string' && token.startsWith(REDACTED_TOKEN_PREFIX);
  if (!restore) delete show.viewToken;
  return { target: 'show', op: 'create', showId: working.id, show };
}

/** Ids of shows whose trash entries the working copy no longer has. */
function restoredShowIds(truth: AppSettings, working: AppSettings): Set<string> {
  const kept = new Set((working.trash ?? []).map((item) => item?.id));
  const ids = new Set<string>();
  for (const item of truth.trash ?? []) {
    if (item && !kept.has(item.id) && typeof item.data?.id === 'string') ids.add(item.data.id);
  }
  return ids;
}

function showEdits(truth: ReviewTruth, working: { shows: Show[]; settings: AppSettings }): ShowEdit[] {
  const before = new Map(truth.shows.map((show) => [show.id, show]));
  const after = new Map(working.shows.map((show) => [show.id, show]));
  const restored = restoredShowIds(truth.settings, working.settings);
  const edits: ShowEdit[] = [];
  for (const [id, show] of after) {
    const base = before.get(id);
    if (!base) {
      edits.push(createFor(show, restored));
      continue;
    }
    if (sameMeaning(base, show)) continue;
    const update = updateFor(base, show, truth.showRevisions[id] ?? null);
    if (update) edits.push(update);
  }
  for (const [id, show] of before) {
    if (after.has(id)) continue;
    edits.push({ target: 'show', op: 'delete', showId: id, baseRevision: truth.showRevisions[id] ?? null, base: withoutViewerKey(show) });
  }
  return edits;
}

/** A row list's rows by id, in order; rows with no id of the list's kind, and repeats, left out. */
function rowsById(list: unknown, idField: string): Map<string, unknown> {
  const rows = new Map<string, unknown>();
  if (!Array.isArray(list)) return rows;
  for (const row of list) {
    if (!row || typeof row !== 'object') continue;
    const id = own(row, idField);
    if (typeof id === 'string' && !rows.has(id)) rows.set(id, row);
  }
  return rows;
}

function rowsEdit(field: SettingsKey, idField: string, was: unknown, now: unknown): SettingsFieldEdit | null {
  const before = rowsById(was, idField);
  const after = rowsById(now, idField);
  const baseOrder = [...before.keys()];
  if (REMOVE_ONLY_ROW_FIELDS.has(field)) {
    // Only what was taken away: the owner's app makes its own trash entries,
    // and fills in link rows' bookkeeping itself.
    const removed = baseOrder.filter((id) => !after.has(id));
    if (removed.length === 0) return null;
    return {
      field,
      kind: 'rows',
      idField,
      baseOrder,
      proposedOrder: baseOrder.filter((id) => after.has(id)),
      base: removed.map((id) => [id, before.get(id)]),
      proposed: [],
    };
  }
  const proposedOrder = [...after.keys()];
  const base: [string, unknown][] = [];
  const proposed: [string, unknown][] = [];
  for (const [id, row] of before) {
    if (!after.has(id) || !sameValue(row, after.get(id))) base.push([id, row]);
  }
  for (const [id, row] of after) {
    if (!before.has(id) || !sameValue(before.get(id), row)) proposed.push([id, row]);
  }
  if (base.length === 0 && proposed.length === 0 && sameValue(baseOrder, proposedOrder)) return null;
  return { field, kind: 'rows', idField, baseOrder, proposedOrder, base, proposed };
}

function settingsEdits(truth: AppSettings, working: AppSettings): SettingsFieldEdit[] {
  const fields: SettingsFieldEdit[] = [];
  const keys = new Set([...Object.keys(truth), ...Object.keys(working)] as SettingsKey[]);
  for (const field of keys) {
    if (SETTINGS_DERIVED_FIELDS.includes(field) || !EDITABLE_SETTINGS_FIELDS.has(field)) continue;
    const was = own(truth, field);
    const now = own(working, field);
    if (sameValue(was, now)) continue;
    const idField = SETTINGS_ROW_FIELDS.get(field);
    if (idField !== undefined) {
      const edit = rowsEdit(field, idField, was, now);
      if (edit) fields.push(edit);
      continue;
    }
    const edit: SettingsFieldEdit = { field, kind: 'value' };
    if (was !== undefined) edit.base = was;
    if (now !== undefined) edit.proposed = now;
    fields.push(edit);
  }
  return fields;
}

/** What the working copy asks for, against truth. Null when nothing meaningful changed. */
export function buildEditPayload(truth: ReviewTruth, working: { shows: Show[]; settings: AppSettings }): EditPayload | null {
  const shows = showEdits(truth, working);
  const fields = settingsEdits(truth.settings, working.settings);
  if (shows.length === 0 && fields.length === 0) return null;
  return {
    kind: 'edit',
    shows,
    settings: fields.length > 0 ? { target: 'settings', baseRevision: truth.settingsRevision, fields } : null,
  };
}

/** The files this payload brings in that were staged from this page: they travel with the request. */
export function stagedMediaIds(payload: EditPayload, staged: ReadonlySet<string>): string[] {
  return changedMediaIds(payload).filter((id) => staged.has(id));
}

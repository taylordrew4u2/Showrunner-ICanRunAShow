/**
 * The co-producer's open requests, cut up by where they land on the screens.
 *
 * Each open edit is described against truth (what the account holds now), and
 * every change in it becomes a mark filed under its group: 'show:<id>' for a
 * show, 'settings:<field>' or 'settings:workspace' for settings. A screen asks
 * for the marks under its own place (a field, a section, a row) by path
 * prefix, so the Basic Info card finds the venue a request changes and the
 * performers section finds the row it adds, without either knowing how the
 * other is laid out.
 *
 * Shares and downloads leave no marks: the button that asked for one shows its
 * own state (AskButton). Pure and synchronous.
 */
import type { AppSettings, Show } from '../types';
import { describePayload, visibleText, type DiffContext } from './diff';
import type { PendingMark, PendingOverlayValue } from './PendingOverlay';
import { sameValue, underPath } from './paths';
import type { CoproducerRequestDetail, EditPayload } from './types';

const NO_MARKS: PendingMark[] = [];

function isOpen(status: string): status is 'pending' | 'stale' {
  return status === 'pending' || status === 'stale';
}

/** Oldest first, so a screen lists requests in the order they were made. */
function byAge(a: CoproducerRequestDetail, b: CoproducerRequestDetail): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * The overlay for every open edit among `details`, described against `truth`.
 *
 * Requests that are no longer open (approved, rejected, withdrawn) are left
 * out whatever their detail says, and a request whose payload cannot be
 * described is skipped rather than costing the others their marks.
 */
export function buildPendingOverlay(
  details: readonly CoproducerRequestDetail[],
  truth: { shows: Show[]; settings: AppSettings },
  context: DiffContext = {},
): PendingOverlayValue {
  const describeWith: DiffContext = { ...context, complete: false, state: { shows: truth.shows, settings: truth.settings } };
  const known = new Set(truth.shows.map((show) => show.id));
  const byGroup = new Map<string, PendingMark[]>();
  const newShows: PendingOverlayValue['newShows'] = [];
  const shown = new Set<string>();

  for (const detail of [...details].sort(byAge)) {
    const status = detail.status;
    if (!isOpen(status) || detail.payload.kind !== 'edit') continue;
    let groups;
    try {
      groups = describePayload(detail.payload, describeWith);
    } catch {
      continue;
    }
    for (const group of groups) {
      let list = byGroup.get(group.key);
      if (!list) byGroup.set(group.key, (list = []));
      for (const change of group.changes) {
        list.push({ requestId: detail.id, status, createdAt: detail.createdAt, groupKey: group.key, change });
      }
    }
    for (const edit of detail.payload.shows) {
      if (edit.op !== 'create' || known.has(edit.showId) || shown.has(edit.showId)) continue;
      shown.add(edit.showId);
      const name = typeof edit.show.name === 'string' ? visibleText(edit.show.name.trim()) : '';
      newShows.push({ requestId: detail.id, showId: edit.showId, name: name || 'Untitled show' });
    }
  }

  // Screens ask on every render; the same question gets the same array back.
  const asked = new Map<string, PendingMark[]>();
  return {
    marks(groupKey: string, prefix?: string): PendingMark[] {
      const all = byGroup.get(groupKey);
      if (!all) return NO_MARKS;
      if (prefix === undefined) return all;
      const question = `${groupKey}\u0000${prefix}`;
      let found = asked.get(question);
      if (!found) {
        const under = all.filter((mark) => underPath(mark.change.key, prefix));
        found = under.length > 0 ? under : NO_MARKS;
        asked.set(question, found);
      }
      return found;
    },
    newShows,
  };
}

// ── Has an approved edit reached the account? ─────────────────────────────

type Plain = Record<string, unknown>;

function isPlain(value: unknown): value is Plain {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function own(value: unknown, key: string): unknown {
  return isPlain(value) && Object.prototype.hasOwnProperty.call(value, key) ? value[key] : undefined;
}

/** A list of records keyed by `idKey`, or null for anything else. */
function rowsById(value: unknown, idKey: string): Map<string, unknown> | null {
  if (!Array.isArray(value) || !value.every((row) => isPlain(row) && typeof row[idKey] === 'string')) return null;
  return new Map(value.map((row) => [(row as Plain)[idKey] as string, row]));
}

function isWords(value: unknown): value is (string | number | boolean)[] {
  return Array.isArray(value) && value.every((item) => item === null || typeof item !== 'object');
}

/**
 * Whether `current` holds what a change from `base` to `proposed` asked for,
 * looking only at what changed: the fields of a row the change touched, the
 * rows it added and removed, the words of a list it added and removed.
 * Everything the owner's app did around it (other rows, timestamps, an order)
 * is not asked about, so an approval that went in reads as in.
 */
function holds(base: unknown, proposed: unknown, current: unknown, idKey = 'id'): boolean {
  if (sameValue(base, proposed)) return true;
  if (Array.isArray(base) || Array.isArray(proposed)) {
    const baseRows = rowsById(base ?? [], idKey);
    const proposedRows = rowsById(proposed ?? [], idKey);
    if (baseRows && proposedRows && (baseRows.size > 0 || proposedRows.size > 0)) {
      const currentRows = rowsById(current ?? [], idKey);
      if (!currentRows) return false;
      for (const [id, row] of proposedRows) {
        if (!currentRows.has(id)) return false;
        if (baseRows.has(id) && !holds(baseRows.get(id), row, currentRows.get(id))) return false;
      }
      for (const id of baseRows.keys()) if (!proposedRows.has(id) && currentRows.has(id)) return false;
      return true;
    }
    const before = base ?? [];
    const after = proposed ?? [];
    if (isWords(before) && isWords(after)) {
      const now = new Set(Array.isArray(current) ? current : []);
      return after.every((item) => before.includes(item) || now.has(item))
        && before.every((item) => after.includes(item) || !now.has(item));
    }
    return sameValue(current, proposed);
  }
  if (isPlain(base) && isPlain(proposed)) {
    if (!isPlain(current)) return false;
    const keys = new Set([...Object.keys(base), ...Object.keys(proposed)]);
    for (const key of keys) if (!holds(own(base, key), own(proposed, key), own(current, key))) return false;
    return true;
  }
  return sameValue(current, proposed);
}

/**
 * Whether the account as now served (`truth`) holds what an edit asked for:
 * a show it added is there, one it deleted is gone, and every value and row
 * it changed reads as proposed. Tells "Approved and added" from an approval
 * the owner's app has not saved yet.
 */
export function editLanded(payload: EditPayload, truth: { shows: Show[]; settings: AppSettings }): boolean {
  const shows = new Map(truth.shows.map((show) => [show.id, show]));
  for (const edit of payload.shows) {
    const show = shows.get(edit.showId);
    if (edit.op === 'create' && !show) return false;
    if (edit.op === 'delete' && show) return false;
    if (edit.op === 'update') {
      if (!show) return false;
      for (const key of edit.keys) {
        if (!holds(own(edit.base, key), own(edit.proposed, key), own(show, key))) return false;
      }
    }
  }
  for (const field of payload.settings?.fields ?? []) {
    const current = own(truth.settings, field.field);
    if (field.kind === 'value') {
      if (!holds(own(field, 'base'), own(field, 'proposed'), current)) return false;
      continue;
    }
    const rows = rowsById(current ?? [], field.idField);
    if (!rows) return false;
    const base = new Map(field.base);
    for (const [id, row] of field.proposed) {
      if (!rows.has(id)) return false;
      if (base.has(id) && !holds(base.get(id), row, rows.get(id))) return false;
    }
    const kept = new Set(field.proposedOrder);
    for (const id of field.baseOrder) if (!kept.has(id) && rows.has(id)) return false;
  }
  return true;
}

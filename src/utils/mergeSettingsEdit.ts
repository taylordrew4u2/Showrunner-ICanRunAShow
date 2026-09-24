import type { AppSettings } from '../types';
import { mergeRolodexEdits } from './mergeRolodexEdits';

/** Settings contain JSON values; cloned snapshots are not edits by themselves. */
function sameValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length &&
      left.every((value, index) => sameValue(value, right[index]));
  }
  const one = left as Record<string, unknown>;
  const two = right as Record<string, unknown>;
  return [...new Set([...Object.keys(one), ...Object.keys(two)])]
    .every((field) => sameValue(one[field], two[field]));
}

function mergeRecord(
  baseline: Record<string, unknown>,
  incoming: Record<string, unknown>,
  current: Record<string, unknown>,
): Record<string, unknown> {
  let merged = current;
  for (const field of new Set([...Object.keys(baseline), ...Object.keys(incoming)])) {
    if (sameValue(baseline[field], incoming[field]) || sameValue(current[field], incoming[field])) continue;
    if (merged === current) merged = { ...current };
    if (Object.hasOwn(incoming, field)) merged[field] = incoming[field];
    else delete merged[field];
  }
  return merged;
}

type Row = Record<string, unknown> | string;

/** Apply edits by identity, retaining rows created after the editor opened. */
function mergeRows(baseline: Row[], incoming: Row[], current: Row[], idField?: string): Row[] {
  const key = (row: Row): string => typeof row === 'string' ? row : String(row[idField!]);
  const beforeById = new Map(baseline.map((row) => [key(row), row]));
  const incomingById = new Map(incoming.map((row) => [key(row), row]));
  const currentIds = new Set(current.map(key));
  const kept: Row[] = [];
  for (const row of current) {
    const id = key(row);
    const before = beforeById.get(id);
    const edited = incomingById.get(id);
    if (before !== undefined && edited === undefined) continue;
    if (before === undefined || edited === undefined || typeof row === 'string') {
      kept.push(row);
      continue;
    }
    kept.push(mergeRecord(before as Record<string, unknown>, edited as Record<string, unknown>, row));
  }

  // New additions keep their intended position relative to existing rows.
  // A row deleted from current is never resurrected by a stale snapshot.
  for (let index = 0; index < incoming.length; index += 1) {
    const row = incoming[index];
    const id = key(row);
    if (beforeById.has(id) || currentIds.has(id)) continue;
    const after = incoming.slice(index + 1).find((candidate) => kept.some((item) => key(item) === key(candidate)));
    if (after !== undefined) {
      kept.splice(kept.findIndex((item) => key(item) === key(after)), 0, row);
    } else {
      const before = incoming.slice(0, index).reverse().find((candidate) => kept.some((item) => key(item) === key(candidate)));
      if (before !== undefined) kept.splice(kept.findIndex((item) => key(item) === key(before)) + 1, 0, row);
      else kept.push(row);
    }
  }

  // Reorder only when the editor actually changed the old rows' order.
  // Current-only rows retain their position while edited rows move around them.
  const oldOrder = baseline.map(key).filter((id) => incomingById.has(id) && currentIds.has(id));
  const editedOrder = incoming.map(key).filter((id) => beforeById.has(id) && currentIds.has(id));
  if (!sameValue(oldOrder, editedOrder)) {
    const keptById = new Map(kept.map((row) => [key(row), row]));
    const ordered = incoming.map((row) => keptById.get(key(row))).filter((row): row is Row => row !== undefined);
    let index = 0;
    for (let slot = 0; slot < kept.length; slot += 1) {
      if (incomingById.has(key(kept[slot]))) kept[slot] = ordered[index++];
    }
  }
  return kept.length === current.length && kept.every((row, index) => row === current[index]) ? current : kept;
}

const RECORD_ARRAY_KEYS: Partial<Record<keyof AppSettings, string>> = {
  producers: 'id', trash: 'id', expenses: 'id', emailList: 'email',
  scheduleTemplates: 'id', musicLibrary: 'id', contracts: 'id', signedAgreements: 'id',
  signatureRequests: 'token', profileRequests: 'token',
};

/**
 * Apply what a settings editor or asynchronous refresh changed to the latest
 * state. Its untouched snapshot must not undo a new link, a newer receipt,
 * current profile information, or unrelated brand settings.
 */
export function mergeSettingsEdit(
  baseline: AppSettings,
  incoming: AppSettings,
  current: AppSettings,
): AppSettings {
  let merged = current;
  for (const field of new Set([...Object.keys(baseline), ...Object.keys(incoming)]) as Set<keyof AppSettings>) {
    if (sameValue(baseline[field], incoming[field])) continue;
    let value: unknown = incoming[field];
    if (field === 'potentialComics') {
      value = mergeRolodexEdits(baseline.potentialComics, incoming.potentialComics, current.potentialComics);
    } else if (RECORD_ARRAY_KEYS[field] || field === 'showTypes' || field === 'deletedShowIds') {
      const rows = mergeRows(
        (baseline[field] ?? []) as Row[],
        (incoming[field] ?? []) as Row[],
        (current[field] ?? []) as Row[],
        RECORD_ARRAY_KEYS[field],
      );
      value = rows.length === 0 && incoming[field] === undefined ? undefined : rows;
    }
    if (sameValue(current[field], value)) continue;
    if (merged === current) merged = { ...current };
    Object.assign(merged, { [field]: value });
  }
  return merged;
}

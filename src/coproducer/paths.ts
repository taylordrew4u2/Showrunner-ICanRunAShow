/**
 * One grammar for where a change lives, shared by the diff (FieldChange.key),
 * the owner's merge (RawConflict.path) and the co-producer's screens (the
 * pending marks they look up), so none of them guesses another's.
 *
 * | Where                                             | Key                                  |
 * |---------------------------------------------------|--------------------------------------|
 * | a top-level show or settings value                | `<field>`                            |
 * | an item of a set-like list (hiddenSections,       | `<field>/<seg(item)>`                |
 * |   djHiddenLibraryIds, showTypes)                  |                                      |
 * | a sub-key of recap or completions                 | `recap/<subKey>`, `completions/<s>`  |
 * | a whole row, added or removed                     | `<list>/<seg(rowId)>`                |
 * | one field of a row                                | `<list>/<seg(rowId)>/<field>`        |
 * | a nested list in a row (template items, contract  | `<list>/<seg(rowId)>/<field>/<i>`    |
 * |   questions, a signed record's answers)           |                                      |
 * | the order of rows present on both sides           | `<list>#order`                       |
 * | a whole show, created, deleted or restored        | `show`                               |
 * | a show's viewer link withdrawn                    | `viewToken`                          |
 *
 * Settings rows are known by their SETTINGS_ROW_FIELDS id, so an email list
 * row is `emailList/<seg(email)>` and a contract link
 * `signatureRequests/<seg(pseudonymous token)>`.
 */
import type { Show } from '../types';
import type { SettingsKey } from './types';

function own(value: object, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(value, key) ? (value as Record<string, unknown>)[key] : undefined;
}

/**
 * Whether two values mean the same: the same primitive, or lists of the same
 * values in the same order, or objects whose own enumerable keys hold the
 * same values. A key holding undefined reads as a key that is not there, as
 * it does once JSON has carried the object across.
 */
export function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, index) => sameValue(value, b[index]));
  }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (!sameValue(own(a, key), own(b, key))) return false;
  }
  return true;
}

/** Keys the owner's app keeps up to date by itself, or that are secrets the co-producer never sees. */
function withoutBookkeeping(show: Show): unknown {
  const copy: Record<string, unknown> = { ...(show as unknown as Record<string, unknown>) };
  delete copy.updatedAt;
  delete copy.createdAt;
  delete copy.viewerKey;
  delete copy.viewToken;
  const recap = copy.recap;
  if (recap && typeof recap === 'object' && !Array.isArray(recap)) {
    const rest: Record<string, unknown> = { ...(recap as Record<string, unknown>) };
    delete rest.profitLoss;
    copy.recap = rest;
  }
  return copy;
}

/**
 * sameValue, after leaving out of both what neither producer types: the two
 * timestamps, the viewer link's token and key, and the recap's stored
 * profit (worked out again from its figures). Used to tell a show that was
 * really changed from one that was only saved again.
 */
export function sameMeaning(a: Show, b: Show): boolean {
  return sameValue(withoutBookkeeping(a), withoutBookkeeping(b));
}

/** One path segment for an id, which may hold '/', '#' or anything else. */
export function seg(id: string): string {
  return encodeURIComponent(id);
}

export function groupKeyForShow(id: string): string {
  return `show:${id}`;
}

/** Settings fields shown together under one "Settings" heading, in this order. */
export const SETTINGS_WORKSPACE_FIELDS: readonly SettingsKey[] = [
  'brandName',
  'showTypes',
  'rolodexTermSingular',
  'rolodexTermPlural',
  'producers',
  'brandBudget',
  'totalSpent',
  'rules',
  'remoteMusicKey',
  'deletedShowIds',
  'onboarded',
];
const WORKSPACE = new Set<SettingsKey>(SETTINGS_WORKSPACE_FIELDS);

export function groupKeyForSettings(field: SettingsKey): string {
  return WORKSPACE.has(field) ? 'settings:workspace' : `settings:${field}`;
}

/** True when `key` is `prefix` itself or lies under it. */
export function underPath(key: string, prefix: string): boolean {
  return key === prefix || key.startsWith(`${prefix}/`) || key.startsWith(`${prefix}#`);
}

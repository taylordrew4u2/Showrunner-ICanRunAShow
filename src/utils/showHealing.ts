import type { Show, ShowStatus } from '../types';
import { promoteCoHost, type HostFields } from './showHosts';

/**
 * Make a decrypted blob safe to render as a show.
 *
 * The shows list reads `show.performers.length`, `show.artists.length` and
 * `show.schedule.length` without guarding — the dashboard counts do it, and so
 * does every card. A show written before one of those fields existed (or by an
 * import that skipped it) therefore throws while the page renders, and the
 * error boundary takes the *whole* list down with it. One bad row shouldn't
 * cost you every show you own.
 *
 * So every list field is forced to an array and every string field to a string
 * on the way in. The only thing worth rejecting outright is a blob with no id:
 * without one it can't be opened, edited, or saved back.
 */

/** Fields the app indexes into as arrays without checking first. */
const LIST_FIELDS = [
  'performers',
  'artists',
  'schedule',
  'hosts',
  'djSongs',
  'staff',
  'expenses',
] as const;

/** Optional lists — absent is fine, but a non-array is not. */
const OPTIONAL_LIST_FIELDS = ['vendors', 'scenes', 'todos', 'hiddenSections'] as const;

/** Fields rendered directly as text. */
const TEXT_FIELDS = ['name', 'date', 'time', 'location', 'venueName'] as const;

/**
 * The two hosts: each a name, a handle and the Rolodex entry they were picked
 * from. All optional, and a show saved before there could be two has only
 * `host`, which is the first host as it stands.
 */
const HOST_FIELDS = ['host', 'hostSocial', 'hostComicId', 'coHost', 'coHostSocial', 'coHostComicId'] as const;

const STATUSES = new Set<ShowStatus>(['upcoming', 'in-progress', 'completed', 'cancelled']);

/**
 * Returns a renderable show, or null when the blob can't be one. Callers should
 * treat null as "this row is unreadable" and keep its ciphertext rather than
 * dropping the row — see loadEncryptedShows.
 *
 * Repairs in place and hands back the same object. Every caller passes a blob
 * fresh out of JSON.parse, so there's nothing else holding a reference to it.
 */
export function healShow(raw: unknown): Show | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const show = raw as Record<string, unknown>;
  if (typeof show.id !== 'string' || show.id === '') return null;

  for (const field of LIST_FIELDS) {
    if (!Array.isArray(show[field])) show[field] = [];
  }
  for (const field of OPTIONAL_LIST_FIELDS) {
    if (field in show && !Array.isArray(show[field])) delete show[field];
  }
  for (const field of TEXT_FIELDS) {
    if (typeof show[field] !== 'string') show[field] = '';
  }
  // Printed as text wherever the host is, so anything else is no host.
  for (const field of HOST_FIELDS) {
    if (field in show && typeof show[field] !== 'string') delete show[field];
  }
  // One host, and in the second slot: everything that reads `host` alone
  // would find nobody hosting.
  Object.assign(show, promoteCoHost(show as HostFields));
  // An unnamed show is indistinguishable from every other unnamed show in a
  // list, so give it something to be called rather than a blank row. A name
  // that's only spaces reads as blank too.
  if ((show.name as string).trim() === '') show.name = 'Untitled show';
  if (!STATUSES.has(show.status as ShowStatus)) show.status = 'upcoming';

  const now = new Date().toISOString();
  if (typeof show.createdAt !== 'string') show.createdAt = now;
  if (typeof show.updatedAt !== 'string') show.updatedAt = show.createdAt;

  return show as unknown as Show;
}

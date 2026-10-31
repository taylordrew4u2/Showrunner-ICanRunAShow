import CryptoJS from 'crypto-js';
import type { Show } from '../types';
import { healShow } from './showHealing';
import { completePastShows } from './showsOverview';

const hash = (show: Show) => CryptoJS.SHA256(JSON.stringify(show)).toString();

/** The later of two versions of one show, by the clock they carry.
 *
 * The same rule mergePendingShows uses, so "who wins" does not depend on which
 * of the two recovery paths a launch happens to take. A missing or unparseable
 * stamp loses to a real one; with neither, the held copy wins, because that is
 * the work the user can still see on screen. */
function newer(local: Show, remote: Show): Show {
  const a = Date.parse(local.updatedAt ?? '');
  const b = Date.parse(remote.updatedAt ?? '');
  return Number.isFinite(b) && b > (Number.isFinite(a) ? a : 0) ? remote : local;
}

/** Whether a held show differs from the version it was made over only as
 * completePastShows changed it: a launch, not the producer, did that. One
 * completed by hand on its own night is still an edit. */
function onlyCompletedOnLaunch(local: Show, madeOver: string | undefined): boolean {
  if (madeOver === undefined || local.status !== 'completed') return false;
  const before: Show = { ...local, status: 'upcoming' };
  return hash(before) === madeOver && completePastShows([before])[0] !== before;
}

/** Recover local edits without treating a stale whole-list backup as truth.
 * If both sides changed, keep the server show and a distinct recovered copy.
 *
 * `sent` is what the held copy's tab had sent of each show when the copy was
 * written. A save can land after the copy was held — Run Show saves on every
 * tick — and the server then has the tab's own edit, which the copy already
 * contains. That is the version the copy was made over, not somebody else's. */
export function recoverShowDraft(draft: Show[], server: Show[], baseline: Record<string, string> = {}, sent: Record<string, string[]> = {}): Show[] {
  if (!Array.isArray(draft)) return server;
  const result = new Map(server.map(s => [s.id, s]));
  const madeOver = (id: string, remote: Show) => hash(remote) === baseline[id] || (sent[id] ?? []).includes(hash(remote));
  const held = new Set<string>();
  for (const value of draft) {
    if (value && typeof value.id === 'string') held.add(value.id);
    const local = healShow(value);
    if (!local) continue;
    const localHash = hash(local);
    const remote = result.get(local.id);
    if (localHash === baseline[local.id] || (remote && hash(remote) === localHash)) continue;
    // Every launch marks a show whose night has passed completed, and the held
    // copy is the whole list, so it carries that as well. Once another device
    // had saved the show, that read as an edit made over a version since
    // replaced, and came back as a "(recovered edits)" copy holding nothing
    // else. It is no more this device's edit than the server's copy is.
    if (onlyCompletedOnLaunch(local, baseline[local.id])) continue;
    if ((!remote && !baseline[local.id]) || (remote && madeOver(local.id, remote))) {
      result.set(local.id, local);
    } else if (!baseline[local.id]) {
      // No baseline for this show, so nothing here is evidence that the server
      // moved under us — and a fork needs that evidence. This is the ordinary
      // case of a show made on this device: the held copy is written before
      // the save lands, so it carries no hash for a row the server then has.
      // Read as a conflict, it forked every show on the account into a
      // "(recovered edits)" twin of itself. The later edit wins instead.
      result.set(local.id, remote ? newer(local, remote) : local);
    } else {
      const id = `${local.id}-recovered-${localHash.slice(0, 16)}`;
      if (!result.has(id)) result.set(id, { ...local, id, name: `${local.name} (recovered edits)` });
    }
  }
  // A show this device loaded and no longer holds was deleted here: the held
  // copy is the whole list as it stood when it was written. Starting from the
  // server's list quietly put every such show back, so a delete made in the
  // basement — offline, or backgrounded inside the save's debounce — un-happened
  // on the next launch, while the trash still held its copy. Honour it only
  // while the server has exactly what this device loaded, or sent; an edit
  // made elsewhere since is a conflict, and there the edit wins over the
  // deletion.
  for (const id of new Set([...Object.keys(baseline), ...Object.keys(sent)])) {
    if (held.has(id)) continue;
    const remote = result.get(id);
    if (remote && madeOver(id, remote)) result.delete(id);
  }
  return [...result.values()];
}

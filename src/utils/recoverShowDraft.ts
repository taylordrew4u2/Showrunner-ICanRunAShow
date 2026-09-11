import CryptoJS from 'crypto-js';
import type { Show } from '../types';
import { healShow } from './showHealing';

const hash = (show: Show) => CryptoJS.SHA256(JSON.stringify(show)).toString();

/** Recover local edits without treating a stale whole-list backup as truth.
 * If both sides changed, keep the server show and a distinct recovered copy. */
export function recoverShowDraft(draft: Show[], server: Show[], baseline: Record<string, string> = {}): Show[] {
  if (!Array.isArray(draft)) return server;
  const result = new Map(server.map(s => [s.id, s]));
  for (const value of draft) {
    const local = healShow(value);
    if (!local) continue;
    const localHash = hash(local);
    const remote = result.get(local.id);
    if (localHash === baseline[local.id] || (remote && hash(remote) === localHash)) continue;
    if ((!remote && !baseline[local.id]) || (remote && hash(remote) === baseline[local.id])) {
      result.set(local.id, local);
    } else {
      const id = `${local.id}-recovered-${localHash.slice(0, 16)}`;
      if (!result.has(id)) result.set(id, { ...local, id, name: `${local.name} (recovered edits)` });
    }
  }
  return [...result.values()];
}

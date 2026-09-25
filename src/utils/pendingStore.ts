import { normalizeUsername, sameAccount } from './session-vault';

export interface Pending<T> { data: T; at: number; metadata?: { settingsHash?: string | null; showHashes?: Record<string, string> } }

/** One slot per tab and account. A successful save cannot clear another
 * tab's edits, or a newer draft written while a request was in flight. */
export function createPendingStore(storage: () => Storage, writer: string) {
  const claimed = new Map<string, Map<string, string>>();
  // Filed under the account, not the name as typed: the account is the same
  // whether the keyboard capitalised it, and the draft has to be found either way.
  const scope = (key: string, username: string) => `${key}:${encodeURIComponent(normalizeUsername(username))}:`;
  const slot = (key: string, username: string) => scope(key, username) + writer;
  function list<T>(key: string, username: string): Array<Pending<T> & { key: string; raw: string }> {
    try {
      const store = storage();
      const result = [];
      for (let i = 0; i < store.length; i++) {
        const name = store.key(i)!;
        // Every slot under this key, whichever spelling of the name an earlier
        // build filed it under; the entry itself says whose it is.
        if (name !== key && !name.startsWith(`${key}:`)) continue;
        const raw = store.getItem(name)!;
        try {
          const value = JSON.parse(raw);
          if (sameAccount(value.username, username) && 'data' in value) result.push({ data: value.data, at: value.at ?? 0, key: name, raw, metadata: value.metadata });
        } catch { /* Keep damaged entries; never delete an unreadable draft. */ }
      }
      return result.sort((a, b) => a.at - b.at);
    } catch { return []; }
  }
  return {
    list,
    readAll<T>(key: string, username: string): Pending<T>[] {
      const entries = list<T>(key, username);
      claimed.set(scope(key, username), new Map(entries.map(e => [e.key, e.raw])));
      return entries;
    },
    // The newest draft. A caller that has already listed them passes the list
    // in, so a launch does not parse every draft on the device twice.
    read<T>(key: string, username: string, entries = list<T>(key, username)): Pending<T> | null {
      const latest = entries.at(-1);
      if (!latest) return null;
      claimed.set(scope(key, username), new Map([[latest.key, latest.raw]]));
      return latest;
    },
    write(key: string, username: string, data: unknown, metadata?: Pending<unknown>['metadata']): boolean {
      try {
        const raw = JSON.stringify({ username, data, at: Date.now(), metadata });
        const name = slot(key, username);
        storage().setItem(name, raw);
        const group = claimed.get(scope(key, username)) ?? new Map();
        group.set(name, raw);
        claimed.set(scope(key, username), group);
        return true;
      } catch { return false; }
    },
    // Let go of one draft on its own, once it is kept somewhere else — parked
    // on the account, say. Only those exact bytes: a tab that has since
    // written a newer draft into the same slot keeps it.
    discard(entry: { key: string; raw: string }): void {
      try {
        const store = storage();
        if (store.getItem(entry.key) === entry.raw) store.removeItem(entry.key);
      } catch { /* Keeping a redundant copy is safe. */ }
    },
    // Capture before the request, then acknowledge precisely those bytes.
    capture(key: string, username: string): () => void {
      const entries = new Map(claimed.get(scope(key, username)) ?? []);
      return () => {
        try {
          for (const [name, raw] of entries) if (storage().getItem(name) === raw) storage().removeItem(name);
        } catch { /* Keeping a redundant copy is safe. */ }
      };
    },
  };
}

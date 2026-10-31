import { normalizeUsername, sameAccount } from './session-vault';

export interface Pending<T> {
  data: T;
  at: number;
  // What the copy was made over: the version its tab loaded, and what that
  // tab had sent since (see showSentHashes and heldOverCurrentSettings).
  metadata?: { settingsHash?: string | null; showHashes?: Record<string, string>; settingsSent?: string[]; showsSent?: Record<string, string[]> };
}

/**
 * What a draft is closed with on the way into storage, and opened with on the
 * way out. A held copy is the whole show list or the whole settings blob —
 * the Rolodex, every contract and the key to every signing and profile link —
 * and it stays in this browser after sign-out, because it is unsaved work.
 * Kept as plain JSON it was there for whoever used the browser next, in an
 * app that encrypts everything else before it leaves the page. See
 * heldCopyLock for the lock the app uses.
 */
export interface DraftLock { seal(data: unknown): unknown; open(sealed: unknown): unknown }

/** One slot per tab and account. A successful save cannot clear another
 * tab's edits, or a newer draft written while a request was in flight. */
export function createPendingStore(storage: () => Storage, writer: string) {
  const claimed = new Map<string, Map<string, string>>();
  // Filed under the account, not the name as typed: the account is the same
  // whether the keyboard capitalised it, and the draft has to be found either way.
  const scope = (key: string, username: string) => `${key}:${encodeURIComponent(normalizeUsername(username))}:`;
  const slot = (key: string, username: string) => scope(key, username) + writer;
  function list<T>(key: string, username: string, lock: DraftLock): Array<Pending<T> & { key: string; raw: string }> {
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
          if (!sameAccount(value.username, username)) continue;
          // A draft an older build held in the clear is still unsaved work,
          // and comes back the same as a sealed one.
          if ('sealed' in value) result.push({ data: lock.open(value.sealed) as T, at: value.at ?? 0, key: name, raw, metadata: value.metadata });
          else if ('data' in value) result.push({ data: value.data as T, at: value.at ?? 0, key: name, raw, metadata: value.metadata });
        } catch { /* Keep damaged entries, and ones that will not open; never delete an unreadable draft. */ }
      }
      return result.sort((a, b) => a.at - b.at);
    } catch { return []; }
  }
  return {
    list,
    readAll<T>(key: string, username: string, lock: DraftLock): Pending<T>[] {
      const entries = list<T>(key, username, lock);
      claimed.set(scope(key, username), new Map(entries.map(e => [e.key, e.raw])));
      return entries;
    },
    // The newest of the drafts a caller has already listed, so a launch does
    // not open every draft on the device twice.
    read<T>(key: string, username: string, entries: Array<Pending<T> & { key: string; raw: string }>): (Pending<T> & { key: string; raw: string }) | null {
      const latest = entries.at(-1);
      if (!latest) return null;
      claimed.set(scope(key, username), new Map([[latest.key, latest.raw]]));
      return latest;
    },
    write(key: string, username: string, data: unknown, lock: DraftLock, metadata?: Pending<unknown>['metadata']): boolean {
      try {
        // Under its own name, not `data`: a build from before drafts were
        // sealed then passes over this one instead of reading the ciphertext
        // as a show list — a tab not yet reloaded onto this version, or a
        // rollback.
        const raw = JSON.stringify({ username, sealed: lock.seal(data), at: Date.now(), metadata });
        const name = slot(key, username);
        storage().setItem(name, raw);
        const group = claimed.get(scope(key, username)) ?? new Map();
        group.set(name, raw);
        claimed.set(scope(key, username), group);
        return true;
      } catch { return false; }
    },
    // Stop counting a draft as this tab's to acknowledge, without touching it.
    // For one read only to be parked: left claimed, the next ordinary save
    // acknowledged it along with its own draft, whether the park had landed
    // or not, and a park that failed then had no copy left anywhere.
    release(key: string, username: string, entry: { key: string }): void {
      claimed.get(scope(key, username))?.delete(entry.key);
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
    // Every draft the account left on this device, whichever tab wrote it.
    // Only for an account that no longer exists: there is nowhere left to
    // save them, and they are its data.
    // Matched on the account alone, never opened: a draft sealed under a key
    // this session does not hold is still that account's, and still goes.
    clear(key: string, username: string): void {
      try {
        const store = storage();
        const names: string[] = [];
        for (let i = 0; i < store.length; i++) {
          const name = store.key(i)!;
          if (name !== key && !name.startsWith(`${key}:`)) continue;
          try {
            if (sameAccount(JSON.parse(store.getItem(name)!).username, username)) names.push(name);
          } catch { /* Not a draft this store wrote; not ours to remove. */ }
        }
        for (const name of names) store.removeItem(name);
      } catch { /* Nothing more this device can do. */ }
      claimed.delete(scope(key, username));
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

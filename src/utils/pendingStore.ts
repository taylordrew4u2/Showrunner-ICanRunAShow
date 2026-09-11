export interface Pending<T> { data: T; at: number; metadata?: { settingsHash?: string | null; showHashes?: Record<string, string> } }

/** One slot per tab and account. A successful save cannot clear another
 * tab's edits, or a newer draft written while a request was in flight. */
export function createPendingStore(storage: () => Storage, writer: string) {
  const claimed = new Map<string, Map<string, string>>();
  const scope = (key: string, username: string) => `${key}:${encodeURIComponent(username)}:`;
  const slot = (key: string, username: string) => scope(key, username) + writer;
  function list<T>(key: string, username: string): Array<Pending<T> & { key: string; raw: string }> {
    try {
      const store = storage();
      const result = [];
      for (let i = 0; i < store.length; i++) {
        const name = store.key(i)!;
        if (name !== key && !name.startsWith(scope(key, username))) continue;
        const raw = store.getItem(name)!;
        try {
          const value = JSON.parse(raw);
          if (value.username === username && 'data' in value) result.push({ data: value.data, at: value.at ?? 0, key: name, raw, metadata: value.metadata });
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
    read<T>(key: string, username: string): Pending<T> | null {
      const entries = list<T>(key, username);
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

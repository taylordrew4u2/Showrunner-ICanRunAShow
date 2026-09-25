/**
 * A map that lets its longest-unused entries go once they outweigh a budget.
 *
 * Two caches on the Run Show path hold whole songs — the audio engine's
 * decoded PCM and the media store's resolved data URLs — and each used to keep
 * everything for the life of the page, which on a phone was the tab reloading
 * mid-show. They need the same rule: a hit or a fresh set moves to the back,
 * and the front, the entry that has gone longest without being asked for, is
 * the one to let go of when the budget is over. One helper rather than two
 * copies of the eviction loop, so a fix to it lands in both.
 *
 * The budget is soft: the entry just set always stays, however big it is, so
 * a press always gets its track.
 */
export function createBudgetedCache<V>(sizeOf: (value: V) => number, budget: number) {
  const entries = new Map<string, V>();
  let held = 0;
  return {
    get size() {
      return entries.size;
    },
    /** How much the kept entries weigh, in the units of `sizeOf`. */
    get held() {
      return held;
    },
    has(key: string): boolean {
      return entries.has(key);
    },
    /** Count a use: the entry moves to the fresh end, so the front stays the stalest. */
    touch(key: string): void {
      const value = entries.get(key);
      if (value === undefined) return;
      entries.delete(key);
      entries.set(key, value);
    },
    /** A hit is a use. */
    get(key: string): V | undefined {
      this.touch(key);
      return entries.get(key);
    },
    /**
     * File `value` under `key` at the fresh end. With `evict` (the default)
     * the stalest entries then go until the rest fit; without it the entry is
     * kept even over budget and nothing else is touched — for a caller that
     * has already decided there is room.
     */
    set(key: string, value: V, evict = true): void {
      const old = entries.get(key);
      if (old !== undefined) {
        held -= sizeOf(old);
        entries.delete(key);
      }
      entries.set(key, value);
      held += sizeOf(value);
      if (!evict) return;
      for (const [oldKey, oldValue] of entries) {
        if (held <= budget || oldKey === key) break;
        entries.delete(oldKey);
        held -= sizeOf(oldValue);
      }
    },
    clear(): void {
      entries.clear();
      held = 0;
    },
  };
}

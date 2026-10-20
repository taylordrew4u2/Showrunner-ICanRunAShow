import { describe, expect, it, vi } from 'vitest';
import { loadOrReload } from './chunkReload';

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => { map.set(key, value); },
    removeItem: (key: string) => { map.delete(key); },
  };
}

function env(overrides: { online?: boolean; storage?: ReturnType<typeof memoryStorage> | null } = {}) {
  return {
    storage: overrides.storage === undefined ? memoryStorage() : overrides.storage,
    reload: vi.fn(),
    online: () => overrides.online ?? true,
  };
}

// Settles within a tick if it is ever going to; a pending reload never does.
function settled(promise: Promise<unknown>): Promise<boolean> {
  return Promise.race([
    promise.then(() => true, () => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 20)),
  ]);
}

const stale = () => Promise.reject(new TypeError('Failed to fetch dynamically imported module'));

describe('opening a part of the app that is fetched on demand', () => {
  it('hands the part over when it loads', async () => {
    const deps = env();
    await expect(loadOrReload(() => Promise.resolve({ part: 1 }), deps)).resolves.toEqual({ part: 1 });
    expect(deps.reload).not.toHaveBeenCalled();
  });

  it('reloads the page when the part has gone with a deploy, instead of failing', async () => {
    // The page was opened before a deploy and still asks for the old file
    // name, which the host no longer has. The new build has the part under
    // its new name; reloading is all it takes.
    const deps = env();
    const loading = loadOrReload(stale, deps);
    expect(await settled(loading)).toBe(false);
    expect(deps.reload).toHaveBeenCalledTimes(1);
  });

  it('reloads once, and reports the failure if the part still will not load', async () => {
    const deps = env();
    expect(await settled(loadOrReload(stale, deps))).toBe(false);
    // After the reload, the same storage, a fresh page.
    const again = env({ storage: deps.storage });
    await expect(loadOrReload(stale, again)).rejects.toThrow(/dynamically imported module/);
    expect(again.reload).not.toHaveBeenCalled();
  });

  it('reloads again for a later deploy once the part has loaded in between', async () => {
    const deps = env();
    expect(await settled(loadOrReload(stale, deps))).toBe(false);
    const after = env({ storage: deps.storage });
    await loadOrReload(() => Promise.resolve({}), after);
    const later = env({ storage: deps.storage });
    expect(await settled(loadOrReload(stale, later))).toBe(false);
    expect(later.reload).toHaveBeenCalledTimes(1);
  });

  it('does not reload with no connection, which in the iOS app would leave no page at all', async () => {
    const deps = env({ online: false });
    await expect(loadOrReload(stale, deps)).rejects.toThrow();
    expect(deps.reload).not.toHaveBeenCalled();
  });

  it('does not reload when it cannot remember having done so', async () => {
    // Without somewhere to note the reload, a part that never loads would be
    // reloaded for every time it was opened, with no end to it.
    const deps = env({ storage: null });
    await expect(loadOrReload(stale, deps)).rejects.toThrow();
    expect(deps.reload).not.toHaveBeenCalled();
  });
});

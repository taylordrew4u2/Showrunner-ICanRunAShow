import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearCoproduceToken,
  clearUnsentDraft,
  isCoproducePath,
  loadCoproduceToken,
  loadUnsentDraft,
  movingToReviewOrigin,
  saveUnsentDraft,
  takeCoproduceToken,
} from './boot';
import { COPRODUCER_TOKEN_GLOBAL, type EditPayload } from './types';

const TOKEN = 'A'.repeat(43);
const OTHER = 'b'.repeat(43);

function memoryStorage(): Storage {
  const items = new Map<string, string>();
  return {
    get length() { return items.size; },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (i) => [...items.keys()][i] ?? null,
    removeItem: (key) => { items.delete(key); },
    setItem: (key, value) => { items.set(key, String(value)); },
  };
}

function at(origin: string, pathname = '/coproduce') {
  const url = new URL(pathname, origin);
  return { origin: url.origin, protocol: url.protocol, hostname: url.hostname, pathname: url.pathname, hash: '', search: '' };
}

let storage: Storage;
beforeEach(() => {
  storage = memoryStorage();
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('location', at('https://showrunner-theta.vercel.app'));
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>)[COPRODUCER_TOKEN_GLOBAL];
  clearCoproduceToken();
  vi.unstubAllGlobals();
});

describe('isCoproducePath', () => {
  it('matches the link page only', () => {
    for (const path of ['/coproduce', '/coproduce/', '/COPRODUCE', '/Coproduce/']) expect(isCoproducePath(path)).toBe(true);
    for (const path of ['/', '/coproducer', '/coproduce/x', '/api/coproduce', '/coproduce//']) expect(isCoproducePath(path)).toBe(false);
  });
});

describe('movingToReviewOrigin', () => {
  it('is true on the main origin’s link page, which the link page’s script is moving', () => {
    vi.stubGlobal('location', at('https://icanrunashow.com'));
    expect(movingToReviewOrigin(at('https://icanrunashow.com'))).toBe(true);
    expect(movingToReviewOrigin(at('https://icanrunashow.com', '/'))).toBe(false);
  });

  it('is false on the review origin, and where there is no review origin', () => {
    expect(movingToReviewOrigin(at('https://showrunner-theta.vercel.app'))).toBe(false);
    vi.stubGlobal('location', at('http://localhost:5173'));
    expect(movingToReviewOrigin(at('http://localhost:5173'))).toBe(false);
    vi.stubGlobal('location', at('https://preview-abc.vercel.app'));
    expect(movingToReviewOrigin(at('https://preview-abc.vercel.app'))).toBe(false);
  });
});

describe('takeCoproduceToken', () => {
  it('takes the token the link page left, deletes it, and keeps it on this device', async () => {
    (globalThis as Record<string, unknown>)[COPRODUCER_TOKEN_GLOBAL] = TOKEN;
    const hash = vi.fn(() => '#t=' + OTHER);
    vi.stubGlobal('location', { ...at('https://showrunner-theta.vercel.app'), get hash() { return hash(); } });
    expect(await takeCoproduceToken()).toEqual({ token: TOKEN });
    expect(COPRODUCER_TOKEN_GLOBAL in globalThis).toBe(false);
    expect(hash).not.toHaveBeenCalled();
    // Never the token in the clear when the device could seal it; here it
    // could not (no IndexedDB), so it is kept unwrapped, as the session is.
    expect(await loadCoproduceToken()).toBe(TOKEN);
  });

  it('opens the same link again, asked twice at once and from this device later', async () => {
    (globalThis as Record<string, unknown>)[COPRODUCER_TOKEN_GLOBAL] = TOKEN;
    const [first, second] = await Promise.all([takeCoproduceToken(), takeCoproduceToken()]);
    expect(first).toEqual({ token: TOKEN });
    expect(second).toEqual({ token: TOKEN });
    expect(await loadCoproduceToken()).toBe(TOKEN);
  });

  it('a new link replaces the one kept', async () => {
    (globalThis as Record<string, unknown>)[COPRODUCER_TOKEN_GLOBAL] = TOKEN;
    await takeCoproduceToken();
    (globalThis as Record<string, unknown>)[COPRODUCER_TOKEN_GLOBAL] = OTHER;
    expect(await takeCoproduceToken()).toEqual({ token: OTHER });
    expect(await loadCoproduceToken()).toBe(OTHER);
  });

  it('refuses a malformed token', async () => {
    (globalThis as Record<string, unknown>)[COPRODUCER_TOKEN_GLOBAL] = 'short';
    expect(await takeCoproduceToken()).toEqual({ missing: true });
    expect(await loadCoproduceToken()).toBeNull();
    (globalThis as Record<string, unknown>)[COPRODUCER_TOKEN_GLOBAL] = `${TOKEN}<script>`;
    expect(await takeCoproduceToken()).toEqual({ missing: true });
  });

  it('is missing when there is neither', async () => {
    expect(await takeCoproduceToken()).toEqual({ missing: true });
  });

  it('forgets the token when told', async () => {
    (globalThis as Record<string, unknown>)[COPRODUCER_TOKEN_GLOBAL] = TOKEN;
    await takeCoproduceToken();
    clearCoproduceToken();
    expect(await loadCoproduceToken()).toBeNull();
  });
});

describe('unsent drafts', () => {
  const payload: EditPayload = {
    kind: 'edit',
    shows: [{ target: 'show', op: 'update', showId: 's1', baseRevision: 'r1', keys: ['venueName'], base: { venueName: 'A' }, proposed: { venueName: 'B' } }],
    settings: null,
  };

  it('round-trips for its own link', async () => {
    await saveUnsentDraft({ linkId: 'link-1', savedAt: '2026-11-17T10:00:00.000Z', payload, mediaIds: [] });
    expect(await loadUnsentDraft('link-1')).toEqual({ linkId: 'link-1', savedAt: '2026-11-17T10:00:00.000Z', payload, mediaIds: [] });
  });

  it('is null for another link, once cleared, and when it no longer reads as a change', async () => {
    await saveUnsentDraft({ linkId: 'link-1', savedAt: 'x', payload, mediaIds: [] });
    expect(await loadUnsentDraft('link-2')).toBeNull();
    clearUnsentDraft();
    expect(await loadUnsentDraft('link-1')).toBeNull();
    const bad = { ...payload, shows: [{ ...payload.shows[0], keys: ['viewToken'] }] } as unknown as EditPayload;
    await saveUnsentDraft({ linkId: 'link-1', savedAt: 'x', payload: bad, mediaIds: [] });
    expect(await loadUnsentDraft('link-1')).toBeNull();
    storage.setItem('showrunner:coproducer:unsent:v1', JSON.stringify({ wrapped: false, data: '{"__proto__":{}}' }));
    expect(await loadUnsentDraft('link-1')).toBeNull();
  });
});

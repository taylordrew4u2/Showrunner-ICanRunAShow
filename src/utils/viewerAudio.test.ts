import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ensureViewerKey,
  generateViewerKey,
  loadViewerKey,
  nextPlaybackAction,
  readViewerKeyFromHash,
  splitIntoChunks,
  viewerUrl,
  type ViewerPlayback,
} from './viewerAudio';

function cue(key: string | null): ViewerPlayback {
  return { key, atMs: 1_000, fadeInMs: 0, fadeOutMs: 350 };
}
const downloaded = (...keys: string[]) => (k: string) => keys.includes(k);

function stubStorage() {
  const map = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  });
  return map;
}

describe('viewer audio keys', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('generates a key that survives a URL unencoded', () => {
    const key = generateViewerKey();
    // base64url only — a '+' or '/' would be mangled in a fragment and the
    // viewer would silently fail to decrypt every track.
    expect(key).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(encodeURIComponent(key)).toBe(key);
  });

  it('generates enough key material to be unguessable', () => {
    // 32 bytes → 43 base64 chars once padding is stripped.
    expect(generateViewerKey().length).toBeGreaterThanOrEqual(43);
  });

  it('does not repeat keys', () => {
    const keys = new Set(Array.from({ length: 50 }, generateViewerKey));
    expect(keys.size).toBe(50);
  });

  it('keeps one key per show, so old links keep working', () => {
    stubStorage();
    const first = ensureViewerKey('tok-a');
    expect(ensureViewerKey('tok-a')).toBe(first);
    expect(ensureViewerKey('tok-b')).not.toBe(first);
  });

  it('reports no key for a show that has never published', () => {
    stubStorage();
    expect(loadViewerKey('tok-new')).toBeNull();
  });

  it('still returns a usable key when storage is unavailable', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('denied'); },
      setItem: () => { throw new Error('denied'); },
    });
    expect(ensureViewerKey('tok')).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('round-trips the key through the viewer link fragment', () => {
    const key = generateViewerKey();
    const url = viewerUrl('https://example.com', 'tok-123', key);
    expect(readViewerKeyFromHash(new URL(url).hash)).toBe(key);
  });

  it('keeps the key in the fragment, never the query', () => {
    const key = generateViewerKey();
    const url = new URL(viewerUrl('https://example.com', 'tok-123', key));
    // The fragment is the whole point: browsers don't send it to the server,
    // so the backend holding the ciphertext never sees the key.
    expect(url.search).toContain('view=tok-123');
    expect(url.search).not.toContain(key);
    expect(url.hash).toContain(key);
  });

  it('builds a plain link when the show has no published audio', () => {
    const url = viewerUrl('https://example.com', 'tok-123', null);
    expect(url).toBe('https://example.com/?view=tok-123');
    expect(readViewerKeyFromHash(new URL(url).hash)).toBeNull();
  });

  it('reads no key from an unrelated fragment', () => {
    expect(readViewerKeyFromHash('')).toBeNull();
    expect(readViewerKeyFromHash('#section')).toBeNull();
  });

  it('splits and rejoins a payload exactly', () => {
    const text = 'x'.repeat(2500);
    const chunks = splitIntoChunks(text, 1000);
    expect(chunks).toHaveLength(3);
    expect(chunks.join('')).toBe(text);
  });
});

describe('what the viewer plays next', () => {
  it('starts a track the board asked for', () => {
    expect(nextPlaybackAction(null, cue('a'), downloaded('a'))).toEqual({ action: 'play', key: 'a' });
  });

  it('waits — and stays unhandled — for a cue that beat its download', () => {
    // The bug this exists to prevent: press a face before the track has
    // reached the viewer, and treating the cue as handled loses the walk-on
    // entirely. 'wait' means the caller leaves its state alone.
    expect(nextPlaybackAction(null, cue('a'), downloaded())).toEqual({ action: 'wait', key: 'a' });
  });

  it('plays that same cue once the download lands', () => {
    // Same instruction, one poll later, now downloaded.
    expect(nextPlaybackAction(null, cue('a'), downloaded('a'))).toEqual({ action: 'play', key: 'a' });
  });

  it('does nothing when it is already playing what was asked for', () => {
    // Every poll repeats the instruction; re-firing would restart the track
    // from the top under a performer already walking on.
    expect(nextPlaybackAction('a', cue('a'), downloaded('a'))).toEqual({ action: 'none' });
  });

  it('hands over to a different track', () => {
    expect(nextPlaybackAction('a', cue('b'), downloaded('a', 'b'))).toEqual({ action: 'play', key: 'b' });
  });

  it('keeps the current track running while the next one downloads', () => {
    // Cutting to silence early would be worse than a late handover.
    expect(nextPlaybackAction('a', cue('b'), downloaded('a'))).toEqual({ action: 'wait', key: 'b' });
  });

  it('stops when the board stops', () => {
    expect(nextPlaybackAction('a', cue(null), downloaded('a'))).toEqual({ action: 'stop' });
  });

  it('does not re-stop silence on every poll', () => {
    expect(nextPlaybackAction(null, cue(null), downloaded())).toEqual({ action: 'none' });
  });

  it('does nothing when the board has published no instruction', () => {
    // A show whose board never turned viewer audio on.
    expect(nextPlaybackAction(null, undefined, downloaded())).toEqual({ action: 'none' });
  });
});

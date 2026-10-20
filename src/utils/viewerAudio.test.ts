import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_VIEWER_TRACKS,
  ensureViewerKey,
  generateViewerKey,
  loadViewerKey,
  nextPlaybackAction,
  planViewerUploads,
  readViewerKeyFromHash,
  splitIntoChunks,
  trimSlice,
  viewerUrl,
  type ViewerPlayback,
} from './viewerAudio';

describe('the slice of a trimmed walk-on the room hears', () => {
  it('is the same slice the operator set, on the board and through the viewer', () => {
    // Trimmed to the drop at 0:42–1:10: the PA plays 28 seconds from 0:42,
    // not the whole song from the top.
    expect(trimSlice({ startSec: 42, endSec: 70 })).toEqual({ offsetSec: 42, durationSec: 28 });
    expect(trimSlice({ startSec: 42 })).toEqual({ offsetSec: 42, durationSec: undefined });
    expect(trimSlice({ endSec: 30 })).toEqual({ offsetSec: undefined, durationSec: 30 });
  });

  it('plays the whole file when there is no trim, or a half-finished one', () => {
    expect(trimSlice({})).toEqual({ offsetSec: undefined, durationSec: undefined });
    // An out-point before the in-point would schedule a stop in the past.
    expect(trimSlice({ startSec: 42, endSec: 10 })).toEqual({ offsetSec: 42, durationSec: undefined });
    expect(trimSlice({ startSec: 0, endSec: 0 })).toEqual({ offsetSec: undefined, durationSec: undefined });
  });
});

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

  it('publishes under the key saved with the show, whichever device does it', () => {
    // The laptop made the key at sound check and the link went out with it.
    // On the night the phone publishes: it has no key of its own, or an old
    // one, and a fresh key would have left every link already handed out
    // unable to decode a single track.
    const storage = stubStorage();
    storage.set('showrunner:viewerkey:tok-a', 'phone-own-key');
    expect(ensureViewerKey('tok-a', 'key-saved-with-show')).toBe('key-saved-with-show');
    stubStorage();
    expect(ensureViewerKey('tok-a', 'key-saved-with-show')).toBe('key-saved-with-show');
  });

  it('keeps using a key this device made before keys travelled with the show', () => {
    const storage = stubStorage();
    storage.set('showrunner:viewerkey:tok-a', 'older-key');
    expect(ensureViewerKey('tok-a', undefined)).toBe('older-key');
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
    expect(url.pathname).toBe('/live');
    expect(url.search).toContain('t=tok-123');
    expect(url.search).not.toContain(key);
    expect(url.hash).toContain(key);
  });

  it('builds a plain link when the show has no published audio', () => {
    const url = viewerUrl('https://example.com', 'tok-123', null);
    expect(url).toBe('https://example.com/live?t=tok-123');
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

  it('stops a running track when the board stops sending instructions', () => {
    // The board closed, finished the show, or stopped sharing its audio, and
    // its next publish says nothing about playback. Carrying on would leave
    // the PA playing a song nobody on the board can stop any more.
    expect(nextPlaybackAction('a', undefined, downloaded('a'))).toEqual({ action: 'stop' });
  });
});

describe('what the board sends to the viewer', () => {
  const pad = (key: string, src: string) => ({ key, src });

  it('sends a song once, however many pads play it', () => {
    // Two performers with no walk-on of their own both fall back to the same
    // library song, which is also on the DJ bank.
    const { uploads, skipped } = planViewerUploads([
      pad('performer:ann', 'media:song-1'),
      pad('performer:bo', 'media:song-1'),
      pad('dj:library:song-1', 'media:song-1'),
      pad('cue:outro', 'media:outro'),
    ]);
    expect(uploads.map((u) => u.src)).toEqual(['media:song-1', 'media:outro']);
    expect(uploads[0].pads.map((p) => p.key)).toEqual(['performer:ann', 'performer:bo', 'dj:library:song-1']);
    expect(uploads[0].mediaId).toBe('t-performer-ann');
    expect(skipped).toEqual([]);
  });

  it('keeps to what one viewer link holds, walk-ons and show tracks first', () => {
    // Twelve acts and a 50-song library: 62 different files.
    const performers = Array.from({ length: 12 }, (_, i) => pad(`performer:p${i}`, `media:walk-${i}`));
    const dj = Array.from({ length: 50 }, (_, i) => pad(`dj:library:s${i}`, `media:song-${i}`));
    const { uploads, skipped } = planViewerUploads([...performers, ...dj]);
    expect(uploads).toHaveLength(MAX_VIEWER_TRACKS);
    expect(uploads.slice(0, 12).map((u) => u.src)).toEqual(performers.map((p) => p.src));
    expect(skipped.map((p) => p.key)).toEqual(['dj:library:s48', 'dj:library:s49']);
  });

  it('gives a pad whose song is already going the same upload, even past the limit', () => {
    const many = Array.from({ length: MAX_VIEWER_TRACKS }, (_, i) => pad(`dj:s${i}`, `media:song-${i}`));
    const { uploads, skipped } = planViewerUploads([...many, pad('performer:late', 'media:song-0')]);
    expect(uploads).toHaveLength(MAX_VIEWER_TRACKS);
    expect(uploads[0].pads.map((p) => p.key)).toEqual(['dj:s0', 'performer:late']);
    expect(skipped).toEqual([]);
  });
});

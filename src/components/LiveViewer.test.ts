import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveViewPayload } from '../utils/liveView';
import type { ViewerTrack } from '../utils/viewerAudio';
import { createTrackLoader, remainingSeconds, stampPayload } from './LiveViewer';

function running(lastUpdateMs: number, remainingAtLastUpdate = 300): LiveViewPayload {
  return { showName: 'Test show', status: 'running', remainingAtLastUpdate, lastUpdateMs };
}

describe('the room clock between polls', () => {
  it('counts down from when the cue reached this screen, not from the board clock', () => {
    // The PA laptop is 45 seconds fast. The board's wall clock says the cue
    // was written at 100_000; this screen's clock says it arrived at 145_000.
    const shown = stampPayload(null, running(100_000, 300), 145_000);
    expect(remainingSeconds(shown, 145_000)).toBe(300);
    expect(remainingSeconds(shown, 155_000)).toBe(290);
  });

  it('keeps counting while the same cue is polled again and again', () => {
    const first = stampPayload(null, running(100_000, 300), 145_000);
    // 1.5 s later the poll brings back the same publish, byte for byte.
    const again = stampPayload(first, running(100_000, 300), 146_500);
    expect(remainingSeconds(again, 146_500)).toBe(298.5);
  });

  it('restarts the count when the board publishes something new', () => {
    const first = stampPayload(null, running(100_000, 300), 145_000);
    const next = stampPayload(first, running(160_000, 240), 205_000);
    expect(remainingSeconds(next, 205_000)).toBe(240);
  });

  it('holds the number still while the board is paused', () => {
    const paused: LiveViewPayload = { showName: 'Test show', status: 'paused', remainingAtLastUpdate: 120, lastUpdateMs: 1 };
    expect(remainingSeconds(stampPayload(null, paused, 10_000), 99_000)).toBe(120);
  });
});

const track = (key: string, total = 1): ViewerTrack => ({ key, mediaId: `t-${key}`, total });

describe('downloading the walk-ons onto the viewer screen', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('tries a failed download again, spaced out, until it lands', async () => {
    let attempts = 0;
    const loader = createTrackLoader(
      async () => (++attempts < 3 ? null : 'data:audio/mp3;base64,AAA'),
      () => {},
      [1_000, 5_000],
    );
    loader.sync([track('a')]);
    await vi.advanceTimersByTimeAsync(0);
    expect(attempts).toBe(1);
    expect(loader.has('a')).toBe(false);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(attempts).toBe(2);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(attempts).toBe(3);
    expect(loader.has('a')).toBe(true);
    expect(loader.urlOf('a')).toBe('data:audio/mp3;base64,AAA');
  });

  it('stops trying on its own after the last delay, then tries once more when the board cues it', async () => {
    let attempts = 0;
    const loader = createTrackLoader(async () => { attempts++; return null; }, () => {}, [1_000]);
    loader.sync([track('a')]);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(attempts).toBe(2);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(attempts).toBe(2);
    // The operator presses the pad: that is worth one more go right now.
    loader.want('a');
    await vi.advanceTimersByTimeAsync(0);
    expect(attempts).toBe(3);
    // ...and a press every poll while it is backing off does not hammer the server.
    loader.want('a');
    loader.want('a');
    await vi.advanceTimersByTimeAsync(0);
    expect(attempts).toBe(3);
  });

  it('tries every missing track again the moment the connection is back', async () => {
    let attempts = 0;
    const loader = createTrackLoader(async () => { attempts++; return null; }, () => {}, [1_000]);
    loader.sync([track('a'), track('b')]);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1_000);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(attempts).toBe(4);
    loader.retryAll();
    await vi.advanceTimersByTimeAsync(0);
    expect(attempts).toBe(6);
  });

  it('downloads a track again when the board re-publishes it with a different file', async () => {
    const seen: string[] = [];
    const loader = createTrackLoader(async (t) => { seen.push(`${t.mediaId}:${t.total}`); return 'data:audio/mp3;base64,AAA'; }, () => {});
    loader.sync([track('a', 2)]);
    await vi.advanceTimersByTimeAsync(0);
    expect(loader.has('a')).toBe(true);
    // The same manifest again is not a reason to download anything.
    loader.sync([track('a', 2)]);
    await vi.advanceTimersByTimeAsync(0);
    expect(seen).toEqual(['t-a:2']);
    // A longer file under the same key is a new walk-on.
    loader.sync([track('a', 3)]);
    expect(loader.has('a')).toBe(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(seen).toEqual(['t-a:2', 't-a:3']);
    expect(loader.has('a')).toBe(true);
  });

  it('tells the screen when a track is ready, and never after the screen has moved on', async () => {
    const ready = vi.fn();
    let finish: (url: string | null) => void = () => {};
    const loader = createTrackLoader(() => new Promise((r) => { finish = r; }), ready);
    loader.sync([track('a')]);
    await vi.advanceTimersByTimeAsync(0);
    loader.dispose();
    finish('data:audio/mp3;base64,AAA');
    await vi.advanceTimersByTimeAsync(0);
    expect(ready).not.toHaveBeenCalled();
    expect(loader.has('a')).toBe(false);
  });
});

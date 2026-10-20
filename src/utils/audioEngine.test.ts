import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { audioEngine, BUFFER_BUDGET_BYTES } from './audioEngine';

/**
 * Just enough Web Audio for the engine to run in node. Decoded size is the
 * only thing these tests care about, so a source's "file" carries the frame
 * count it should decode to, and the fake decoder answers with a buffer of
 * that many frames.
 */
const SAMPLE_RATE = 44100;
const CHANNELS = 2;
const BYTES_PER_FRAME = CHANNELS * Float32Array.BYTES_PER_ELEMENT;

function fakeNode() {
  // The gain automation a track was given, in the order it was scheduled.
  const events: [string, number, number][] = [];
  return {
    gain: {
      value: 1,
      events,
      setValueAtTime(v: number, t: number) { events.push(['set', v, t]); },
      linearRampToValueAtTime(v: number, t: number) { events.push(['ramp', v, t]); },
      cancelScheduledValues() {},
    },
    buffer: null,
    onended: null,
    connect(next: unknown) { return next; },
    start() {},
    stop() {},
  };
}

class FakeAudioContext {
  state = 'running';
  currentTime = 0;
  destination = {};
  resume() { return Promise.resolve(); }
  close() { return Promise.resolve(); }
  createGain() { return fakeNode(); }
  createBufferSource() { return fakeNode(); }
  async decodeAudioData(arr: ArrayBuffer) {
    const frames = new Float64Array(arr)[0];
    return {
      length: frames,
      numberOfChannels: CHANNELS,
      sampleRate: SAMPLE_RATE,
      duration: frames / SAMPLE_RATE,
    };
  }
}

/** A track whose decoded PCM is exactly a quarter of the budget — four fill it. */
const QUARTER = BUFFER_BUDGET_BYTES / 4 / BYTES_PER_FRAME;
const track = (n: number, frames = QUARTER) => `https://example.test/track-${n}?frames=${frames}`;

beforeEach(() => {
  (globalThis as unknown as { window: unknown }).window = { AudioContext: FakeAudioContext };
  globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
    const frames = Number(new URL(String(url)).searchParams.get('frames'));
    return { ok: true, arrayBuffer: async () => new Float64Array([frames]).buffer } as unknown as Response;
  }) as typeof fetch;
  audioEngine.init();
});

afterEach(() => {
  audioEngine.dispose();
  vi.restoreAllMocks();
});

describe('keeping decoded tracks within what a phone tab can hold', () => {
  it('stops decoding ahead once the ready tracks fill the budget, and loads the rest on the press', async () => {
    for (let n = 1; n <= 6; n++) await audioEngine.preload(track(n));
    // The first four filled the budget; the rest wait for their press rather
    // than growing the tab until the browser reloads it mid-show.
    expect([1, 2, 3, 4, 5, 6].map((n) => audioEngine.isReady(track(n)))).toEqual([true, true, true, true, false, false]);

    expect(await audioEngine.play(track(5))).toBe('started');
    expect(audioEngine.isReady(track(5))).toBe(true);
    // Room was made by letting go of the track that has gone longest unused —
    // the first pad, which by now has almost certainly had its walk-on.
    expect([1, 2, 3, 4].map((n) => audioEngine.isReady(track(n)))).toEqual([false, true, true, true]);
  });

  it('lets go of the track pressed longest ago, not the one pressed most recently', async () => {
    for (let n = 1; n <= 4; n++) await audioEngine.preload(track(n));
    expect(await audioEngine.play(track(1))).toBe('started');
    expect(await audioEngine.play(track(5))).toBe('started');
    // Track 1 was just played, so track 2 is the one the board can spare.
    expect([1, 2, 3, 4, 5].map((n) => audioEngine.isReady(track(n)))).toEqual([true, false, true, true, true]);
  });

  it('never pushes out the track it just decoded for a press, however big it is', async () => {
    for (let n = 1; n <= 4; n++) await audioEngine.preload(track(n));
    const huge = track(9, QUARTER * 6);
    expect(await audioEngine.play(huge)).toBe('started');
    expect(audioEngine.isReady(huge)).toBe(true);
    expect([1, 2, 3, 4].map((n) => audioEngine.isReady(track(n)))).toEqual([false, false, false, false]);
  });

  it('starts a fresh budget after the engine is disposed', async () => {
    for (let n = 1; n <= 4; n++) await audioEngine.preload(track(n));
    audioEngine.dispose();
    audioEngine.init();
    for (let n = 5; n <= 8; n++) await audioEngine.preload(track(n));
    // Nothing from before dispose() counts against the new board.
    expect([5, 6, 7, 8].map((n) => audioEngine.isReady(track(n)))).toEqual([true, true, true, true]);
    expect([1, 2, 3, 4].map((n) => audioEngine.isReady(track(n)))).toEqual([false, false, false, false]);
  });

  it('lets a fade-out that End Show just started finish before the board closes its audio', async () => {
    // End Show fades the walk-on and closes Run Show in the same breath. The
    // dialog promised a fade, so the context that is playing it has to
    // outlive the board by the length of the fade.
    vi.useFakeTimers();
    const close = vi.spyOn(FakeAudioContext.prototype, 'close');
    try {
      expect(await audioEngine.play(track(1))).toBe('started');
      audioEngine.stop({ fadeMs: 1500 });
      audioEngine.dispose();
      expect(close).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1400);
      expect(close).not.toHaveBeenCalled();
      vi.advanceTimersByTime(200);
      expect(close).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not keep a track whose decode lands after the board has closed', async () => {
    // Run Show closes while the preload is still working: the decode that
    // finishes a moment later has no board to be ready for.
    const late = audioEngine.preload(track(1));
    audioEngine.dispose();
    await late;
    audioEngine.init();
    expect(audioEngine.isReady(track(1))).toBe(false);
  });
});

/** The gain node of each track (or master) made from here on, in order. */
function recordGains() {
  const made: ReturnType<typeof fakeNode>[] = [];
  vi.spyOn(FakeAudioContext.prototype, 'createGain').mockImplementation(() => {
    const node = fakeNode();
    made.push(node);
    return node;
  });
  return made;
}

describe('the shape of a trimmed track', () => {
  it('eases out over the fade-out at its out-point, not over the fade-in', async () => {
    // The default fade starts on the press and eases out. Using the fade-in
    // for the tail made that a zero-length ramp: every trimmed walk-on was
    // cut dead, with a click, at its out-point.
    const gains = recordGains();
    expect(await audioEngine.play(track(1), { fadeInMs: 0, fadeOutMs: 350, offsetSec: 47, durationSec: 30 })).toBe('started');
    expect(gains[0].gain.events).toEqual([['set', 1, 0], ['set', 1, 29.65], ['ramp', 0, 30]]);
  });

  it('gives a long fade-in and a short fade-out each their own length', async () => {
    const gains = recordGains();
    await audioEngine.play(track(1), { fadeInMs: 1400, fadeOutMs: 600, durationSec: 30 });
    expect(gains[0].gain.events).toEqual([['set', 0, 0], ['ramp', 1, 1.4], ['set', 1, 29.4], ['ramp', 0, 30]]);
  });

  it('cuts on the frame when the fade-out is zero', async () => {
    const gains = recordGains();
    await audioEngine.play(track(1), { fadeInMs: 0, fadeOutMs: 0, durationSec: 30 });
    expect(gains[0].gain.events).toEqual([['set', 1, 0], ['set', 1, 30], ['ramp', 0, 30]]);
  });

  it('never starts the fade-out after the out-point on a slice shorter than its fades', async () => {
    const gains = recordGains();
    await audioEngine.play(track(1), { fadeInMs: 2000, fadeOutMs: 600, durationSec: 1 });
    const [, , [, , fadeStart], [, , end]] = gains[0].gain.events;
    expect(end).toBe(1);
    expect(fadeStart).toBeLessThanOrEqual(end);
  });
});

describe('telling a track it no longer has the engine', () => {
  it('tells it when another press takes over, and when it is stopped', async () => {
    const first = vi.fn();
    const second = vi.fn();
    await audioEngine.play(track(1), { onReleased: first });
    expect(first).not.toHaveBeenCalled();
    await audioEngine.play(track(2), { onReleased: second });
    expect(first).toHaveBeenCalledTimes(1);
    audioEngine.stop();
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledTimes(1);
  });

  it('tells it when a press of the same track takes over', async () => {
    // An audition and a pad can be the same song, and the audition must still
    // learn the pad has the engine now, not mistake the pad for itself.
    const audition = vi.fn();
    await audioEngine.play(track(1), { onReleased: audition });
    await audioEngine.play(track(1));
    expect(audition).toHaveBeenCalledTimes(1);
  });
});

describe('what the next board inherits', () => {
  it('does not carry a mute from a closed board into the next thing that plays', async () => {
    // Mute is Run Show's control. Left set after the board closed, every
    // preview elsewhere played at zero volume and reported that it had started.
    audioEngine.setMuted(true);
    audioEngine.dispose();
    const gains = recordGains();
    expect(await audioEngine.play(track(1))).toBe('started');
    // The first gain made is the new context's master.
    expect(gains[0].gain.value).toBe(1);
  });
});

describe('playing through the silent switch', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("asks for the playback audio session, which iOS's ring/silent switch does not mute", () => {
    // WebKit's default category for Web Audio is the ambient one, and the
    // switch silences it: a lit pad and no sound in the room.
    const session = { type: 'auto' };
    vi.stubGlobal('navigator', { audioSession: session });
    audioEngine.dispose();
    audioEngine.init();
    expect(session.type).toBe('playback');
  });

  it('still starts in a browser with no audio session to set', async () => {
    vi.stubGlobal('navigator', {});
    audioEngine.dispose();
    expect(await audioEngine.play(track(1))).toBe('started');
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { auditionTrim, type AuditionEngine } from './TrimControls';
import type { PlayResult } from '../utils/audioEngine';

/**
 * An engine whose play() answers when the test says so — standing in for the
 * seconds a phone spends fetching, decrypting and decoding a big file.
 */
function slowEngine() {
  let answer: ((result: PlayResult) => void) | null = null;
  let onEnded: (() => void) | undefined;
  const engine: AuditionEngine = {
    play: vi.fn((_src, opts) => {
      onEnded = opts.onEnded;
      return new Promise<PlayResult>((resolve) => { answer = resolve; });
    }),
    stop: vi.fn(),
  };
  return {
    engine,
    /** The track is decoded and running (or failed) as of now. */
    async loaded(result: PlayResult = 'started') {
      answer?.(result);
      await Promise.resolve();
      await Promise.resolve();
    },
    /** The track ran to its own end. */
    ended() { onEnded?.(); },
  };
}

describe('hearing a trim', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('does not start the cap until the track is actually playing', async () => {
    const { engine, loaded } = slowEngine();
    const onDone = vi.fn();
    auditionTrim(engine, 'media:song', { startSec: 70, lengthSec: 4 }, onDone);

    // A 4s trim on a file that takes 5s to load: the cap must not fire in the
    // middle of the load, or the pending play is cancelled and nothing is heard.
    await vi.advanceTimersByTimeAsync(5000);
    expect(engine.stop).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();

    await loaded('started');
    await vi.advanceTimersByTimeAsync(4200);
    expect(engine.stop).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    expect(engine.stop).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('plays from the in-point for the trimmed length', () => {
    const { engine } = slowEngine();
    auditionTrim(engine, 'media:song', { startSec: 70, lengthSec: 4 }, () => {});
    expect(engine.play).toHaveBeenCalledWith(
      'media:song',
      expect.objectContaining({ offsetSec: 70, durationSec: 4, fadeInMs: 0 }),
    );
  });

  it('caps an untrimmed audition at fifteen seconds of sound', async () => {
    const { engine, loaded } = slowEngine();
    const onDone = vi.fn();
    auditionTrim(engine, 'media:song', { lengthSec: null }, onDone);
    await loaded('started');
    await vi.advanceTimersByTimeAsync(15200);
    expect(engine.stop).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    expect(engine.stop).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('gives the button back when the track could not be played', async () => {
    const { engine, loaded } = slowEngine();
    const onDone = vi.fn();
    auditionTrim(engine, 'media:song', { lengthSec: 4 }, onDone);
    await loaded('media-unavailable');
    expect(onDone).toHaveBeenCalledTimes(1);
    // Nothing is running, so there is nothing for a cap to stop later.
    await vi.advanceTimersByTimeAsync(60000);
    expect(engine.stop).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('gives the button back when the soundboard takes the engine', async () => {
    const { engine, loaded } = slowEngine();
    const onDone = vi.fn();
    auditionTrim(engine, 'media:song', { lengthSec: 4 }, onDone);
    await loaded('superseded');
    expect(onDone).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60000);
    expect(engine.stop).not.toHaveBeenCalled();
  });

  it('honours Stop pressed while the track is still loading', async () => {
    const { engine, loaded } = slowEngine();
    const onDone = vi.fn();
    const stop = auditionTrim(engine, 'media:song', { lengthSec: 4 }, onDone);
    stop();
    expect(engine.stop).toHaveBeenCalledTimes(1);
    // The producer already has the button back; a late answer changes nothing.
    await loaded('started');
    await vi.advanceTimersByTimeAsync(60000);
    expect(engine.stop).toHaveBeenCalledTimes(1);
    expect(onDone).not.toHaveBeenCalled();
  });

  it('gives the button back when the trim runs to its end on its own', async () => {
    const { engine, loaded, ended } = slowEngine();
    const onDone = vi.fn();
    auditionTrim(engine, 'media:song', { startSec: 70, lengthSec: 4 }, onDone);
    await loaded('started');
    ended();
    expect(onDone).toHaveBeenCalledTimes(1);
    // The engine finished the fade itself; the cap has nothing left to do.
    await vi.advanceTimersByTimeAsync(60000);
    expect(engine.stop).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});

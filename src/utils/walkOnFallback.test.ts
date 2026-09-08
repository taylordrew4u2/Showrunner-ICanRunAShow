import { describe, expect, it } from 'vitest';
import type { MusicTrack, Performer } from '../types';
import { assignFallbackWalkOns, fallbackLabel, withFallbackWalkOns } from './walkOnFallback';

const performer = (id: string, extra: Partial<Performer> = {}): Performer => ({
  id,
  name: `Comic ${id}`,
  ...extra,
});

const track = (id: string, extra: Partial<MusicTrack> = {}): MusicTrack => ({
  id,
  title: `Track ${id}`,
  artist: `Artist ${id}`,
  music: `media:${id}#1`,
  addedAt: '2026-01-01T00:00:00.000Z',
  ...extra,
});

const library = [track('a'), track('b'), track('c'), track('d')];

describe('filling in a walk-on for whoever has none', () => {
  it('gives music to the comic who never sent any', () => {
    const assigned = assignFallbackWalkOns([performer('p1')], library);

    expect(assigned).toHaveLength(1);
    expect(assigned[0].performerId).toBe('p1');
    expect(library).toContainEqual(assigned[0].track);
  });

  it('leaves a comic who has their own song completely alone', () => {
    // The one thing this must never do: replace music somebody chose.
    const withOwn = performer('p1', {
      walkOnMusic: 'media:theirs#1',
      walkOnMusicName: 'Their Song',
    });

    expect(assignFallbackWalkOns([withOwn], library)).toEqual([]);

    const [result] = withFallbackWalkOns([withOwn], library);
    expect(result.walkOnMusic).toBe('media:theirs#1');
    expect(result.walkOnMusicName).toBe('Their Song');
  });

  it('picks the same song for the same bill every time it is asked', () => {
    // The run sheet, the preview and the PA have to agree. A pick that gets
    // re-rolled on a reload is worse than no pick at all.
    const bill = [performer('p1'), performer('p2'), performer('p3')];

    const first = assignFallbackWalkOns(bill, library);
    const second = assignFallbackWalkOns(bill, library);

    expect(second).toEqual(first);
  });

  it('does not walk two comics on to the same song', () => {
    const bill = [performer('p1'), performer('p2'), performer('p3')];

    const songs = assignFallbackWalkOns(bill, library).map((a) => a.track.id);

    expect(new Set(songs).size).toBe(3);
  });

  it('still covers everyone when there is less music than there are comics', () => {
    const bill = ['p1', 'p2', 'p3', 'p4', 'p5'].map((id) => performer(id));

    const assigned = assignFallbackWalkOns(bill, [track('a'), track('b')]);

    expect(assigned).toHaveLength(5);
    // Repeats are unavoidable at this point, but neighbours still differ.
    expect(assigned[0].track.id).not.toBe(assigned[1].track.id);
  });

  it('does nothing at all when the library is empty', () => {
    expect(assignFallbackWalkOns([performer('p1')], [])).toEqual([]);
    const bill = [performer('p1')];
    expect(withFallbackWalkOns(bill, [])).toBe(bill);
  });

  it('ignores a library entry with no audio behind it', () => {
    const assigned = assignFallbackWalkOns([performer('p1')], [track('empty', { music: '' })]);
    expect(assigned).toEqual([]);
  });
});

describe('handing the filled-in lineup to the soundboard', () => {
  it('carries the track’s own trim points, so it plays the bit the room knows', () => {
    const trimmed = track('a', { startSec: 42, endSec: 58 });

    const [result] = withFallbackWalkOns([performer('p1')], [trimmed]);

    expect(result.walkOnMusic).toBe(trimmed.music);
    expect(result.walkOnMusicName).toBe('Track a');
    expect(result.walkOnMusicArtist).toBe('Artist a');
    expect(result.walkOnStartSec).toBe(42);
    expect(result.walkOnEndSec).toBe(58);
  });

  it('does not write the guess back onto the booking', () => {
    // A fallback is for tonight. Saving it would leave the producer arguing
    // with a stored guess the next time they book this person.
    const bill = [performer('p1')];

    withFallbackWalkOns(bill, library);

    expect(bill[0].walkOnMusic).toBeUndefined();
  });

  it('names the track the way the producer would say it out loud', () => {
    expect(fallbackLabel(track('a'))).toBe('Track a — Artist a');
    expect(fallbackLabel(track('a', { artist: '' }))).toBe('Track a');
  });
});

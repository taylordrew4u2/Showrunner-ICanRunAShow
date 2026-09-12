import { describe, expect, it } from 'vitest';
import { randomMusic } from './randomMusic';
const tracks = ['a', 'b', 'c'].map((src) => ({ src, key: src, label: src, initial: src }));
describe('random music fallback', () => {
  it('covers all songs across random draws', () => {
    expect([0, .4, .99].map((draw) => randomMusic(tracks, draw, () => true)?.src)).toEqual(['a','b','c']);
  });
  it('chooses decoded audio instead of waiting for an unready track', () => {
    expect(randomMusic(tracks, 0, (src) => src === 'c')?.src).toBe('c');
  });
  it('does not weight a song more heavily because it has multiple pads', () => {
    expect(randomMusic([...tracks, { ...tracks[0], key: 'performer:a' }], .4, () => true)?.src).toBe('b');
  });
  it('still selects a song during initial loading and handles an empty library', () => {
    expect(randomMusic(tracks, .4, () => false)?.src).toBe('b');
    expect(randomMusic([], .4, () => false)).toBeUndefined();
  });
});

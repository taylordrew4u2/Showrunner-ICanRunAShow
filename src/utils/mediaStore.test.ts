import { describe, it, expect } from 'vitest';
import { createUrlCache, splitIntoChunks, parseMediaRef, isMediaRef } from './mediaStore';

describe('the resolved tracks a page keeps in memory', () => {
  it('lets the longest-unused track go once the budget is full, and keeps what is in use', () => {
    const cache = createUrlCache(10);
    cache.set('media:a#1', 'aaaa');
    cache.set('media:b#1', 'bbbb');
    // The first track is played again, so it is the second that can be spared.
    expect(cache.get('media:a#1')).toBe('aaaa');
    cache.set('media:c#1', 'cccc');
    expect(cache.get('media:b#1')).toBeUndefined();
    expect(cache.get('media:a#1')).toBe('aaaa');
    expect(cache.get('media:c#1')).toBe('cccc');
  });

  it('still keeps a single track bigger than the whole budget', () => {
    const cache = createUrlCache(3);
    cache.set('media:big#4', 'x'.repeat(20));
    expect(cache.get('media:big#4')).toHaveLength(20);
    expect(cache.size).toBe(1);
  });

  it('replaces a track resolved twice without counting it twice', () => {
    const cache = createUrlCache(10);
    cache.set('media:a#1', 'aaaaaa');
    cache.set('media:a#1', 'aaaa');
    cache.set('media:b#1', 'bbbbbb');
    expect(cache.get('media:a#1')).toBe('aaaa');
    expect(cache.get('media:b#1')).toBe('bbbbbb');
  });
});

describe('splitIntoChunks', () => {
  it('splits into fixed-size slices that rejoin losslessly', () => {
    const text = 'x'.repeat(3_700_000);
    const chunks = splitIntoChunks(text, 1_500_000);
    expect(chunks.length).toBe(3);
    expect(chunks[0].length).toBe(1_500_000);
    expect(chunks[2].length).toBe(700_000);
    expect(chunks.join('')).toBe(text);
  });

  it('keeps small inputs in one chunk', () => {
    expect(splitIntoChunks('abc', 1000)).toEqual(['abc']);
  });
});

describe('media references', () => {
  it('recognizes and parses media refs', () => {
    expect(isMediaRef('media:abc-123#4')).toBe(true);
    expect(parseMediaRef('media:abc-123#4')).toEqual({ id: 'abc-123', total: 4 });
  });

  it('passes through data URLs and links', () => {
    expect(isMediaRef('data:audio/mpeg;base64,AAA')).toBe(false);
    expect(isMediaRef('https://youtube.com/x')).toBe(false);
    expect(isMediaRef(undefined)).toBe(false);
  });

  it('rejects malformed refs', () => {
    expect(parseMediaRef('media:#4')).toBeNull();
    expect(parseMediaRef('media:abc#zero')).toBeNull();
    expect(parseMediaRef('media:abc#0')).toBeNull();
  });
});

import { describe, it, expect } from 'vitest';
import { splitIntoChunks, parseMediaRef, isMediaRef } from './mediaStore';

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

import { describe, expect, it } from 'vitest';
import { dataUrlToBytes } from './media';

/**
 * Walk-on music resolves to a `data:` URL and Run Show has to turn that into
 * bytes for Web Audio. It used to fetch() the URL, which CSP `connect-src`
 * blocks — every soundboard press failed silently. These cover the decode that
 * replaced it.
 */
describe('dataUrlToBytes', () => {
  it('decodes a base64 data URL to its bytes', () => {
    // "ID3" — the tag every MP3 an operator uploads starts with.
    const bytes = dataUrlToBytes('data:audio/mpeg;base64,SUQz');
    expect(bytes && Array.from(bytes)).toEqual([0x49, 0x44, 0x33]);
  });

  it('round-trips arbitrary binary, including high bytes', () => {
    const original = new Uint8Array([0, 1, 127, 128, 200, 255]);
    const base64 = btoa(String.fromCharCode(...original));
    const bytes = dataUrlToBytes(`data:audio/mpeg;base64,${base64}`);
    expect(bytes && Array.from(bytes)).toEqual(Array.from(original));
  });

  it('produces a buffer sized exactly to the payload', () => {
    const bytes = dataUrlToBytes('data:audio/mpeg;base64,SUQz');
    // decodeAudioData gets `bytes.buffer` directly, so any slack would be
    // trailing garbage handed to the decoder.
    expect(bytes?.byteLength).toBe(3);
    expect(bytes?.buffer.byteLength).toBe(3);
  });

  it('tolerates base64 wrapped across lines', () => {
    const bytes = dataUrlToBytes('data:audio/mpeg;base64,SU\nQz\r\n');
    expect(bytes && Array.from(bytes)).toEqual([0x49, 0x44, 0x33]);
  });

  it('decodes a percent-encoded (non-base64) data URL', () => {
    const bytes = dataUrlToBytes('data:text/plain,ID%33');
    expect(bytes && Array.from(bytes)).toEqual([0x49, 0x44, 0x33]);
  });

  it('handles an empty payload', () => {
    expect(dataUrlToBytes('data:audio/mpeg;base64,')?.byteLength).toBe(0);
  });

  it('returns null for sources that are not data URLs', () => {
    expect(dataUrlToBytes('https://example.com/walk-on.mp3')).toBeNull();
    expect(dataUrlToBytes('media:abc#2')).toBeNull();
    expect(dataUrlToBytes('data:audio/mpeg;base64')).toBeNull(); // no comma
  });

  it('returns null rather than throwing on undecodable base64', () => {
    expect(dataUrlToBytes('data:audio/mpeg;base64,!!!!not base64!!!!')).toBeNull();
  });
});

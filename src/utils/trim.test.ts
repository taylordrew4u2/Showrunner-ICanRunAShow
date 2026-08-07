import { describe, expect, it } from 'vitest';
import { formatTimecode, parseTimecode, trimSummary, trimmedLength } from './trim';

describe('parseTimecode', () => {
  it('reads the mm:ss a music player shows', () => {
    expect(parseTimecode('1:23')).toBe(83);
    expect(parseTimecode('0:47')).toBe(47);
    expect(parseTimecode('10:00')).toBe(600);
  });

  it('takes bare seconds, so knowing the drop is at 47 is enough', () => {
    expect(parseTimecode('47')).toBe(47);
    expect(parseTimecode('90')).toBe(90);
  });

  it('handles an hour-long set recording', () => {
    expect(parseTimecode('1:02:03')).toBe(3723);
  });

  it('keeps sub-second precision when given it', () => {
    expect(parseTimecode('1:23.5')).toBe(83.5);
  });

  it('rejects what is not a time rather than guessing at it', () => {
    expect(parseTimecode('')).toBeNull();
    expect(parseTimecode('chorus')).toBeNull();
    expect(parseTimecode('1:2:3:4')).toBeNull();
    expect(parseTimecode('-5')).toBeNull();
    // A minutes field over 59 is a typo, not a very long minute.
    expect(parseTimecode('1:90')).toBeNull();
  });
});

describe('formatTimecode', () => {
  it('prints mm:ss, and hours only when there are hours', () => {
    expect(formatTimecode(83)).toBe('1:23');
    expect(formatTimecode(47)).toBe('0:47');
    expect(formatTimecode(3723)).toBe('1:02:03');
  });

  it('is blank for nothing set, rather than a misleading 0:00', () => {
    expect(formatTimecode(undefined)).toBe('');
  });

  it('round-trips with the parser', () => {
    for (const s of ['0:47', '1:23', '10:00', '1:02:03']) {
      expect(formatTimecode(parseTimecode(s)!)).toBe(s);
    }
  });
});

describe('trimmedLength', () => {
  it('measures from the in-point, not from the top of the file', () => {
    expect(trimmedLength(30, 45)).toBe(15);
  });

  it('plays to the end when there is no out-point', () => {
    expect(trimmedLength(30, undefined)).toBeNull();
  });

  it('treats an out-point at or before the in-point as unfinished, not as silence', () => {
    // Scheduling a negative duration would stop the source in the past and the
    // button would make no sound at all.
    expect(trimmedLength(45, 30)).toBeNull();
    expect(trimmedLength(30, 30)).toBeNull();
  });
});

describe('trimSummary', () => {
  it('says nothing at all for an untrimmed song', () => {
    expect(trimSummary(undefined, undefined)).toBeNull();
    expect(trimSummary(0, undefined)).toBeNull();
  });

  it('describes each shape of trim the way a producer would say it', () => {
    expect(trimSummary(30, 45)).toBe('0:30–0:45');
    expect(trimSummary(30, undefined)).toBe('from 0:30');
    expect(trimSummary(undefined, 20)).toBe('first 0:20');
  });
});

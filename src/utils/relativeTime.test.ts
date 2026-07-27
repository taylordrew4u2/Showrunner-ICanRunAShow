import { describe, it, expect } from 'vitest';
import { timeAgo, lastSavedSentence } from './relativeTime';

const NOW = new Date('2026-07-27T20:00:00Z').getTime();
const sec = 1000;
const min = 60 * sec;
const hr = 60 * min;

describe('timeAgo', () => {
  it('says "just now" only for the last few seconds', () => {
    expect(timeAgo(NOW, NOW)).toBe('just now');
    expect(timeAgo(NOW - 14 * sec, NOW)).toBe('just now');
    expect(timeAgo(NOW - 15 * sec, NOW)).toBe('15 sec ago');
  });

  it('steps up through minutes and hours', () => {
    expect(timeAgo(NOW - 59 * sec, NOW)).toBe('59 sec ago');
    expect(timeAgo(NOW - 60 * sec, NOW)).toBe('1 min ago');
    expect(timeAgo(NOW - 59 * min, NOW)).toBe('59 min ago');
    expect(timeAgo(NOW - 60 * min, NOW)).toBe('1 hr ago');
    expect(timeAgo(NOW - 23 * hr, NOW)).toBe('23 hr ago');
  });

  it('falls back to a date past a day, rather than "36 hr ago"', () => {
    const label = timeAgo(NOW - 36 * hr, NOW);
    expect(label).not.toContain('hr ago');
    expect(label).toMatch(/\d/);
  });

  // Rounding a five-minute-old save down to "just now" would be the status
  // pill telling a small lie, which is the one thing it can't do.
  it('never rounds a stale timestamp down to "just now"', () => {
    expect(timeAgo(NOW - 5 * min, NOW)).toBe('5 min ago');
    expect(timeAgo(NOW - 90 * sec, NOW)).toBe('1 min ago');
  });

  // Clock skew between the device and the server can put a save "in the
  // future"; that must read as fresh, not as a negative age.
  it('treats a future timestamp as just now', () => {
    expect(timeAgo(NOW + 30 * sec, NOW)).toBe('just now');
  });
});

describe('lastSavedSentence', () => {
  it('reads as calm, not broken, when nothing has saved yet', () => {
    const sentence = lastSavedSentence(null, NOW);
    expect(sentence).toBe('Nothing has needed saving yet.');
    expect(sentence).not.toMatch(/not yet|never|fail/i);
  });

  it('states when the last save landed', () => {
    expect(lastSavedSentence(NOW - 2 * min, NOW)).toBe('Last confirmed save 2 min ago.');
  });
});

import { describe, expect, it } from 'vitest';
import { PAD_COLOR_COUNT, padColor } from './padColor';

describe('padColor', () => {
  it('gives a track the same colour every time', () => {
    // The whole point: muscle memory only builds if tonight matches last week.
    expect(padColor('dj:abc123')).toEqual(padColor('dj:abc123'));
  });

  it('does not depend on position, so reordering the show changes nothing', () => {
    const before = ['cue:a', 'cue:b', 'cue:c'].map(padColor);
    const after = ['cue:c', 'cue:a', 'cue:b'].map(padColor);
    expect(after[0]).toEqual(before[2]);
    expect(after[1]).toEqual(before[0]);
    expect(after[2]).toEqual(before[1]);
  });

  it('spreads neighbouring ids rather than clumping them', () => {
    // Ids generated in a row are the common case — a lineup added in one go.
    const keys = Array.from({ length: PAD_COLOR_COUNT }, (_, i) => `dj:track-${i}`);
    const distinct = new Set(keys.map((k) => JSON.stringify(padColor(k))));
    // Not demanding all twelve — that would be asserting a specific hash. A
    // board of twelve landing on fewer than half the palette would be clumping.
    expect(distinct.size).toBeGreaterThanOrEqual(PAD_COLOR_COUNT / 2);
  });

  it('never hands back green or amber, which mean playing and loading', () => {
    // A green knob beside a lit pad is a press you cannot take back.
    const keys = Array.from({ length: 200 }, (_, i) => `performer:p${i}`);
    for (const key of keys) {
      const { hi } = padColor(key);
      const r = parseInt(hi.slice(1, 3), 16);
      const g = parseInt(hi.slice(3, 5), 16);
      const b = parseInt(hi.slice(5, 7), 16);
      // Green-dominant: g clearly ahead of both others.
      expect(g > r + 24 && g > b + 24).toBe(false);
      // Amber: red and green high together, blue well behind.
      expect(r > 200 && g > 140 && b < 110).toBe(false);
    }
  });

  it('answers for any key, including odd ones', () => {
    for (const key of ['', 'x', 'dj:', '💿', 'performer:' + 'y'.repeat(500)]) {
      const c = padColor(key);
      expect(c.hi).toMatch(/^#[0-9a-f]{6}$/);
      expect(c.lo).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});

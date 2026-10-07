import { describe, expect, it } from 'vitest';
import { avatarHue } from './avatarTint';

describe('the letter avatar colour', () => {
  it('is the same for the same person however the name was typed', () => {
    expect(avatarHue('Maya Reyes')).toBe(avatarHue('  maya reyes '));
  });

  it('differs between people', () => {
    const hues = new Set(['Corey Cooley', 'Maya Reyes', 'Dev Okafor', 'Sam Tran'].map(avatarHue));
    expect(hues.size).toBe(4);
  });

  it('is always a hue', () => {
    for (const n of ['', 'Z', 'Ünïcödé 名前']) {
      const h = avatarHue(n);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(360);
    }
  });
});

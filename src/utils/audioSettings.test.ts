import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_FADE,
  FADE_PRESETS,
  MAX_FADE_IN_MS,
  fmtFade,
  loadFadeSettings,
  matchesPreset,
  saveFadeSettings,
} from './audioSettings';

// The util runs in the browser; the test env is node, so stand up the bit of
// storage it touches.
function stubStorage() {
  const map = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  });
  return map;
}

describe('fade settings', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('starts on the press by default', () => {
    stubStorage();
    // A walk-on is cued to a name being said, so any ramp is a late entrance.
    // The old 1400ms default is what made a press read as "nothing happened".
    expect(loadFadeSettings().fadeInMs).toBe(0);
  });

  it('still eases out by default, so killing a track does not click', () => {
    stubStorage();
    expect(loadFadeSettings().fadeOutMs).toBeGreaterThan(0);
  });

  it('round-trips a saved setting', () => {
    stubStorage();
    saveFadeSettings({ fadeInMs: 2000, fadeOutMs: 100 });
    expect(loadFadeSettings()).toEqual({ fadeInMs: 2000, fadeOutMs: 100 });
  });

  it('keeps a zero fade rather than treating it as missing', () => {
    stubStorage();
    saveFadeSettings({ fadeInMs: 0, fadeOutMs: 0 });
    // Instant is a real choice for stings — a falsy check here would silently
    // restore the default and the operator's setting would never stick.
    expect(loadFadeSettings()).toEqual({ fadeInMs: 0, fadeOutMs: 0 });
  });

  it('falls back to the default when nothing is stored', () => {
    stubStorage();
    expect(loadFadeSettings()).toEqual(DEFAULT_FADE);
  });

  it('survives corrupt stored JSON', () => {
    const map = stubStorage();
    map.set('showrunner:fade', '{not json');
    expect(loadFadeSettings()).toEqual(DEFAULT_FADE);
  });

  it('clamps out-of-range and non-numeric values', () => {
    const map = stubStorage();
    map.set('showrunner:fade', JSON.stringify({ fadeInMs: 999999, fadeOutMs: -5 }));
    const loaded = loadFadeSettings();
    expect(loaded.fadeInMs).toBe(MAX_FADE_IN_MS);
    expect(loaded.fadeOutMs).toBe(0);

    map.set('showrunner:fade', JSON.stringify({ fadeInMs: 'soon' }));
    expect(loadFadeSettings().fadeInMs).toBe(DEFAULT_FADE.fadeInMs);
  });

  it('survives storage that throws (private mode)', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('denied'); },
      setItem: () => { throw new Error('denied'); },
    });
    expect(loadFadeSettings()).toEqual(DEFAULT_FADE);
    expect(() => saveFadeSettings({ fadeInMs: 100, fadeOutMs: 100 })).not.toThrow();
  });

  it('formats durations the way the slider reads out', () => {
    expect(fmtFade(0)).toBe('Instant');
    expect(fmtFade(400)).toBe('0.4s');
    expect(fmtFade(350)).toBe('0.35s');
    expect(fmtFade(1000)).toBe('1s');
    expect(fmtFade(1400)).toBe('1.4s');
    expect(fmtFade(5000)).toBe('5s');
  });

  it('matches the preset a setting came from', () => {
    const snap = FADE_PRESETS.find((p) => p.id === 'snap')!;
    expect(matchesPreset(snap.fade, snap.fade)).toBe(true);
    expect(matchesPreset({ fadeInMs: 123, fadeOutMs: 456 }, snap.fade)).toBe(false);
  });

  it('offers a hard cut, so a sting can hit on the frame both ways', () => {
    const cut = FADE_PRESETS.find((p) => p.id === 'cut')!;
    expect(cut.fade).toEqual({ fadeInMs: 0, fadeOutMs: 0 });
  });

  it('has a preset matching the default, so one chip always reads as selected', () => {
    stubStorage();
    const fade = loadFadeSettings();
    expect(FADE_PRESETS.some((p) => matchesPreset(fade, p.fade))).toBe(true);
  });

  it('never starts a preset with a ramp long enough to read as dead', () => {
    // Smooth is deliberately slow, but it's opt-in — nothing defaults to it.
    const slow = FADE_PRESETS.filter((p) => p.fade.fadeInMs > 500);
    expect(slow.every((p) => !matchesPreset(DEFAULT_FADE, p.fade))).toBe(true);
  });
});

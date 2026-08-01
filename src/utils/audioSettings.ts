/**
 * How the soundboard fades.
 *
 * The fades used to be two constants in RunShow — 1.4s in, 0.35s out — and a
 * 1.4-second ramp from silence is long enough on a loud stage that a press
 * reads as "nothing happened". Press again to check and the toggle stops the
 * track you just started. So the durations are the operator's to set, they
 * persist across shows, and zero is a valid answer: a sting or a drop wants to
 * hit on the frame, not swell.
 *
 * Stored in localStorage like the color scheme — it's a preference about how
 * this operator runs a room, not show data, and it should apply before sign-in.
 */

export interface FadeSettings {
  /** Ramp up for a track being started, in ms. 0 = start at full volume. */
  fadeInMs: number;
  /** Ramp down when a track is stopped or handed over, in ms. 0 = cut. */
  fadeOutMs: number;
}

/**
 * Short enough that a press sounds immediate, long enough not to click. The
 * old 1400ms default is what made a press feel dead, so this is deliberately
 * near the bottom of the range.
 */
export const DEFAULT_FADE: FadeSettings = { fadeInMs: 400, fadeOutMs: 350 };

/** Slider bounds. Five seconds covers a slow music-under-the-host swell. */
export const MAX_FADE_IN_MS = 5000;
export const MAX_FADE_OUT_MS = 5000;
export const FADE_STEP_MS = 50;

/** Named starting points, so an operator doesn't have to dial in from scratch. */
export const FADE_PRESETS: { id: string; label: string; hint: string; fade: FadeSettings }[] = [
  { id: 'instant', label: 'Instant', hint: 'Cuts in and out — stings and drops', fade: { fadeInMs: 0, fadeOutMs: 0 } },
  { id: 'tight', label: 'Tight', hint: 'Sounds immediate, no click', fade: DEFAULT_FADE },
  { id: 'smooth', label: 'Smooth', hint: 'Music under the host', fade: { fadeInMs: 1400, fadeOutMs: 600 } },
];

const STORAGE_KEY = 'showrunner:fade';

function clampMs(value: unknown, max: number, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(max, Math.round(n)));
}

export function loadFadeSettings(): FadeSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_FADE;
    const parsed = JSON.parse(raw) as Partial<FadeSettings>;
    return {
      fadeInMs: clampMs(parsed.fadeInMs, MAX_FADE_IN_MS, DEFAULT_FADE.fadeInMs),
      fadeOutMs: clampMs(parsed.fadeOutMs, MAX_FADE_OUT_MS, DEFAULT_FADE.fadeOutMs),
    };
  } catch {
    return DEFAULT_FADE;
  }
}

export function saveFadeSettings(fade: FadeSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(fade));
  } catch {
    /* private mode / storage full — the setting just won't persist */
  }
}

/** "Instant" / "0.4s" — what the slider reads out next to itself. */
export function fmtFade(ms: number): string {
  if (ms <= 0) return 'Instant';
  return `${(ms / 1000).toFixed(ms < 1000 ? 2 : 1).replace(/0$/, '').replace(/\.$/, '')}s`;
}

/** Whether a fade pair matches a preset, so the chip can show as selected. */
export function matchesPreset(fade: FadeSettings, preset: FadeSettings): boolean {
  return fade.fadeInMs === preset.fadeInMs && fade.fadeOutMs === preset.fadeOutMs;
}

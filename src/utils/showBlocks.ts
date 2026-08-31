import type { SectionKey } from '../types';

/**
 * Which sections a show is built from.
 *
 * Sections are opt-in per show — a variety night wants Scenes, a stand-up
 * night wants a lineup and a run-of-show, and neither should have to look at
 * the other's empty rows. What a *new* show starts with is a separate
 * question, and getting it wrong is expensive: starting from nothing selected
 * meant every new show opened on a single "Basic Info" row with no way to add
 * a performer or a cue that didn't begin with finding a menu, which reads as
 * the app being broken rather than as a choice waiting to be made.
 */

/** Sections the producer can turn on or off. "Basic Info" is always present. */
export const SELECTABLE_SECTIONS: SectionKey[] = [
  'performers',
  'artists',
  'schedule',
  'dj',
  'staff',
  'vendors',
  'scenes',
];

/**
 * What a new show starts with: the lineup and the run-of-show.
 *
 * These two are what the app is for, so a show without either has nothing to
 * work on. Everything else stays off, and all of it is one tap away.
 */
export const DEFAULT_SECTIONS: SectionKey[] = ['performers', 'schedule'];

/**
 * The inverse of a selection, which is what a show actually stores.
 *
 * Sections are recorded by what is *hidden* rather than what is shown, so that
 * a section added to the app later appears on existing shows instead of
 * silently staying off for everyone who has ever made a show.
 */
export function hiddenFromSelected(selected: Iterable<SectionKey>): SectionKey[] {
  const on = new Set(selected);
  return SELECTABLE_SECTIONS.filter((key) => !on.has(key));
}

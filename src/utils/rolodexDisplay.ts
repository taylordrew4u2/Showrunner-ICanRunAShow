/**
 * How a Rolodex entry is set on the page: the monogram that stands in for a
 * headshot, the one quiet line under a name, and the count above the list.
 *
 * All of it reads what is already filed. Nothing here writes, and nothing
 * here changes what a person's entry holds.
 */

import { avatarHue } from './avatarTint';
import { performerReadiness } from './performerReadiness';
import { toHandle } from './social';
import type { PotentialComic } from '../types';

/** Generational suffixes are not a surname: "Sam Lee Jr." is SL, not SJ. */
const SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v']);

/** The first letter or digit of a word, whatever punctuation leads it. */
function firstLetter(word: string): string {
  return word.match(/[\p{L}\p{N}]/u)?.[0] ?? '';
}

/** Latin, Greek, Cyrillic and the like: scripts whose letters have capitals. A digit counts. */
function isCased(letter: string): boolean {
  return letter.toLocaleLowerCase() !== letter.toLocaleUpperCase() || /\p{N}/u.test(letter);
}

/**
 * The initials that stand in for a headshot: first and last name, or the one
 * letter of a single name. Empty when the name has no letter to show.
 */
export function monogramInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter((word) => firstLetter(word) !== '');
  while (words.length > 1 && SUFFIXES.has(words[words.length - 1].replace(/[^\p{L}]/gu, '').toLowerCase())) {
    words.pop();
  }
  if (words.length === 0) return '';
  const first = firstLetter(words[0]);
  // Two capitals sit side by side as a monogram. Letters of a joined script
  // (Arabic, say) would fuse into something that is neither initial, so a
  // name written in one is marked by its first letter alone.
  if (!isCased(first)) return first;
  const last = words.length > 1 ? firstLetter(words[words.length - 1]) : '';
  return (first + (isCased(last) ? last : '')).toLocaleUpperCase();
}

/** How many monogram tints the stylesheet defines (--monogram-tint-1 … -4). */
export const MONOGRAM_TONES = 4;

/**
 * Which of the tints a name gets: 1 to MONOGRAM_TONES. Keyed off the name the
 * same way the lineup's letter avatars are, so a person keeps theirs on every
 * device and through every reload.
 */
export function monogramTone(name: string): number {
  return (avatarHue(name) % MONOGRAM_TONES) + 1;
}

/**
 * The one quiet line under a name: their handle, their tape, their walk-on.
 * Only what is filed, in that order; nothing for a bare name.
 *
 * A profile link is shown as the handle it carries ("@mona" rather than the
 * whole address), which is how the announcement tags them anyway. Anything
 * that is not a handle or a profile link is shown as it was typed.
 */
export function rolodexFacts(comic: PotentialComic): string[] {
  const facts: string[] = [];
  const social = comic.socialMedia?.trim();
  if (social) facts.push(toHandle(social) ?? social);
  if (comic.tapeMinutes) facts.push(`${comic.tapeMinutes}-minute tape`);
  else if (comic.videoLink?.trim()) facts.push('Tape');
  const walkOn = [comic.walkOnMusicName, comic.walkOnMusicArtist].filter(Boolean).join(' — ');
  if (walkOn) facts.push(walkOn);
  return facts;
}

/**
 * The line above the list: how many people are filed, and how many of them
 * still have a detail to get (the same rule each row's "Needs …" uses).
 */
export function rolodexSummary(
  comics: PotentialComic[],
  term: { singular: string; plural: string },
): string {
  const count = comics.length;
  const noun = (count === 1 ? term.singular : term.plural).toLowerCase();
  const missing = comics.filter((comic) => performerReadiness(comic).gaps.length > 0).length;
  const parts = [`${count} ${noun}`];
  if (missing > 0) parts.push(`${missing} missing details`);
  return parts.join(' · ');
}

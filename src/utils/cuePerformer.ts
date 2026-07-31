import type { ScheduleItem } from '../types';

/**
 * Spotting a known name inside a cue's text.
 *
 * Run sheets are written the way people talk — "8:20 Ada Cole (10)", "Miles
 * Trent — feature". The name is right there in the line, but the app only knew
 * it as prose, so Run Show had no performer to put on stage and no walk-on to
 * play. Everyone was re-typing names the app already had in the Rolodex.
 *
 * The matching is deliberately timid. It only ever *fills a blank*: a cue that
 * already names someone is left alone, so a wrong guess can never overwrite a
 * right answer, and clearing the field is one edit.
 */

/** Names shorter than this match too much — "Al" would hit "Alan" and "already". */
const MIN_NAME_LENGTH = 3;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The known name that appears in `text`, or null.
 *
 * Longest match wins: with both "Ada" and "Ada Cole" on file, a line reading
 * "Ada Cole — 10 min" is Ada Cole. Ties go to whoever appears first in the
 * line, which is the one being introduced rather than one mentioned later.
 */
export function matchKnownName(text: string, names: string[]): string | null {
  const haystack = text?.trim();
  if (!haystack) return null;

  let best: { name: string; index: number } | null = null;

  for (const raw of names) {
    const name = raw?.trim();
    if (!name || name.length < MIN_NAME_LENGTH) continue;

    // \b won't do: a name can start or end with punctuation or a non-ASCII
    // letter, where \b sits in the wrong place. Look for a non-letter (or the
    // ends of the string) on either side instead.
    const pattern = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(name)}($|[^\\p{L}\\p{N}])`, 'iu');
    const found = pattern.exec(haystack);
    if (!found) continue;

    const index = found.index;
    if (
      !best ||
      name.length > best.name.length ||
      (name.length === best.name.length && index < best.index)
    ) {
      best = { name, index };
    }
  }

  return best?.name ?? null;
}

/**
 * Fill in the performer on any cue that doesn't name one but mentions someone
 * the app already knows. Returns the same array when nothing matched, so a
 * caller can skip a state update entirely.
 */
export function withMatchedPerformers(items: ScheduleItem[], names: string[]): ScheduleItem[] {
  if (names.length === 0) return items;

  let changed = false;
  const next = items.map((item) => {
    if (item.performer?.trim()) return item;
    const match = matchKnownName(item.description, names);
    if (!match) return item;
    changed = true;
    return { ...item, performer: match };
  });

  return changed ? next : items;
}

import type { Performer, PotentialComic } from '../types';
import { generateId } from './id';

/**
 * Filing performers into the Rolodex.
 *
 * The Rolodex is the running list of people you might book again. Keeping it
 * accurate used to be manual: open a performer's profile, press "Save to
 * Rolodex". People who were booked once and never filed simply weren't there
 * when it came time to build the next lineup — which is the one moment the
 * list exists for.
 *
 * Anyone added to a show is filed automatically now. The manual button stays,
 * because it does a different job: it pushes a performer's *current* profile
 * (walk-on music, credits) over an existing entry, where filing only ever adds
 * someone missing.
 */

/**
 * The name, reduced to what two spellings must share to be the same person.
 * Case and stray whitespace differ constantly between a lineup and a rolodex;
 * treating "ada  cole" and "Ada Cole" as two people would defeat the point.
 */
export function rolodexKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** A performer as a Rolodex entry, carrying across everything both types hold. */
export function performerToComic(performer: Performer): PotentialComic {
  return {
    id: generateId(),
    name: performer.name.trim(),
    socialMedia: performer.socialMedia,
    email: performer.email,
    credits: performer.credits,
    walkOnMusic: performer.walkOnMusic,
    walkOnMusicName: performer.walkOnMusicName,
    walkOnMusicArtist: performer.walkOnMusicArtist,
    walkOnMusicTimestamp: performer.walkOnMusicTimestamp,
    walkOnMusicLink: performer.walkOnMusicLink,
  };
}

/**
 * The Rolodex with `performers` folded in, or `null` when they were all already
 * there.
 *
 * `null` rather than an unchanged copy: the caller writes the whole encrypted
 * settings blob on every change, and adding someone who's already filed is the
 * common case — picking a name straight out of the Rolodex goes through here
 * too. Returning null keeps that from costing a round trip.
 *
 * Existing entries are never overwritten. Someone filed a year ago has notes
 * and a profile on them; a fresh booking of the same name knows less, and
 * quietly replacing the richer record with the thinner one would lose work.
 */
export function addPerformersToRolodex(
  comics: PotentialComic[],
  performers: Performer[],
): PotentialComic[] | null {
  const known = new Set(comics.map((comic) => rolodexKey(comic.name)));
  const additions: PotentialComic[] = [];

  for (const performer of performers) {
    const key = rolodexKey(performer.name ?? '');
    // An unnamed performer is a half-finished row, not a person to file.
    if (!key || known.has(key)) continue;
    // Guard against the same name twice in one lineup filing two entries.
    known.add(key);
    additions.push(performerToComic(performer));
  }

  if (additions.length === 0) return null;
  // Newest first, matching where a manual "Save to Rolodex" puts someone.
  return [...additions, ...comics];
}

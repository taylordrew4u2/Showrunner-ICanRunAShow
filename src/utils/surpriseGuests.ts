import type { Performer } from '../types';

/**
 * Surprise guests: people booked on a show and kept off everything the public
 * sees until they walk on.
 *
 * They stay in the show's one `performers` list, flagged, rather than getting
 * a list of their own. Every path that already handles a lineup — sync, merge,
 * the Rolodex, trash, media cleanup, Run Show — then carries them with no
 * migration, and only the screens that face the public have to know, by
 * asking these helpers who is on the posted bill.
 */

/** What the room is told in their place, and what the producer's marks say. */
export const SURPRISE_GUEST_LABEL = 'Surprise guest';

type Flagged = Pick<Performer, 'surpriseGuest'>;

export function isSurpriseGuest(person: Flagged | null | undefined): boolean {
  return person?.surpriseGuest === true;
}

/** The bill as it can be posted: everyone who is not a surprise, in order. */
export function billedPerformers<T extends Flagged>(people: T[]): T[] {
  return people.filter((person) => !isSurpriseGuest(person));
}

/** The surprise guests, in the order they sit on the bill. */
export function surpriseGuests<T extends Flagged>(people: T[]): T[] {
  return people.filter((person) => isSurpriseGuest(person));
}

/**
 * Move someone one place up or down among the people on their own tab.
 *
 * Both tabs are views of one list, and that list's order is the order the
 * viewer link shows. The arrow means "swap with whoever is next to me on
 * screen", even when someone from the other tab sits between the two of them
 * in the list underneath — so the swap skips over the other tab's people
 * rather than trading places with someone the producer cannot see.
 */
export function moveWithinGroup<T extends Performer>(people: T[], id: string, dir: -1 | 1): T[] {
  const index = people.findIndex((person) => person.id === id);
  if (index < 0) return people;
  const guest = isSurpriseGuest(people[index]);
  let target = index + dir;
  while (target >= 0 && target < people.length && isSurpriseGuest(people[target]) !== guest) {
    target += dir;
  }
  if (target < 0 || target >= people.length) return people;
  const next = [...people];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

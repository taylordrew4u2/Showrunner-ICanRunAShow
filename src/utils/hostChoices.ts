/**
 * Who can be made host of a show.
 *
 * Hosting is a job rather than a spot on the bill, so the host usually isn't
 * one of the booked performers — which is why offering only the lineup meant
 * the name got typed in by hand, spelling and all, every single show. The
 * Rolodex is where that name already lives, so it's offered too.
 */
import type { Artist, Performer, PotentialComic } from '../types';

export interface HostChoices {
  /** Names already on this show's bill. */
  onBill: string[];
  /** Everyone else on file, from the Rolodex. */
  rolodex: string[];
}

/**
 * The bill comes first, and a name in both places is listed once, under the
 * bill: a name spelled one way on this lineup and another way in the Rolodex
 * should keep the spelling the show actually uses.
 */
export function hostChoices(
  performers: Performer[],
  artists: Artist[] | undefined,
  potentialComics: PotentialComic[],
): HostChoices {
  const seen = new Set<string>();
  const take = (names: string[]) => {
    const out: string[] = [];
    for (const raw of names) {
      const name = raw.trim();
      if (!name || seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      out.push(name);
    }
    return out;
  };
  const onBill = take([
    ...performers.map((p) => p.name),
    ...(artists ?? []).map((a) => a.name),
  ]);
  return { onBill, rolodex: take(potentialComics.map((c) => c.name)) };
}

import type { Show, Performer, Artist } from '../types';

/**
 * Intro cards — the stack a host reads from at the mic.
 *
 * The export already listed performers in a table, which is a fine record and
 * a bad thing to hold under a stage light. What a host actually wants is one
 * card per act: the name big enough to read at a glance, the credits in the
 * words they'll say out loud, and the walk-on cue so they know what's coming.
 *
 * Cards come out in the order they'll be read. When the running order names
 * people, that's the order used; anyone the schedule doesn't mention follows in
 * lineup order, so a half-written schedule still produces a usable stack rather
 * than dropping the acts it hasn't got to yet.
 */

export interface IntroCard {
  id: string;
  /** Position in the stack, 1-based — printed on the card so a dropped deck can be reordered. */
  order: number;
  name: string;
  credits: string | null;
  /** "Nightcall — Kavinsky @ 0:42" */
  walkOn: string | null;
  social: string | null;
  kind: 'performer' | 'artist';
}

function clean(value: string | undefined | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** The walk-on, said the way a host would need it: track, artist, cue point. */
export function walkOnLine(p: { walkOnMusicName?: string; walkOnMusicArtist?: string; walkOnMusicTimestamp?: string }): string | null {
  const name = clean(p.walkOnMusicName);
  const artist = clean(p.walkOnMusicArtist);
  const at = clean(p.walkOnMusicTimestamp);
  if (!name && !artist) return null;
  const track = [name, artist].filter(Boolean).join(' — ');
  return at ? `${track} @ ${at}` : track;
}

/**
 * Where each name first appears in the running order, so cards can be stacked
 * in reading order. Matching is on the cue's free-text performer field, which
 * is how imported schedules carry a name.
 */
function scheduleRank(show: Show): Map<string, number> {
  const rank = new Map<string, number>();
  show.schedule.forEach((cue, i) => {
    const key = cue.performer?.trim().toLowerCase();
    if (key && !rank.has(key)) rank.set(key, i);
  });
  return rank;
}

export function buildIntroCards(show: Show): IntroCard[] {
  const rank = scheduleRank(show);

  const people: Array<{ person: Performer | Artist; kind: 'performer' | 'artist'; billIndex: number }> = [
    ...show.performers.map((person, i) => ({ person, kind: 'performer' as const, billIndex: i })),
    ...(show.artists ?? []).map((person, i) => ({
      person,
      kind: 'artist' as const,
      billIndex: show.performers.length + i,
    })),
  ].filter((entry) => clean(entry.person.name));

  const sorted = [...people].sort((a, b) => {
    const ra = rank.get(a.person.name.trim().toLowerCase());
    const rb = rank.get(b.person.name.trim().toLowerCase());
    // Anyone the running order names comes first, in that order. Everyone else
    // keeps their place on the bill, behind them.
    if (ra != null && rb != null) return ra - rb;
    if (ra != null) return -1;
    if (rb != null) return 1;
    return a.billIndex - b.billIndex;
  });

  return sorted.map((entry, i) => {
    const person = entry.person;
    return {
      id: person.id,
      order: i + 1,
      name: person.name.trim(),
      credits: clean(person.credits),
      walkOn: walkOnLine(person),
      social: clean(person.socialMedia),
      kind: entry.kind,
    };
  });
}

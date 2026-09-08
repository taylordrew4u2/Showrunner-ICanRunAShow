import type { MusicTrack, Performer } from '../types';

/**
 * A walk-on for the comic who never sent one.
 *
 * Most of a bill has no walk-on music. Somebody was added at 6pm, somebody
 * never answered, somebody is a drop-in — and on the night that reads as the
 * host saying a name into silence while the comic crosses the room. The
 * library already has music in it. There is no reason for the room to be
 * quiet.
 *
 * So anyone without a walk-on gets one from the library. Two rules make this
 * safe to leave switched on:
 *
 * 1. It only ever fills a blank. A performer with a song keeps it, always —
 *    same as `cuePerformer` filling a cue's empty name field.
 * 2. The pick is *deterministic*, not re-rolled. The same comic gets the same
 *    track every time, on every device, in the preview and on the night.
 *    A genuinely random pick would mean the run sheet you printed and the
 *    thing that comes out of the PA are different songs, which is worse than
 *    silence.
 *
 * The producer can always override by giving them a real walk-on, and the UI
 * says which tracks came from here rather than from a person.
 */

/** A walk-on chosen for someone, and where it came from. */
export interface AssignedWalkOn {
  performerId: string;
  track: MusicTrack;
}

/**
 * A small stable hash of an id.
 *
 * FNV-1a: short, no dependency, and — the only property that matters here —
 * the same answer for the same id forever, so the pick survives a reload, a
 * different phone, and next year.
 */
function hashOf(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Does this performer already have music of their own? */
export function hasWalkOn(performer: Pick<Performer, 'walkOnMusic'>): boolean {
  return Boolean(performer.walkOnMusic?.trim());
}

/**
 * Choose a library track for everyone on the bill who has no walk-on.
 *
 * Picks are spread across the library rather than taken independently: two
 * comics in a row walking on to the same song is the one thing the room
 * notices. Where the library is smaller than the number of blanks, repeats
 * are unavoidable and are at least kept apart.
 */
export function assignFallbackWalkOns(
  performers: Performer[],
  library: MusicTrack[],
): AssignedWalkOn[] {
  const usable = library.filter((t) => t.music?.trim());
  if (usable.length === 0) return [];

  const needing = performers.filter((p) => !hasWalkOn(p));
  if (needing.length === 0) return [];

  // The starting point is derived from the bill itself, so a given lineup
  // always lands on the same songs — but two different shows don't both open
  // with track one.
  const seed = hashOf(needing.map((p) => p.id).join('|'));
  const taken = new Set<number>();
  const out: AssignedWalkOn[] = [];

  needing.forEach((performer, position) => {
    // Walk forward from the performer's own slot until an unused track turns
    // up, wrapping once the library is exhausted.
    const start = (seed + position) % usable.length;
    let index = start;
    for (let step = 0; step < usable.length; step++) {
      const candidate = (start + step) % usable.length;
      if (!taken.has(candidate)) {
        index = candidate;
        break;
      }
    }
    if (taken.size >= usable.length) taken.clear();
    taken.add(index);
    out.push({ performerId: performer.id, track: usable[index] });
  });

  return out;
}

/**
 * The lineup with the blanks filled in, ready for the soundboard.
 *
 * Returned as new objects rather than written to the show: a fallback is a
 * convenience for tonight, not a decision about who this person is. Nothing
 * here is saved, so a producer who later gives them a real walk-on isn't
 * fighting a stored guess.
 */
export function withFallbackWalkOns(
  performers: Performer[],
  library: MusicTrack[],
): Performer[] {
  const assigned = new Map(
    assignFallbackWalkOns(performers, library).map((a) => [a.performerId, a.track]),
  );
  if (assigned.size === 0) return performers;

  return performers.map((performer) => {
    const track = assigned.get(performer.id);
    if (!track) return performer;
    return {
      ...performer,
      walkOnMusic: track.music,
      walkOnMusicName: track.title,
      walkOnMusicArtist: track.artist,
      walkOnStartSec: track.startSec,
      walkOnEndSec: track.endSec,
    };
  });
}

/** How to describe a filled-in walk-on where the producer can see it. */
export function fallbackLabel(track: MusicTrack): string {
  const title = track.title?.trim() || 'A library track';
  const artist = track.artist?.trim();
  return artist ? `${title} — ${artist}` : title;
}

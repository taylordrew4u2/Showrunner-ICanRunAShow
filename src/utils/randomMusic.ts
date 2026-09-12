import type { SoundboardTrack } from './soundboard';

/** Pick a song, counting shared performer/DJ sources once. Prefer decoded audio
 * so an unassigned cue can start now instead of waiting for another download. */
export function randomMusic(
  tracks: SoundboardTrack[],
  draw: number,
  isReady: (src: string) => boolean,
): SoundboardTrack | undefined {
  const unique = [...new Map(tracks.map((track) => [track.src, track])).values()];
  const ready = unique.filter((track) => isReady(track.src));
  const pool = ready.length ? ready : unique;
  return pool[Math.min(pool.length - 1, Math.floor(draw * pool.length))];
}

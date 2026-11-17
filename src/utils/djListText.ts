import type { MusicTrack, Show } from '../types';
import { showDJSongs } from './musicLibrary';

/**
 * The DJ list as a plain text file: the show, its date and venue, then each
 * song in running order with its notes under it. The same list the show runs
 * on, so the music library's tracks are in it too (see showDJSongs).
 *
 * Null when the list is empty: a file headed "DJ MUSIC LIST" with nothing
 * under it is worse than no file. Built apart from the button that saves it
 * so a co-producer's approved download makes exactly the file the owner's
 * own button would.
 */
export function buildDJListText(show: Show, library: MusicTrack[]): { text: string; fileName: string } | null {
  const songs = showDJSongs(show, library);
  if (songs.length === 0) return null;
  const text = [
    `DJ MUSIC LIST`,
    `Show: ${show.name}`,
    show.date ? `Date: ${show.date}` : '',
    show.venueName ? `Venue: ${show.venueName}` : '',
    '',
    '─'.repeat(40),
    '',
    ...songs.map(
      (s, i) =>
        `${String(i + 1).padStart(2, ' ')}. "${s.title}" — ${s.artist}${s.notes ? `\n     Note: ${s.notes}` : ''}`
    ),
  ].filter(Boolean).join('\n');
  const fileName = `DJ-List-${show.name.replace(/[/\\:*?"<>|]+/g, '').replace(/\s+/g, '-')}.txt`;
  return { text, fileName };
}

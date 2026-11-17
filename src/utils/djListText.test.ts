import { describe, expect, it } from 'vitest';
import type { MusicTrack, Show } from '../types';
import { fullSettings, fullShow } from '../coproducer/testFixtures';
import { buildDJListText } from './djListText';
import { showDJSongs } from './musicLibrary';

/**
 * The text file as DJMusicSection built it before it moved here, kept word
 * for word so the move is checked against what it replaced.
 */
function closureBuilt(show: Show, library: MusicTrack[]): { text: string; fileName: string } | null {
  const songs = showDJSongs(show, library);
  if (songs.length === 0) return null;
  const lines = [
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
  return { text: lines, fileName };
}

describe('the DJ list as text', () => {
  const library = fullSettings().musicLibrary;
  const cases: [string, Show, MusicTrack[]][] = [
    ['own songs and the library', fullShow({ djHiddenLibraryIds: [] }), library],
    ['a library track left out', fullShow(), [...library, { ...library[0], id: 'lib2', title: 'Hidden' }]],
    ['no date or venue, and a name with slashes', fullShow({ date: '', venueName: '', name: 'Fri/Sat: "Laughs"' }), []],
    ['songs without notes', fullShow({ djSongs: [{ id: 'd9', title: 'Plain', artist: 'X' }] }), []],
  ];

  for (const [what, show, lib] of cases) {
    it(`matches what the DJ section built, for ${what}`, () => {
      expect(buildDJListText(show, lib)).toEqual(closureBuilt(show, lib));
    });
  }

  it('makes no file for an empty list', () => {
    expect(buildDJListText(fullShow({ djSongs: [] }), [])).toBeNull();
  });

  it('lists the songs in running order with their notes', () => {
    // The show's own song is a copy of lib1, so lib1 is not listed twice.
    const more = [...library, { ...library[0], id: 'lib3', title: 'Closer', notes: undefined }];
    const list = buildDJListText(fullShow({ djHiddenLibraryIds: [] }), more)!;
    expect(list.fileName).toBe('DJ-List-Friday-Laughs.txt');
    expect(list.text).toContain(' 1. "Song One" — Singer\n     Note: Play loud.');
    expect(list.text).toContain(' 2. "Closer" — Band');
    expect(list.text).not.toContain('Library Song');
  });
});

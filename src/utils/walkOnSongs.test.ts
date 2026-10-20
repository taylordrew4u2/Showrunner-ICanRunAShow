import { describe, expect, it } from 'vitest';
import type { DJSong, Performer } from '../types';
import { walkOnSongTitle, withWalkOnSongs, withoutRemovedWalkOns } from './walkOnSongs';

function act(partial: Partial<Performer> & { id: string; name: string }): Performer {
  return { ...partial };
}

/** The rows as the DJ reads them, without the ids. */
function rows(songs: DJSong[]) {
  return songs.map(({ title, artist, notes }) => ({ title, artist, notes }));
}

describe('the title a walk-on goes on the DJ list under', () => {
  it('drops the extension from an uploaded file name', () => {
    expect(walkOnSongTitle('walkon_final_v2.mp3')).toBe('walkon_final_v2');
    expect(walkOnSongTitle('Intro.M4A')).toBe('Intro');
    expect(walkOnSongTitle('bed.wav')).toBe('bed');
  });

  it('keeps a typed title with a full stop in it whole', () => {
    // The same field is the Walk-On Song a producer types into, and a title
    // is not a file name.
    expect(walkOnSongTitle('Mr. Brightside')).toBe('Mr. Brightside');
    expect(walkOnSongTitle('Ms. Jackson')).toBe('Ms. Jackson');
    expect(walkOnSongTitle('Song (feat. X)')).toBe('Song (feat. X)');
  });
});

describe('putting walk-ons on the DJ list', () => {
  it('adds a row when someone is given a walk-on', () => {
    const before = [act({ id: 'p1', name: 'Kim' })];
    const after = [act({ id: 'p1', name: 'Kim', walkOnMusicName: 'Mr. Brightside' })];
    expect(rows(withWalkOnSongs([], before, after))).toEqual([
      { title: 'Mr. Brightside', artist: 'Kim', notes: 'Walk-on: Kim' },
    ]);
  });
});

describe('keeping a walk-on row in step with the act', () => {
  const jo = act({ id: 'p1', name: 'Jo', walkOnMusicName: 'Song A' });
  const joRow: DJSong = { id: 's1', title: 'Song A', artist: 'Jo', notes: 'Walk-on: Jo' };
  const other: DJSong = { id: 's2', title: 'Intermission bed', artist: '' };

  it('retitles the row when the walk-on changes, instead of leaving the old song', () => {
    const after = [{ ...jo, walkOnMusicName: 'Song B' }];
    expect(rows(withWalkOnSongs([joRow, other], [jo], after))).toEqual([
      { title: 'Song B', artist: 'Jo', notes: 'Walk-on: Jo' },
      { title: 'Intermission bed', artist: '', notes: undefined },
    ]);
  });

  it('keeps the row its id, so it is the same song on the list', () => {
    const after = [{ ...jo, walkOnMusicName: 'Song B' }];
    expect(withWalkOnSongs([joRow], [jo], after)[0].id).toBe('s1');
  });

  it('follows a rename, so the next new walk-on does not add a second row', () => {
    const renamed = [{ ...jo, name: 'Joanne' }];
    const afterRename = withWalkOnSongs([joRow], [jo], renamed);
    expect(rows(afterRename)).toEqual([{ title: 'Song A', artist: 'Joanne', notes: 'Walk-on: Joanne' }]);

    const newSong = [{ ...renamed[0], walkOnMusicName: 'Song B' }];
    expect(rows(withWalkOnSongs(afterRename, renamed, newSong))).toEqual([
      { title: 'Song B', artist: 'Joanne', notes: 'Walk-on: Joanne' },
    ]);
  });

  it('follows a rename and a new walk-on saved together', () => {
    const after = [{ ...jo, name: 'Joanne', walkOnMusicName: 'Song B' }];
    expect(rows(withWalkOnSongs([joRow], [jo], after))).toEqual([
      { title: 'Song B', artist: 'Joanne', notes: 'Walk-on: Joanne' },
    ]);
  });

  it('leaves an artist the producer corrected on the row', () => {
    const corrected = { ...joRow, artist: 'The Killers' };
    const after = [{ ...jo, name: 'Joanne' }];
    expect(rows(withWalkOnSongs([corrected], [jo], after))).toEqual([
      { title: 'Song A', artist: 'The Killers', notes: 'Walk-on: Joanne' },
    ]);
  });

  it('takes the row off when the walk-on is cleared', () => {
    const after = [{ ...jo, walkOnMusicName: undefined }];
    expect(rows(withWalkOnSongs([joRow, other], [jo], after))).toEqual([
      { title: 'Intermission bed', artist: '', notes: undefined },
    ]);
  });

  it('leaves a row the producer put audio on alone, rather than mislabel or delete the upload', () => {
    const withAudio = { ...joRow, music: 'media:song-a#1', musicName: 'song-a.mp3' };
    const changed = [{ ...jo, walkOnMusicName: 'Song B' }];
    expect(withWalkOnSongs([withAudio], [jo], changed)).toEqual([withAudio]);
    const cleared = [{ ...jo, walkOnMusicName: undefined }];
    expect(withWalkOnSongs([withAudio], [jo], cleared)).toEqual([withAudio]);
  });

  it('touches nothing when the walk-on and the name are as they were', () => {
    expect(withWalkOnSongs([joRow, other], [jo], [act({ ...jo, socialMedia: '@jo' })])).toEqual([joRow, other]);
  });
});

describe('taking an act off the show', () => {
  const jo = act({ id: 'p1', name: 'Jo', walkOnMusicName: 'Song A' });
  const kim = act({ id: 'p2', name: 'Kim' });
  const joRow: DJSong = { id: 's1', title: 'Song A', artist: 'Jo', notes: 'Walk-on: Jo' };
  const other: DJSong = { id: 's2', title: 'Intermission bed', artist: '' };

  it('takes their walk-on off the DJ list with them', () => {
    // The row stayed behind, and the DJ was handed a walk-on for someone no
    // longer on the bill.
    expect(withoutRemovedWalkOns([joRow, other], [jo, kim], [kim])).toEqual([other]);
  });

  it('keeps the row while someone of that name is still on the show', () => {
    // The same person booked as a performer and an artist, taken off one.
    const asArtist = act({ id: 'a1', name: 'Jo', walkOnMusicName: 'Song A' });
    expect(withoutRemovedWalkOns([joRow], [jo, asArtist], [asArtist])).toEqual([joRow]);
  });

  it('keeps a row the producer put audio on', () => {
    const withAudio = { ...joRow, music: 'media:song-a#1', musicName: 'song-a.mp3' };
    expect(withoutRemovedWalkOns([withAudio], [jo], [])).toEqual([withAudio]);
  });

  it('leaves a row alone when the act taken off had no walk-on of their own', () => {
    // Not one this list put on for them, so not one it takes off.
    const typed: DJSong = { id: 's3', title: 'Surprise', artist: 'Kim', notes: 'Walk-on: Kim' };
    expect(withoutRemovedWalkOns([typed], [jo, kim], [jo])).toEqual([typed]);
  });
});

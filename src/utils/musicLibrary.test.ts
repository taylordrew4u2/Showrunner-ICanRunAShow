import { describe, it, expect } from 'vitest';
import {
  usageCount,
  canDeleteMedia,
  availableTracks,
  songFromTrack,
  songOwnsItsMedia,
  titleFromFileName,
} from './musicLibrary';
import type { DJSong, MusicTrack, Show } from '../types';

const track = (over: Partial<MusicTrack> = {}): MusicTrack => ({
  id: 't1', title: 'Intro Bed', artist: 'Band', music: 'media:abc#2',
  musicName: 'intro.mp3', addedAt: '', ...over,
});

const show = (id: string, djSongs: DJSong[]): Show => ({
  id, name: id, date: '', time: '', location: '', venueName: '',
  status: 'upcoming', performers: [], artists: [], schedule: [], hosts: [],
  djSongs, staff: [], vendors: [], expenses: [], scenes: [],
  createdAt: '', updatedAt: '',
});

describe('usageCount', () => {
  it('counts shows referencing the track', () => {
    const shows = [
      show('a', [{ id: 's1', title: 'x', artist: '', libraryId: 't1' }]),
      show('b', [{ id: 's2', title: 'y', artist: '', libraryId: 't1' }]),
      show('c', [{ id: 's3', title: 'z', artist: '', libraryId: 'other' }]),
    ];
    expect(usageCount(track(), shows)).toBe(2);
  });

  it('counts a show once even if it added the track twice', () => {
    const shows = [show('a', [
      { id: 's1', title: 'x', artist: '', libraryId: 't1' },
      { id: 's2', title: 'x', artist: '', libraryId: 't1' },
    ])];
    expect(usageCount(track(), shows)).toBe(1);
  });

  it('ignores songs uploaded straight into a show', () => {
    const shows = [show('a', [{ id: 's1', title: 'x', artist: '', music: 'media:abc#2' }])];
    expect(usageCount(track(), shows)).toBe(0);
  });

  it('survives a show with no djSongs array', () => {
    const bare = { ...show('a', []), djSongs: undefined as unknown as DJSong[] };
    expect(usageCount(track(), [bare])).toBe(0);
  });
});

describe('canDeleteMedia', () => {
  // The whole point of the reference count: tidying the library must not
  // silently kill playback in a show that is still using the track.
  it('refuses while any show still uses the track', () => {
    const shows = [show('a', [{ id: 's1', title: 'x', artist: '', libraryId: 't1' }])];
    expect(canDeleteMedia(track(), shows)).toBe(false);
  });

  it('allows it once nothing references the track', () => {
    expect(canDeleteMedia(track(), [show('a', [])])).toBe(true);
    expect(canDeleteMedia(track(), [])).toBe(true);
  });
});

describe('availableTracks', () => {
  it('hides tracks the show already has', () => {
    const library = [track({ id: 't1' }), track({ id: 't2' }), track({ id: 't3' })];
    const songs: DJSong[] = [{ id: 's1', title: 'x', artist: '', libraryId: 't2' }];
    expect(availableTracks(library, songs).map((t) => t.id)).toEqual(['t1', 't3']);
  });

  it('is not confused by songs with no libraryId', () => {
    const library = [track({ id: 't1' })];
    const songs: DJSong[] = [{ id: 's1', title: 'x', artist: '' }];
    expect(availableTracks(library, songs).map((t) => t.id)).toEqual(['t1']);
  });
});

describe('songFromTrack', () => {
  it('shares the media reference and records provenance', () => {
    const song = songFromTrack(track(), 'new-id');
    expect(song).toMatchObject({
      id: 'new-id', title: 'Intro Bed', artist: 'Band',
      music: 'media:abc#2', musicName: 'intro.mp3', libraryId: 't1',
    });
  });
});

describe('songOwnsItsMedia', () => {
  it('is false for a song from the library — the audio is shared', () => {
    expect(songOwnsItsMedia({ id: 's', title: 'x', artist: '', music: 'media:abc#2', libraryId: 't1' })).toBe(false);
  });

  it('is true for audio uploaded straight into the show', () => {
    expect(songOwnsItsMedia({ id: 's', title: 'x', artist: '', music: 'media:abc#2' })).toBe(true);
  });

  it('is false when there is no audio at all', () => {
    expect(songOwnsItsMedia({ id: 's', title: 'x', artist: '' })).toBe(false);
  });
});

describe('titleFromFileName', () => {
  it('drops the extension', () => {
    expect(titleFromFileName('Intro Bed.mp3')).toBe('Intro Bed');
    expect(titleFromFileName('walk on.final.wav')).toBe('walk on.final');
  });

  it('keeps a name that has no extension', () => {
    expect(titleFromFileName('untitled')).toBe('untitled');
  });

  it('does not reduce a dotfile to nothing', () => {
    expect(titleFromFileName('.mp3')).toBe('.mp3');
  });
});

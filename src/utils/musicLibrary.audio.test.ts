import { describe, it, expect } from 'vitest';
import { isAutoLibrarySong, showDJSongs, songFromTrack, songsWithoutAudio } from './musicLibrary';
import type { DJSong, MusicTrack, Show } from '../types';

const track = (over: Partial<MusicTrack> = {}): MusicTrack => ({
  id: 't1', title: 'Intro Bed', artist: 'Band', music: 'media:abc#2',
  musicName: 'intro.mp3', addedAt: '', ...over,
});

const show = (id: string, djSongs: DJSong[], hidden: string[] = []): Show => ({
  id, name: id, date: '', time: '', location: '', venueName: '',
  status: 'upcoming', performers: [], artists: [], schedule: [], hosts: [],
  djSongs, djHiddenLibraryIds: hidden, staff: [], vendors: [], expenses: [], scenes: [],
  createdAt: '', updatedAt: '',
});

describe('taking the audio off a DJ list row', () => {
  const bed = track({ id: 't1', title: 'Intro Bed' });
  const sting = track({ id: 't2', title: 'Outro Sting' });

  it('turns a library row into a silent song of this show, listed once', () => {
    // The row was only the library showing through: nothing in the show's own
    // list carried its id, so clearing "its" audio in place changed nothing
    // and the button confirmed and did nothing.
    const before = show('s1', []);
    const [row] = showDJSongs(before, [bed, sting]);
    expect(isAutoLibrarySong(row)).toBe(true);

    const patch = songsWithoutAudio(before.djSongs, before.djHiddenLibraryIds ?? [], row, [bed, sting], 'new1');
    const after = { ...before, ...patch };
    const songs = showDJSongs(after, [bed, sting]);

    expect(songs.map((s) => s.title)).toEqual(['Intro Bed', 'Outro Sting']);
    const silent = songs.find((s) => s.title === 'Intro Bed')!;
    expect(silent.id).toBe('new1');
    expect(silent.music).toBeUndefined();
    expect(silent.musicName).toBeUndefined();
    expect(silent.libraryId).toBeUndefined();
    // The library keeps the track and its audio; only this show let go of it.
    expect(bed.music).toBe('media:abc#2');
    expect(showDJSongs(show('s2', []), [bed, sting])[0].music).toBe('media:abc#2');
  });

  it('clears the audio of a song the show uploaded itself', () => {
    const own: DJSong = { id: 'own1', title: 'Birthday song', artist: 'Dana', music: 'media:own#1', musicName: 'bday.mp3' };
    const patch = songsWithoutAudio([own], [], own, [bed], 'unused');
    expect(patch.djSongs).toEqual([{ id: 'own1', title: 'Birthday song', artist: 'Dana', music: undefined, musicName: undefined, libraryId: undefined }]);
    expect(patch.djHiddenLibraryIds).toEqual([]);
  });

  it('keeps the tracks this show had already removed', () => {
    const before = show('s1', [], [sting.id]);
    const [row] = showDJSongs(before, [bed, sting]);
    const patch = songsWithoutAudio([], [sting.id], row, [bed, sting], 'new1');
    expect(patch.djHiddenLibraryIds).toEqual([sting.id, bed.id]);
  });

  it('keeps the trim and notes the library row showed', () => {
    const cut = track({ id: 't3', title: 'Walk-on', startSec: 10, endSec: 40, notes: 'under the intro' });
    const row = songFromTrack(cut, 'library:t3');
    const patch = songsWithoutAudio([], [], row, [cut], 'new1');
    expect(patch.djSongs[0]).toMatchObject({ title: 'Walk-on', notes: 'under the intro', startSec: 10, endSec: 40 });
  });
});

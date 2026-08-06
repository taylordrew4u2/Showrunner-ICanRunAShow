// Rules for the account-wide music library.
//
// A library track's audio is uploaded once and *shared*: every show that adds
// it points at the same media reference. That makes the storage question a
// reference-counting one — deleting the media is only safe when nothing else
// is pointing at it. Getting this wrong silently kills playback in unrelated
// shows, so the rule lives here with tests rather than inline in a click
// handler.
import type { DJSong, MusicTrack, Show } from '../types';

/** How many shows currently use a library track. */
export function usageCount(track: MusicTrack, shows: Show[]): number {
  return shows.filter((show) =>
    (show.djSongs ?? []).some((song) => song.libraryId === track.id),
  ).length;
}

/**
 * Whether removing a track from the library should also delete its audio.
 *
 * Only when no show still references it. If a show does, the entry leaves the
 * library but the media stays, so that show keeps playing — losing a track
 * mid-show because it was tidied out of a library weeks earlier is not a
 * trade worth making for some storage.
 */
export function canDeleteMedia(track: MusicTrack, shows: Show[]): boolean {
  return usageCount(track, shows) === 0;
}

/**
 * The DJ list a show actually runs on: its own songs, plus every library track.
 *
 * The library is the producer's crate — the walk-on beds, the intermission
 * music, the outro sting are the same every night — so a track uploaded once
 * belongs to every show without being added to each of them by hand.
 *
 * Show-owned songs come first and stay in the order they were put in; library
 * tracks follow. A track already in `djSongs` (added by hand, or before the
 * library filled shows automatically) is not repeated, and one this show has
 * removed is left out entirely.
 *
 * This is a view, not stored data: nothing is written to the show when the
 * library changes, so adding a track adds it everywhere and removing it from
 * the library removes it everywhere, with no per-show cleanup.
 */
export function showDJSongs(show: Show, library: MusicTrack[]): DJSong[] {
  const own = show.djSongs ?? [];
  const hidden = new Set(show.djHiddenLibraryIds ?? []);
  const auto = availableTracks(library, own)
    .filter((track) => !hidden.has(track.id))
    // A stable id derived from the track keeps React keys and the soundboard
    // steady across renders, and makes the entry recognisable as library-owned.
    .map((track) => songFromTrack(track, `library:${track.id}`));
  return [...own, ...auto];
}

/** True for a row that comes from the library rather than this show. */
export function isAutoLibrarySong(song: DJSong): boolean {
  return song.id.startsWith('library:');
}

/** Library tracks not already in this show's DJ list. */
export function availableTracks(library: MusicTrack[], songs: DJSong[]): MusicTrack[] {
  const taken = new Set(songs.map((song) => song.libraryId).filter(Boolean));
  return library.filter((track) => !taken.has(track.id));
}

/** A DJ song built from a library track: same audio, independent notes. */
export function songFromTrack(track: MusicTrack, id: string): DJSong {
  return {
    id,
    title: track.title,
    artist: track.artist,
    notes: track.notes,
    music: track.music,
    musicName: track.musicName,
    libraryId: track.id,
  };
}

/**
 * Whether removing a song from a show should delete its audio. A song that
 * came from the library never owns its media; one uploaded straight into the
 * show does.
 */
export function songOwnsItsMedia(song: DJSong): boolean {
  return !!song.music && !song.libraryId;
}

/** Strip the file extension off an upload to seed a track title. */
export function titleFromFileName(fileName: string): string {
  const base = fileName.replace(/\.[^./\\]+$/, '').trim();
  return base || fileName.trim();
}

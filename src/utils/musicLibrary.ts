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

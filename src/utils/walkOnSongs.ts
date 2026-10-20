import type { DJSong, Performer } from '../types';
import { generateId } from './id';

/** What a performer's or artist's walk-on row on the DJ list is made from. */
type Act = Pick<Performer, 'id' | 'name' | 'walkOnMusicName'>;

/**
 * The title a walk-on goes on the DJ list under.
 *
 * `walkOnMusicName` is both an uploaded file's name and the Walk-On Song
 * field a producer types a title into, so only a real audio extension comes
 * off. Cutting at the last full stop made "Mr. Brightside" a song called "Mr".
 */
export function walkOnSongTitle(walkOnMusicName: string): string {
  return walkOnMusicName.replace(/\.(mp3|m4a|aac|wav|aiff?|ogg|oga|opus|flac|webm)$/i, '');
}

/** How a walk-on row on the DJ list says whose it is. */
function walkOnNote(name: string): string {
  return `Walk-on: ${name}`;
}

/**
 * The DJ list with the walk-ons this edit gave people put on it, so the DJ
 * has every song the night needs without the producer typing it in twice.
 *
 * The row follows the act. It used to be added once and never touched again,
 * so a new walk-on left the DJ playing the old song, and a rename stranded
 * the row under the old name and added a second one at the next new song.
 * Now a new walk-on retitles the row, a rename relabels it, and a cleared
 * walk-on takes it off.
 *
 * A row the producer has put audio on is theirs, though: a new title would
 * mislabel the file, and taking the row off would delete the upload. Only its
 * label follows a rename.
 */
export function withWalkOnSongs(djSongs: DJSong[], before: Act[], after: Act[]): DJSong[] {
  const songs = [...djSongs];
  for (const act of after) {
    const prev = before.find((p) => p.id === act.id);
    const oldName = prev?.name ?? act.name;
    const songChanged = (act.walkOnMusicName || '') !== (prev?.walkOnMusicName || '');
    if (!songChanged && oldName === act.name) continue;

    // Filed under the name they had before this edit. One already under the
    // new name is taken as theirs too, rather than adding a second.
    let index = songs.findIndex((s) => s.notes === walkOnNote(oldName));
    if (index < 0) index = songs.findIndex((s) => s.notes === walkOnNote(act.name));

    if (index < 0) {
      if (songChanged && act.walkOnMusicName) {
        songs.push({
          id: generateId(),
          title: walkOnSongTitle(act.walkOnMusicName),
          artist: act.name,
          notes: walkOnNote(act.name),
        });
      }
      continue;
    }

    const row = songs[index];
    const owned = Boolean(row.music);
    if (songChanged && !act.walkOnMusicName && !owned) {
      songs.splice(index, 1);
      continue;
    }
    songs[index] = {
      ...row,
      title: songChanged && act.walkOnMusicName && !owned ? walkOnSongTitle(act.walkOnMusicName) : row.title,
      // The artist went on as their name. One the producer has corrected to
      // the song's real artist stays.
      artist: row.artist === oldName ? act.name : row.artist,
      notes: walkOnNote(act.name),
    };
  }
  return songs;
}

/**
 * The DJ list without the walk-on rows of acts this edit took off the show.
 *
 * Taking someone off the bill left their row behind, so the DJ was still
 * handed a walk-on for an act who was no longer on. `before` and `after` are
 * the whole show, performers and artists together: one person can be on
 * both, and a row under a name still on the show is still that act's. Only a
 * row that was put on for a walk-on goes, and as above, never one the
 * producer has put audio on.
 */
export function withoutRemovedWalkOns(djSongs: DJSong[], before: Act[], after: Act[]): DJSong[] {
  const staying = new Set(after.map((act) => act.id));
  const stillOn = new Set(after.map((act) => walkOnNote(act.name)));
  const gone = new Set(
    before
      .filter((act) => !staying.has(act.id) && act.walkOnMusicName)
      .map((act) => walkOnNote(act.name))
      .filter((note) => !stillOn.has(note)),
  );
  if (gone.size === 0) return djSongs;
  return djSongs.filter((song) => !(song.notes && gone.has(song.notes) && !song.music));
}

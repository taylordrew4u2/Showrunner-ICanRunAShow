import { useEffect, useRef, useState } from 'react';
import type { DJSong, MusicTrack, Show } from '../../types';
import { generateId } from '../../utils/id';
import { audioUploadSizeError, pickFile } from '../../utils/media';
import { deleteMedia, uploadMedia } from '../../utils/mediaStore';
import {
  isAutoLibrarySong,
  SEARCH_LIST_FROM,
  showDJSongs,
  songFromTrack,
  songOwnsItsMedia,
  trackMatches,
} from '../../utils/musicLibrary';
import { exportDJListToPDF } from '../../utils/pdfExport';
import { Icon } from '../Icon';
import { TrimControls } from '../TrimControls';
import { TrackPreviewButton } from '../TrackPreview';
import '../TrackPreview.css';
import { useTrackPreview } from '../../utils/useTrackPreview';
import { useConfirm } from '../useConfirm';

interface DJMusicSectionProps {
  show: Show;
  /** The account-wide library. Every track in it is in every show. */
  library: MusicTrack[];
  onUpdate: (patch: Partial<Show>) => void;
}

export function DJMusicSection({ show, library, onUpdate }: DJMusicSectionProps) {
  const { confirm, confirmDialog } = useConfirm();
  const preview = useTrackPreview();
  /**
   * The list as it is now, for the handlers that resolve after an await — an
   * audio upload, or a confirmation still waiting to be answered. Rebuilding
   * from the array captured when the button was pressed put the list back the
   * way it was and lost whatever had been added or edited meanwhile.
   */
  // What this show owns. Library tracks are a view over it, so every write
  // goes here rather than to the rendered list.
  const own = show.djSongs ?? [];
  const hidden = show.djHiddenLibraryIds ?? [];
  const songs = showDJSongs(show, library);
  const [songQuery, setSongQuery] = useState('');
  // Every library track is in every show, so this list is as long as the crate
  // — the same reason the library page has a search box.
  //
  // Numbered from the full list before filtering, so a row keeps the position
  // it actually holds. Renumbering the matches would have the search inventing
  // a running order that nothing else agrees with.
  const shownSongs = songs
    .map((song, idx) => ({ song, position: idx + 1 }))
    .filter(({ song }) => trackMatches(song, songQuery));
  // Library tracks this show has dropped, so they can be put back.
  const hiddenFromShow = library.filter((track) => hidden.includes(track.id));
  const ownRef = useRef(own);
  const hiddenRef = useRef(hidden);
  useEffect(() => {
    ownRef.current = show.djSongs ?? [];
    hiddenRef.current = show.djHiddenLibraryIds ?? [];
  }, [show.djSongs, show.djHiddenLibraryIds]);
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [notes, setNotes] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editArtist, setEditArtist] = useState('');
  const [editNotes, setEditNotes] = useState('');
  // Per-song upload status, keyed by song id: 'uploading' or an error message.
  const [uploadState, setUploadState] = useState<Record<string, string>>({});

  function addSong() {
    if (!title.trim()) return;
    const song: DJSong = {
      id: generateId(),
      title: title.trim(),
      artist: artist.trim(),
      notes: notes.trim() || undefined,
    };
    onUpdate({ djSongs: [...own, song] });
    setTitle('');
    setArtist('');
    setNotes('');
  }

  /**
   * Turn a library row into one this show owns, so it can be edited here
   * without the change leaking to every other show. Copy-on-write: until you
   * touch it, the row is just the library's track showing through.
   */
  function materialize(song: DJSong, patch: Partial<DJSong> = {}): DJSong[] {
    const track = library.find((t) => t.id === song.libraryId);
    const base = track ? songFromTrack(track, generateId()) : { ...song, id: generateId() };
    return [...ownRef.current, { ...base, ...patch }];
  }

  async function deleteSong(id: string) {
    const song = songs.find((s) => s.id === id);
    if (!song) return;

    // A library track can't be deleted from inside a show — it belongs to the
    // library, and every other show still wants it. It's dropped from this
    // show only, and says so.
    if (song.libraryId) {
      const ok = await confirm({
        message: `Remove "${song.title}" from this show? It stays in your Music library and in your other shows.`,
        title: 'Remove from this show',
        confirmLabel: 'Remove',
      });
      if (!ok) return;
      onUpdate({
        djSongs: ownRef.current.filter((s) => s.id !== id),
        djHiddenLibraryIds: [...new Set([...hiddenRef.current, song.libraryId])],
      });
      return;
    }

    if (await confirm(`Delete "${song.title}"? This cannot be undone.`)) {
      if (songOwnsItsMedia(song)) deleteMedia(song.music!);
      onUpdate({ djSongs: ownRef.current.filter((s) => s.id !== id) });
    }
  }

  /** Put a library track this show removed back into it. */
  function restoreTrack(trackId: string) {
    onUpdate({ djHiddenLibraryIds: hiddenRef.current.filter((id) => id !== trackId) });
  }

  function startEdit(s: DJSong) {
    setEditId(s.id);
    setEditTitle(s.title);
    setEditArtist(s.artist);
    setEditNotes(s.notes ?? '');
  }

    /**
   * Set a song's in/out points.
   *
   * A library row edited here is copied into this show first, the same as any
   * other edit to one — the crate is shared, so trimming a track for tonight
   * must not re-cut it for every other show. Trimming it in the Music tab is
   * what changes it everywhere.
   */
  function setTrim(song: DJSong, trim: { startSec?: number; endSec?: number }) {
    if (isAutoLibrarySong(song)) {
      onUpdate({ djSongs: materialize(song, trim) });
    } else {
      onUpdate({ djSongs: own.map((s) => (s.id === song.id ? { ...s, ...trim } : s)) });
    }
  }

  function saveEdit() {
    if (!editTitle.trim() || !editId) return;
    const patch = {
      title: editTitle.trim(),
      artist: editArtist.trim(),
      notes: editNotes.trim() || undefined,
    };
    const song = songs.find((s) => s.id === editId);
    if (song && isAutoLibrarySong(song)) {
      // Editing a library row here rewrites it for this show only.
      onUpdate({ djSongs: materialize(song, patch) });
    } else {
      onUpdate({ djSongs: own.map((s) => (s.id === editId ? { ...s, ...patch } : s)) });
    }
    setEditId(null);
  }

  function setStatus(id: string, message: string | null) {
    setUploadState((prev) => {
      const next = { ...prev };
      if (message) next[id] = message;
      else delete next[id];
      return next;
    });
  }

  /**
   * Attach an audio file to a song. It goes to the chunked media store like
   * walk-on music does — the show payload only carries the small `media:`
   * reference — and the upload is what gives the song a button in Run Show.
   */
  async function attachAudio(song: DJSong) {
    const file = await pickFile('audio/*');
    if (!file) return;
    const sizeError = audioUploadSizeError(file);
    if (sizeError) {
      setStatus(song.id, sizeError);
      return;
    }
    setStatus(song.id, 'Uploading audio…');
    try {
      const ref = await uploadMedia(file);
      // Uploading over a library track detaches this song from the library —
      // the audio is now this show's own, and the shared reference it used to
      // point at stays untouched for everyone else.
      const replacingOwnMedia = songOwnsItsMedia(song);
      const previous = song.music;
      const audio = { music: ref, musicName: file.name, libraryId: undefined };
      if (isAutoLibrarySong(song)) {
        // The row was the library's; giving it this show's own file makes it
        // this show's, and hides the library original so it isn't listed twice.
        onUpdate({
          djSongs: materialize(song, audio),
          djHiddenLibraryIds: song.libraryId
            ? [...new Set([...hiddenRef.current, song.libraryId])]
            : hiddenRef.current,
        });
      } else {
        onUpdate({
          djSongs: ownRef.current.map((s) => (s.id === song.id ? { ...s, ...audio } : s)),
        });
      }
      if (previous && replacingOwnMedia) deleteMedia(previous);
      setStatus(song.id, null);
    } catch {
      setStatus(song.id, 'Could not upload that audio file. Check your connection and try again.');
    }
  }

  async function removeAudio(song: DJSong) {
    if (!song.music) return;
    const fromLibrary = !!song.libraryId;
    const question = fromLibrary
      ? `Remove the library track from "${song.title}"? The track stays in your Music library.`
      : `Remove the uploaded audio for "${song.title}"?`;
    if (!(await confirm({ message: question, confirmLabel: 'Remove' }))) return;
    if (songOwnsItsMedia(song)) deleteMedia(song.music);
    onUpdate({
      djSongs: ownRef.current.map((s) =>
        s.id === song.id ? { ...s, music: undefined, musicName: undefined, libraryId: undefined } : s,
      ),
    });
    setStatus(song.id, null);
  }

  function exportDJList() {
    if (songs.length === 0) return;
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

    const blob = new Blob([lines], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `DJ-List-${show.name.replace(/[/\\:*?"<>|]+/g, '').replace(/\s+/g, '-')}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="section-body">
      <div className="section-add-grid">
        <input
          className="section-field__input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Song title"
        />
        <input
          className="section-field__input"
          value={artist}
          onChange={(e) => setArtist(e.target.value)}
          placeholder="Artist name"
        />
        <input
          className="section-field__input"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addSong())}
          placeholder="Notes (e.g. play at 9pm)"
        />
        <button className="btn btn--primary btn--sm" onClick={addSong}>Add</button>
      </div>

      {/* Removed from this show, and one tap from coming back. Without this a
          track dropped here would be gone with no way to see or undo it. */}
      {hiddenFromShow.length > 0 && (
        <div className="dj-library">
          <div className="dj-library__head">
            <span className="dj-library__title">Removed from this show</span>
          </div>
          <ul className="dj-library__list">
            {hiddenFromShow.map((track) => (
              <li key={track.id} className="dj-library__item">
                <span className="dj-library__name">
                  {track.title}{track.artist ? ` — ${track.artist}` : ''}
                </span>
                <button className="btn btn--ghost btn--sm" onClick={() => restoreTrack(track.id)}>
                  Put back
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="section-hint">
        Every track in your Music library is already here, in this show and every other one — the
        crate is the same each night, so there's nothing to add show by show. Songs you add below
        belong to this show alone. Upload audio and a song gets its own button on the Run Show
        soundboard; press ▶ to hear it first — same player, same fade, so nothing is a surprise on
        the night.
      </p>

      {preview.error && (
        <p className="section-error" role="status">
          {preview.error}
        </p>
      )}

      {songs.length === 0 && <p className="section-empty">No songs yet.</p>}

      {songs.length > SEARCH_LIST_FROM && (
        <div className="dj-search">
          <input
            type="search"
            className="section-field__input dj-search__input"
            value={songQuery}
            onChange={(e) => setSongQuery(e.target.value)}
            placeholder="Search songs"
            aria-label="Search songs by title, artist, notes, or file name"
          />
          {songQuery.trim() && (
            <span className="dj-search__count" role="status" aria-live="polite">
              {shownSongs.length} of {songs.length}
            </span>
          )}
        </div>
      )}

      {songs.length > 0 && shownSongs.length === 0 && (
        <p className="section-empty">
          No song here matches “{songQuery.trim()}”.{' '}
          <button className="btn btn--ghost btn--sm" onClick={() => setSongQuery('')}>
            Clear search
          </button>
        </p>
      )}

      <ul className="section-list">
        {shownSongs.map(({ song: s, position }) => (
          <li key={s.id} className="section-list-item">
            <div className="section-list-item__body">
              {editId === s.id ? (
                <div className="section-edit-row">
                  <input className="section-field__input" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} placeholder="Title" />
                  <input className="section-field__input" value={editArtist} onChange={(e) => setEditArtist(e.target.value)} placeholder="Artist" />
                  <input className="section-field__input" value={editNotes} onChange={(e) => setEditNotes(e.target.value)} placeholder="Notes" />
                  <button className="btn btn--primary btn--sm" onClick={saveEdit}>Save</button>
                  <button className="btn btn--ghost btn--sm" onClick={() => setEditId(null)}>Cancel</button>
                </div>
              ) : (
                <>
                  <span className="section-list-item__order">{position}</span>
                  {s.music ? (
                    <TrackPreviewButton src={s.music} title={s.title} preview={preview} />
                  ) : (
                    // The same round slot, empty. A column of buttons with one
                    // gap in it says "that one has no file" faster than reading
                    // every row's tags does.
                    <span className="track-preview track-preview--empty" aria-hidden="true">
                      <Icon name="music" size={16} />
                    </span>
                  )}
                  <span className="section-list-item__name">
                    "{s.title}"{s.artist ? ` — ${s.artist}` : ''}
                  </span>
                  {s.music ? (
                    <span className="section-list-item__tag">♪ {s.musicName || 'Audio'}</span>
                  ) : (
                    <span className="section-list-item__tag">No audio — no soundboard button</span>
                  )}
                  {s.notes && <span className="section-list-item__tag">{s.notes}</span>}
                  {uploadState[s.id] && (
                    <span className="section-list-item__tag">{uploadState[s.id]}</span>
                  )}
                </>
              )}
            </div>
            {editId !== s.id && (
              <div className="section-list-item__actions">
                <button className="btn btn--ghost btn--sm" onClick={() => attachAudio(s)}>
                  {s.music ? 'Replace audio' : 'Upload audio'}
                </button>
                {s.music && (
                  <button className="btn btn--ghost btn--sm" onClick={() => removeAudio(s)}>
                    Remove audio
                  </button>
                )}
                <button className="btn btn--ghost btn--sm" onClick={() => startEdit(s)}>Edit</button>
                <button className="btn btn--ghost btn--sm section-list-item__delete" onClick={() => deleteSong(s.id)}>×</button>
              </div>
            )}
            {/* Only for a row that has audio — there is nothing to cut up
                otherwise, and an empty pair of timecode boxes on every row
                would be noise. */}
            {editId !== s.id && s.music && (
              <TrimControls
                src={s.music}
                startSec={s.startSec}
                endSec={s.endSec}
                onChange={(trim) => setTrim(s, trim)}
              />
            )}
          </li>
        ))}
      </ul>

      {songs.length > 0 && (
        <div className="section-actions">
          <button className="btn btn--secondary" onClick={exportDJList}>
            Share / Export DJ List (Text)
          </button>
          <button className="btn btn--secondary" onClick={() => exportDJListToPDF(show, library)}>
            Export DJ List (PDF)
          </button>
        </div>
      )}
      {confirmDialog}
    </div>
  );
}

import { useState } from 'react';
import type { MusicTrack, Show } from '../types';
import { generateId } from '../utils/id';
import { audioUploadSizeError, pickFile } from '../utils/media';
import { deleteMedia, uploadMedia } from '../utils/mediaStore';
import { canDeleteMedia, SEARCH_LIST_FROM, titleFromFileName, trackMatches, usageCount } from '../utils/musicLibrary';
import { PageHeader } from './PageHeader';
import { TrimControls } from './TrimControls';
import { TrackPreviewButton } from './TrackPreview';
import './TrackPreview.css';
import { useTrackPreview } from '../utils/useTrackPreview';
import './MusicLibrary.css';
import { useConfirm } from './useConfirm';

interface MusicLibraryProps {
  tracks: MusicTrack[];
  /** Every show, so a track can report (and protect) the shows using it. */
  shows: Show[];
  onChange: (tracks: MusicTrack[]) => void;
  onBack: () => void;
}

/**
 * The account-wide music library.
 *
 * The DJ list used to be per-show, so the same intro bed had to be uploaded
 * again for every show that wanted it — same file, same wait, stored twice.
 * Here it goes up once and any show adds it from the list.
 */
export function MusicLibrary({ tracks, shows, onChange, onBack }: MusicLibraryProps) {
  const { confirm, confirmDialog } = useConfirm();
  const preview = useTrackPreview();
  const [status, setStatus] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editArtist, setEditArtist] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [query, setQuery] = useState('');

  // The crate only grows — every track uploaded for any show is on this page
  // forever — so past a couple of dozen, finding one meant scrolling the lot.
  const shown = tracks.filter((track) => trackMatches(track, query));

  async function addTracks() {
    const file = await pickFile('audio/*');
    if (!file) return;
    const sizeError = audioUploadSizeError(file);
    if (sizeError) {
      setStatus(sizeError);
      return;
    }
    setBusy(true);
    setStatus(`Uploading ${file.name}…`);
    try {
      const ref = await uploadMedia(file);
      const track: MusicTrack = {
        id: generateId(),
        title: titleFromFileName(file.name),
        artist: '',
        music: ref,
        musicName: file.name,
        addedAt: new Date().toISOString(),
      };
      onChange([track, ...tracks]);
      setStatus(`Added "${track.title}". Give it an artist so the DJ list reads properly.`);
    } catch {
      setStatus('Could not upload that audio file. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  function startEdit(track: MusicTrack) {
    setEditId(track.id);
    setEditTitle(track.title);
    setEditArtist(track.artist);
    setEditNotes(track.notes ?? '');
  }

  function saveEdit() {
    if (!editId || !editTitle.trim()) return;
    onChange(
      tracks.map((t) =>
        t.id === editId
          ? { ...t, title: editTitle.trim(), artist: editArtist.trim(), notes: editNotes.trim() || undefined }
          : t,
      ),
    );
    setEditId(null);
  }

  /**
   * Remove a track. The audio is only deleted when no show is still using it —
   * shows share this reference, so deleting it out from under them would kill
   * playback in a show that has nothing to do with this page.
   */
  async function removeTrack(track: MusicTrack) {
    const used = usageCount(track, shows);
    const warning = used
      ? `Remove "${track.title}" from the library?\n\n${used} show${used === 1 ? '' : 's'} already added it — ` +
        `${used === 1 ? 'that show keeps' : 'those shows keep'} the track and ${used === 1 ? 'its' : 'their'} audio still plays. ` +
        `You just won't be able to add it to new shows from here.`
      : `Remove "${track.title}" from the library? The audio is deleted and this cannot be undone.`;
    if (!(await confirm({ message: warning, confirmLabel: 'Remove' }))) return;

    if (canDeleteMedia(track, shows)) deleteMedia(track.music);
    onChange(tracks.filter((t) => t.id !== track.id));
    setStatus('');
  }

  return (
    <div className="music-page">
      <PageHeader
        title="Music"
        subtitle="Upload a track once and it's in every show's DJ list — this one and every one after it."
        onBack={onBack}
        backLabel="Shows"
        actions={
          <button className="btn btn--primary" onClick={addTracks} disabled={busy}>
            {busy ? 'Uploading…' : '+ Upload track'}
          </button>
        }
      />

      {status && (
        <p className="music-page__status" role="status" aria-live="polite">
          {status}
        </p>
      )}
      {preview.error && (
        <p className="music-page__status music-page__status--error" role="status">
          {preview.error}
        </p>
      )}

      {tracks.length === 0 ? (
        <div className="empty-state">
          <h2 className="empty-state__title">No tracks yet</h2>
          <p className="empty-state__text">
            Upload the songs you reach for every show — walk-on beds, intermission music, play-off
            stings. Every track here shows up in every show's DJ list automatically, and each one
            gets its own button on the Run Show soundboard.
          </p>
          <button className="btn btn--primary" onClick={addTracks} disabled={busy}>
            + Upload track
          </button>
        </div>
      ) : (
        <>
          {/* The box earns its place the way the show page's tiles do: a list
              you can take in at a glance is not a list you need to search. */}
          {tracks.length > SEARCH_LIST_FROM && (
            <div className="music-search">
              <input
                type="search"
                className="section-field__input music-search__input"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search tracks"
                aria-label="Search tracks by title, artist, notes, or file name"
              />
              {query.trim() && (
                <p className="music-search__count" role="status" aria-live="polite">
                  {shown.length} of {tracks.length}
                </p>
              )}
            </div>
          )}

          {shown.length === 0 ? (
            <div className="empty-state">
              <h2 className="empty-state__title">No track matches that</h2>
              <p className="empty-state__text">
                Nothing in the library matches “{query.trim()}”. Titles, artists, notes, and the
                uploaded file name are all searched.
              </p>
              <button className="btn btn--secondary" onClick={() => setQuery('')}>
                Clear search
              </button>
            </div>
          ) : (
        <ul className="music-list">
          {shown.map((track) => {
            const used = usageCount(track, shows);
            return (
              <li key={track.id} className="music-list__item">
                {editId === track.id ? (
                  <div className="music-list__edit">
                    <input
                      className="section-field__input"
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      placeholder="Track title"
                      aria-label="Track title"
                      autoFocus
                    />
                    <input
                      className="section-field__input"
                      value={editArtist}
                      onChange={(e) => setEditArtist(e.target.value)}
                      placeholder="Artist"
                      aria-label="Artist"
                    />
                    <input
                      className="section-field__input"
                      value={editNotes}
                      onChange={(e) => setEditNotes(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && saveEdit()}
                      placeholder="Notes (optional)"
                      aria-label="Notes"
                    />
                    <button className="btn btn--primary btn--sm" onClick={saveEdit}>Save</button>
                    <button className="btn btn--ghost btn--sm" onClick={() => setEditId(null)}>Cancel</button>
                  </div>
                ) : (
                  <>
                    <div className="music-list__lead">
                      <TrackPreviewButton src={track.music} title={track.title} preview={preview} />
                      <div className="music-list__body">
                        <span className="music-list__title">
                          {track.title}
                          {track.artist && <span className="music-list__artist"> — {track.artist}</span>}
                        </span>
                        <span className="music-list__meta">
                          {track.musicName && <span className="music-list__tag">♪ {track.musicName}</span>}
                          {track.notes && <span className="music-list__tag">{track.notes}</span>}
                          <span className={`music-list__tag${used ? ' music-list__tag--in-use' : ''}`}>
                            {used === 0 ? 'Not in any show' : `In ${used} show${used === 1 ? '' : 's'}`}
                          </span>
                        </span>
                      </div>
                    </div>
                    <div className="music-list__actions">
                      <button className="btn btn--ghost btn--sm" onClick={() => startEdit(track)}>Edit</button>
                      <button
                        className="btn btn--ghost btn--sm music-list__delete"
                        onClick={() => removeTrack(track)}
                        aria-label={`Remove ${track.title} from the library`}
                      >
                        ×
                      </button>
                    </div>
                    {/* Cut here and it is cut in every show — the library is
                        the one copy of the song. A show that wants a different
                        cut for one night trims it in that show's DJ list,
                        which copies the row first. */}
                    <TrimControls
                      src={track.music}
                      startSec={track.startSec}
                      endSec={track.endSec}
                      onChange={(trim) =>
                        onChange(tracks.map((t) => (t.id === track.id ? { ...t, ...trim } : t)))
                      }
                    />
                  </>
                )}
              </li>
            );
          })}
        </ul>
          )}
        </>
      )}
      {confirmDialog}
    </div>
  );
}

import { useState } from 'react';
import type { DJSong, Show } from '../../types';
import { generateId } from '../../utils/id';
import { audioUploadSizeError, pickFile } from '../../utils/media';
import { deleteMedia, uploadMedia } from '../../utils/mediaStore';
import { exportDJListToPDF } from '../../utils/pdfExport';

interface DJMusicSectionProps {
  songs: DJSong[];
  show: Show;
  onChange: (songs: DJSong[]) => void;
}

export function DJMusicSection({ songs, show, onChange }: DJMusicSectionProps) {
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
    onChange([...songs, song]);
    setTitle('');
    setArtist('');
    setNotes('');
  }

  function deleteSong(id: string) {
    const song = songs.find((s) => s.id === id);
    if (window.confirm(`Delete "${song?.title}"? This cannot be undone.`)) {
      if (song?.music) deleteMedia(song.music);
      onChange(songs.filter((s) => s.id !== id));
    }
  }

  function startEdit(s: DJSong) {
    setEditId(s.id);
    setEditTitle(s.title);
    setEditArtist(s.artist);
    setEditNotes(s.notes ?? '');
  }

  function saveEdit() {
    if (!editTitle.trim() || !editId) return;
    onChange(songs.map((s) =>
      s.id === editId
        ? { ...s, title: editTitle.trim(), artist: editArtist.trim(), notes: editNotes.trim() || undefined }
        : s
    ));
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
      const previous = song.music;
      onChange(songs.map((s) => (s.id === song.id ? { ...s, music: ref, musicName: file.name } : s)));
      if (previous) deleteMedia(previous);
      setStatus(song.id, null);
    } catch {
      setStatus(song.id, 'Could not upload that audio file. Check your connection and try again.');
    }
  }

  function removeAudio(song: DJSong) {
    if (!song.music) return;
    if (!window.confirm(`Remove the uploaded audio for "${song.title}"?`)) return;
    deleteMedia(song.music);
    onChange(songs.map((s) => (s.id === song.id ? { ...s, music: undefined, musicName: undefined } : s)));
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

      <p className="section-hint">
        Upload the audio for a song and it gets its own button on the Run Show soundboard, in a
        bank of its own next to the performers.
      </p>

      {songs.length === 0 && <p className="section-empty">No songs yet.</p>}

      <ul className="section-list">
        {songs.map((s, idx) => (
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
                  <span className="section-list-item__order">{idx + 1}</span>
                  <span className="section-list-item__name">"{s.title}" — {s.artist}</span>
                  {s.music && <span className="section-list-item__tag">♪ {s.musicName || 'Audio'}</span>}
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
          </li>
        ))}
      </ul>

      {songs.length > 0 && (
        <div className="section-actions">
          <button className="btn btn--secondary" onClick={exportDJList}>
            Share / Export DJ List (Text)
          </button>
          <button className="btn btn--secondary" onClick={() => exportDJListToPDF(show)}>
            Export DJ List (PDF)
          </button>
        </div>
      )}
    </div>
  );
}

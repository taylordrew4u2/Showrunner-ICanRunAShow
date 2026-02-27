import { useState } from 'react';
import type { DJSong, Show } from '../../types';
import { generateId } from '../../utils/id';
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
    a.download = `DJ-List-${show.name.replace(/\s+/g, '-')}.txt`;
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
                  {s.notes && <span className="section-list-item__tag">{s.notes}</span>}
                </>
              )}
            </div>
            {editId !== s.id && (
              <div className="section-list-item__actions">
                <button className="btn btn--ghost btn--sm" onClick={() => startEdit(s)}>✏️</button>
                <button className="btn btn--ghost btn--sm section-list-item__delete" onClick={() => deleteSong(s.id)}>✕</button>
              </div>
            )}
          </li>
        ))}
      </ul>

      {songs.length > 0 && (
        <div className="section-actions">
          <button className="btn btn--secondary" onClick={exportDJList}>
            📤 Share / Export DJ List (Text)
          </button>
          <button className="btn btn--secondary" onClick={() => exportDJListToPDF(show)}>
            🧾 Export DJ List (PDF)
          </button>
        </div>
      )}
    </div>
  );
}

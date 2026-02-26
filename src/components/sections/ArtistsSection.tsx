import { useState } from 'react';
import type { Artist } from '../../types';
import { generateId } from '../../utils/id';

interface ArtistsSectionProps {
  artists: Artist[];
  onChange: (artists: Artist[]) => void;
}

export function ArtistsSection({ artists, onChange }: ArtistsSectionProps) {
  const [name, setName] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  function addArtist() {
    if (!name.trim()) return;
    const a: Artist = { id: generateId(), name: name.trim() };
    onChange([...artists, a]);
    setName('');
  }

  function deleteArtist(id: string) {
    const artist = artists.find((a) => a.id === id);
    if (window.confirm(`Delete "${artist?.name}"? This cannot be undone.`)) {
      onChange(artists.filter((a) => a.id !== id));
    }
  }

  function startEdit(a: Artist) {
    setEditId(a.id);
    setEditName(a.name);
  }

  function saveEdit() {
    if (!editName.trim() || !editId) return;
    onChange(artists.map((a) => (a.id === editId ? { ...a, name: editName.trim() } : a)));
    setEditId(null);
  }

  function moveUp(idx: number) {
    if (idx === 0) return;
    const arr = [...artists];
    [arr[idx - 1], arr[idx]] = [arr[idx], arr[idx - 1]];
    onChange(arr);
  }

  function moveDown(idx: number) {
    if (idx >= artists.length - 1) return;
    const arr = [...artists];
    [arr[idx], arr[idx + 1]] = [arr[idx + 1], arr[idx]];
    onChange(arr);
  }

  function handlePhoto(id: string) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        onChange(artists.map((a) => (a.id === id ? { ...a, photo: reader.result as string } : a)));
      };
      reader.readAsDataURL(file);
    };
    input.click();
  }

  function handleMusic(id: string) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'audio/*';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        onChange(artists.map((a) =>
          a.id === id ? { ...a, walkOnMusic: reader.result as string, walkOnMusicName: file.name } : a
        ));
      };
      reader.readAsDataURL(file);
    };
    input.click();
  }

  function handleVideo(id: string) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'video/*';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        onChange(artists.map((a) => (a.id === id ? { ...a, video: reader.result as string } : a)));
      };
      reader.readAsDataURL(file);
    };
    input.click();
  }

  return (
    <div className="section-body">
      <div className="section-add-row">
        <input
          className="section-field__input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addArtist())}
          placeholder="Artist name"
        />
        <button className="btn btn--primary btn--sm" onClick={addArtist}>Add</button>
      </div>

      {artists.length === 0 && <p className="section-empty">No artists yet.</p>}

      <ul className="section-list">
        {artists.map((a, idx) => (
          <li key={a.id} className="section-list-item">
            {a.photo && <img src={a.photo} alt="" className="section-list-item__photo" />}
            <div className="section-list-item__body">
              {editId === a.id ? (
                <div className="section-edit-row">
                  <input
                    className="section-field__input"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && saveEdit()}
                    autoFocus
                  />
                  <button className="btn btn--primary btn--sm" onClick={saveEdit}>Save</button>
                  <button className="btn btn--ghost btn--sm" onClick={() => setEditId(null)}>Cancel</button>
                </div>
              ) : (
                <>
                  <span className="section-list-item__order">{idx + 1}</span>
                  <span className="section-list-item__name">{a.name}</span>
                  {a.walkOnMusicName && <span className="section-list-item__tag">🎵 {a.walkOnMusicName}</span>}
                </>
              )}
            </div>
            {editId !== a.id && (
              <div className="section-list-item__actions">
                <button className="btn btn--ghost btn--sm" onClick={() => handlePhoto(a.id)} title="Upload photo">📷</button>
                <button className="btn btn--ghost btn--sm" onClick={() => handleMusic(a.id)} title="Upload walk-on music">🎵</button>
                <button className="btn btn--ghost btn--sm" onClick={() => handleVideo(a.id)} title="Upload video">🎬</button>
                <button className="btn btn--ghost btn--sm" onClick={() => startEdit(a)} title="Edit">✏️</button>
                <button className="btn btn--ghost btn--sm" onClick={() => moveUp(idx)} title="Move up" disabled={idx === 0}>↑</button>
                <button className="btn btn--ghost btn--sm" onClick={() => moveDown(idx)} title="Move down" disabled={idx >= artists.length - 1}>↓</button>
                <button className="btn btn--ghost btn--sm section-list-item__delete" onClick={() => deleteArtist(a.id)} title="Delete">✕</button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

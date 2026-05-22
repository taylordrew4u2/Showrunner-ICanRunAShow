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
  const [editArtistType, setEditArtistType] = useState('');

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
    setEditArtistType(a.artistType || '');
  }

  function saveEdit() {
    if (!editName.trim() || !editId) return;
    // Preserve all existing fields including file-related data
    onChange(artists.map((a) => (a.id === editId ? { 
      ...a, 
      name: editName.trim(), 
      artistType: editArtistType.trim() || undefined,
      // Explicitly preserve file fields
      file: a.file,
      fileName: a.fileName,
      photo: a.photo,
      video: a.video,
      walkOnMusic: a.walkOnMusic,
      walkOnMusicName: a.walkOnMusicName
    } : a)));
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

  function handleFile(id: string) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '*/*';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        onChange(artists.map((a) =>
          a.id === id ? { ...a, file: reader.result as string, fileName: file.name } : a
        ));
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
                    placeholder="Name"
                    autoFocus
                  />
                  <input
                    className="section-field__input"
                    value={editArtistType}
                    onChange={(e) => setEditArtistType(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && saveEdit()}
                    placeholder="Artist type (e.g., Painter, Musician, Photographer)"
                  />
                  <button className="btn btn--primary btn--sm" onClick={saveEdit}>Save</button>
                  <button className="btn btn--ghost btn--sm" onClick={() => setEditId(null)}>Cancel</button>
                </div>
              ) : (
                <>
                  <span className="section-list-item__order">{idx + 1}</span>
                  <span className="section-list-item__name">
                    {a.name}
                    {a.artistType && <span className="section-list-item__subtext"> ({a.artistType})</span>}
                  </span>
                  {a.walkOnMusicName && <span className="section-list-item__tag">{a.walkOnMusicName}</span>}
                  {a.fileName && <span className="section-list-item__tag">{a.fileName}</span>}
                </>
              )}
            </div>
            {editId !== a.id && (
              <div className="section-list-item__actions">
                <button className="btn btn--ghost btn--sm" onClick={() => handlePhoto(a.id)} title="Upload photo">Photo</button>
                <button className="btn btn--ghost btn--sm" onClick={() => handleMusic(a.id)} title="Upload walk-on music">Music</button>
                <button className="btn btn--ghost btn--sm" onClick={() => handleVideo(a.id)} title="Upload video">Video</button>
                <button className="btn btn--ghost btn--sm" onClick={() => handleFile(a.id)} title="Upload file">File</button>
                <button className="btn btn--ghost btn--sm" onClick={() => startEdit(a)} title="Edit">Edit</button>
                <button className="btn btn--ghost btn--sm" onClick={() => moveUp(idx)} title="Move up" disabled={idx === 0}>↑</button>
                <button className="btn btn--ghost btn--sm" onClick={() => moveDown(idx)} title="Move down" disabled={idx >= artists.length - 1}>↓</button>
                <button className="btn btn--ghost btn--sm section-list-item__delete" onClick={() => deleteArtist(a.id)} title="Delete">×</button>
              </div>
            )}

            {/* Bento media grid for imported items */}
            {(a.photo || a.walkOnMusic || a.video || a.file) && (
              <div className="media-grid">
                {a.photo && (
                  <div className="media-grid__tile">
                    <img src={a.photo} alt={a.name} className="media-grid__preview" />
                    <span className="media-grid__label">Photo</span>
                    <button className="media-grid__remove" onClick={() => onChange(artists.map(aa => aa.id === a.id ? { ...aa, photo: undefined } : aa))} title="Remove photo">×</button>
                  </div>
                )}
                {a.walkOnMusic && (
                  <div className="media-grid__tile media-grid__tile--wide">
                    <div className="media-grid__audio">
                      <audio controls preload="none"><source src={a.walkOnMusic} /></audio>
                    </div>
                    <span className="media-grid__label">{a.walkOnMusicName || 'Walk-on Music'}</span>
                    <button className="media-grid__remove" onClick={() => onChange(artists.map(aa => aa.id === a.id ? { ...aa, walkOnMusic: undefined, walkOnMusicName: undefined } : aa))} title="Remove music">×</button>
                  </div>
                )}
                {a.video && (
                  <div className="media-grid__tile media-grid__tile--wide">
                    <video src={a.video} controls preload="none" className="media-grid__preview media-grid__preview--video" />
                    <span className="media-grid__label">Video</span>
                    <button className="media-grid__remove" onClick={() => onChange(artists.map(aa => aa.id === a.id ? { ...aa, video: undefined } : aa))} title="Remove video">×</button>
                  </div>
                )}
                {a.file && (
                  <div className="media-grid__tile">
                    {a.file.startsWith('data:image') ? (
                      <img src={a.file} alt={a.fileName || 'File'} className="media-grid__preview" />
                    ) : (
                      <div className="media-grid__file-icon">File</div>
                    )}
                    <span className="media-grid__label">{a.fileName || 'File'}</span>
                    <button className="media-grid__remove" onClick={() => onChange(artists.map(aa => aa.id === a.id ? { ...aa, file: undefined, fileName: undefined } : aa))} title="Remove file">×</button>
                  </div>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

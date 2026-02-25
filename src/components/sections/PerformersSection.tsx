import { useState } from 'react';
import type { Performer } from '../../types';
import { generateId } from '../../utils/id';

interface PerformersSectionProps {
  performers: Performer[];
  onChange: (performers: Performer[]) => void;
}

export function PerformersSection({ performers, onChange }: PerformersSectionProps) {
  const [name, setName] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  function addPerformer() {
    if (!name.trim()) return;
    const p: Performer = { id: generateId(), name: name.trim() };
    onChange([...performers, p]);
    setName('');
  }

  function deletePerformer(id: string) {
    onChange(performers.filter((p) => p.id !== id));
  }

  function startEdit(p: Performer) {
    setEditId(p.id);
    setEditName(p.name);
  }

  function saveEdit() {
    if (!editName.trim() || !editId) return;
    onChange(performers.map((p) => (p.id === editId ? { ...p, name: editName.trim() } : p)));
    setEditId(null);
  }

  function moveUp(idx: number) {
    if (idx === 0) return;
    const arr = [...performers];
    [arr[idx - 1], arr[idx]] = [arr[idx], arr[idx - 1]];
    onChange(arr);
  }

  function moveDown(idx: number) {
    if (idx >= performers.length - 1) return;
    const arr = [...performers];
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
        onChange(performers.map((p) => (p.id === id ? { ...p, photo: reader.result as string } : p)));
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
        onChange(performers.map((p) =>
          p.id === id ? { ...p, walkOnMusic: reader.result as string, walkOnMusicName: file.name } : p
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
        onChange(performers.map((p) => (p.id === id ? { ...p, video: reader.result as string } : p)));
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
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addPerformer())}
          placeholder="Performer name"
        />
        <button className="btn btn--primary btn--sm" onClick={addPerformer}>Add</button>
      </div>

      {performers.length === 0 && <p className="section-empty">No performers yet.</p>}

      <ul className="section-list">
        {performers.map((p, idx) => (
          <li key={p.id} className="section-list-item">
            {p.photo && <img src={p.photo} alt="" className="section-list-item__photo" />}
            <div className="section-list-item__body">
              {editId === p.id ? (
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
                  <span className="section-list-item__name">{p.name}</span>
                  {p.walkOnMusicName && <span className="section-list-item__tag">🎵 {p.walkOnMusicName}</span>}
                </>
              )}
            </div>
            {editId !== p.id && (
              <div className="section-list-item__actions">
                <button className="btn btn--ghost btn--sm" onClick={() => handlePhoto(p.id)} title="Upload photo">📷</button>
                <button className="btn btn--ghost btn--sm" onClick={() => handleMusic(p.id)} title="Upload walk-on music">🎵</button>
                <button className="btn btn--ghost btn--sm" onClick={() => handleVideo(p.id)} title="Upload video">🎬</button>
                <button className="btn btn--ghost btn--sm" onClick={() => startEdit(p)} title="Edit">✏️</button>
                <button className="btn btn--ghost btn--sm" onClick={() => moveUp(idx)} title="Move up" disabled={idx === 0}>↑</button>
                <button className="btn btn--ghost btn--sm" onClick={() => moveDown(idx)} title="Move down" disabled={idx >= performers.length - 1}>↓</button>
                <button className="btn btn--ghost btn--sm section-list-item__delete" onClick={() => deletePerformer(p.id)} title="Delete">✕</button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

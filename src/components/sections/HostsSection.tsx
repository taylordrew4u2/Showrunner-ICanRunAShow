import { useState } from 'react';
import type { Host } from '../../types';
import { generateId } from '../../utils/id';

interface HostsSectionProps {
  hosts: Host[];
  onChange: (hosts: Host[]) => void;
}

export function HostsSection({ hosts, onChange }: HostsSectionProps) {
  const [name, setName] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editNotes, setEditNotes] = useState('');

  function addHost() {
    if (!name.trim()) return;
    const h: Host = { id: generateId(), name: name.trim(), isHosting: hosts.length === 0, notes: '' };
    onChange([...hosts, h]);
    setName('');
  }

  function deleteHost(id: string) {
    onChange(hosts.filter((h) => h.id !== id));
  }

  function toggleHosting(id: string) {
    onChange(hosts.map((h) => ({ ...h, isHosting: h.id === id })));
  }

  function startEdit(h: Host) {
    setEditId(h.id);
    setEditName(h.name);
    setEditNotes(h.notes ?? '');
  }

  function saveEdit() {
    if (!editName.trim() || !editId) return;
    onChange(hosts.map((h) =>
      h.id === editId ? { ...h, name: editName.trim(), notes: editNotes.trim() } : h
    ));
    setEditId(null);
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
        onChange(hosts.map((h) => (h.id === id ? { ...h, photo: reader.result as string } : h)));
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
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addHost())}
          placeholder="Host name"
        />
        <button className="btn btn--primary btn--sm" onClick={addHost}>Add</button>
      </div>

      {hosts.length === 0 && <p className="section-empty">No hosts yet.</p>}

      <ul className="section-list">
        {hosts.map((h) => (
          <li key={h.id} className="section-list-item">
            {h.photo && <img src={h.photo} alt="" className="section-list-item__photo" />}
            <div className="section-list-item__body">
              {editId === h.id ? (
                <div className="section-edit-row">
                  <input
                    className="section-field__input"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    autoFocus
                  />
                  <input
                    className="section-field__input"
                    value={editNotes}
                    onChange={(e) => setEditNotes(e.target.value)}
                    placeholder="Notes (optional)"
                  />
                  <button className="btn btn--primary btn--sm" onClick={saveEdit}>Save</button>
                  <button className="btn btn--ghost btn--sm" onClick={() => setEditId(null)}>Cancel</button>
                </div>
              ) : (
                <>
                  <span className="section-list-item__name">{h.name}</span>
                  {h.isHosting && <span className="section-list-item__badge">Hosting</span>}
                  {h.notes && <span className="section-list-item__tag">{h.notes}</span>}
                </>
              )}
            </div>
            {editId !== h.id && (
              <div className="section-list-item__actions">
                <button
                  className={`btn btn--sm ${h.isHosting ? 'btn--primary' : 'btn--secondary'}`}
                  onClick={() => toggleHosting(h.id)}
                  title="Set as host"
                >
                  🎤
                </button>
                <button className="btn btn--ghost btn--sm" onClick={() => handlePhoto(h.id)} title="Upload photo">📷</button>
                <button className="btn btn--ghost btn--sm" onClick={() => startEdit(h)}>✏️</button>
                <button className="btn btn--ghost btn--sm section-list-item__delete" onClick={() => deleteHost(h.id)}>✕</button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

import { useState } from 'react';
import type { Vendor } from '../../types';
import { VENDOR_CATEGORIES } from '../../types';
import { generateId } from '../../utils/id';
import { compressImage, pickFile } from '../../utils/media';

interface VendorsSectionProps {
  vendors: Vendor[];
  onChange: (vendors: Vendor[]) => void;
}

function normalizeUrl(url: string): string {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

export function VendorsSection({ vendors, onChange }: VendorsSectionProps) {
  const [name, setName] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Vendor | null>(null);

  function startEdit(v: Vendor) {
    setEditId(v.id);
    setDraft({ ...v });
  }

  function addVendor() {
    const trimmed = name.trim();
    if (!trimmed) return;
    const v: Vendor = { id: generateId(), name: trimmed, category: VENDOR_CATEGORIES[0], booked: false };
    onChange([...vendors, v]);
    setName('');
    startEdit(v); // open the profile straight away so it can be filled out
  }

  function deleteVendor(id: string) {
    const v = vendors.find((x) => x.id === id);
    if (window.confirm(`Delete vendor "${v?.name}"? This cannot be undone.`)) {
      onChange(vendors.filter((x) => x.id !== id));
      if (editId === id) cancelEdit();
    }
  }

  function patchDraft(patch: Partial<Vendor>) {
    setDraft((d) => (d ? { ...d, ...patch } : d));
  }

  function saveEdit() {
    if (!draft || !draft.name.trim()) return;
    onChange(vendors.map((v) => (v.id === draft.id ? { ...draft, name: draft.name.trim() } : v)));
    cancelEdit();
  }

  function cancelEdit() {
    setEditId(null);
    setDraft(null);
  }

  function toggleBooked(id: string) {
    onChange(vendors.map((v) => (v.id === id ? { ...v, booked: !v.booked } : v)));
  }

  async function handlePhoto(id: string) {
    const file = await pickFile('image/*');
    if (!file) return;
    try {
      const data = await compressImage(file);
      onChange(vendors.map((v) => (v.id === id ? { ...v, photo: data } : v)));
    } catch {
      alert("Couldn't read that image. Try a different file.");
    }
  }

  return (
    <div className="section-body">
      <div className="section-add-row">
        <input
          className="section-field__input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addVendor())}
          placeholder="Vendor / business name"
        />
        <button className="btn btn--primary btn--sm" onClick={addVendor}>Add</button>
      </div>

      {vendors.length === 0 && (
        <p className="section-empty">No vendors yet. Add a caterer, sound, lighting, rentals…</p>
      )}

      <ul className="section-list">
        {vendors.map((v) => {
          const summary = [v.contactName, v.phone, v.email].filter(Boolean).join(' · ');
          const hasCost = typeof v.cost === 'number' && !Number.isNaN(v.cost);
          return (
            <li key={v.id} className="section-list-item vendor-card">
              {editId === v.id && draft ? (
                <div className="vendor-form">
                  <div className="vendor-form__field">
                    <label className="section-field__label">Vendor name</label>
                    <input
                      className="section-field__input"
                      value={draft.name}
                      onChange={(e) => patchDraft({ name: e.target.value })}
                      autoFocus
                    />
                  </div>
                  <div className="vendor-form__field">
                    <label className="section-field__label">Category</label>
                    <select
                      className="section-field__select"
                      value={draft.category ?? ''}
                      onChange={(e) => patchDraft({ category: e.target.value })}
                    >
                      {VENDOR_CATEGORIES.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </div>
                  <div className="vendor-form__field">
                    <label className="section-field__label">Contact name</label>
                    <input
                      className="section-field__input"
                      value={draft.contactName ?? ''}
                      onChange={(e) => patchDraft({ contactName: e.target.value })}
                      placeholder="Point of contact"
                    />
                  </div>
                  <div className="vendor-form__field">
                    <label className="section-field__label">Phone</label>
                    <input
                      className="section-field__input"
                      type="tel"
                      value={draft.phone ?? ''}
                      onChange={(e) => patchDraft({ phone: e.target.value })}
                      placeholder="(555) 555-5555"
                    />
                  </div>
                  <div className="vendor-form__field">
                    <label className="section-field__label">Email</label>
                    <input
                      className="section-field__input"
                      type="email"
                      value={draft.email ?? ''}
                      onChange={(e) => patchDraft({ email: e.target.value })}
                      placeholder="name@example.com"
                    />
                  </div>
                  <div className="vendor-form__field">
                    <label className="section-field__label">Website</label>
                    <input
                      className="section-field__input"
                      value={draft.website ?? ''}
                      onChange={(e) => patchDraft({ website: e.target.value })}
                      placeholder="https://…"
                    />
                  </div>
                  <div className="vendor-form__field">
                    <label className="section-field__label">Cost ($)</label>
                    <input
                      className="section-field__input"
                      type="number"
                      min="0"
                      step="0.01"
                      value={draft.cost ?? ''}
                      onChange={(e) =>
                        patchDraft({ cost: e.target.value === '' ? undefined : parseFloat(e.target.value) })
                      }
                      placeholder="0.00"
                    />
                  </div>
                  <div className="vendor-form__field vendor-form__field--checkbox">
                    <label className="vendor-checkbox">
                      <input
                        type="checkbox"
                        checked={!!draft.booked}
                        onChange={(e) => patchDraft({ booked: e.target.checked })}
                      />
                      Booked / confirmed
                    </label>
                  </div>
                  <div className="vendor-form__field vendor-form__field--full">
                    <label className="section-field__label">Notes</label>
                    <textarea
                      className="section-field__input vendor-form__textarea"
                      rows={3}
                      value={draft.notes ?? ''}
                      onChange={(e) => patchDraft({ notes: e.target.value })}
                      placeholder="Deposit, deliverables, arrival time…"
                    />
                  </div>
                  <div className="vendor-form__actions">
                    <button className="btn btn--primary btn--sm" onClick={saveEdit}>Save profile</button>
                    <button className="btn btn--ghost btn--sm" onClick={cancelEdit}>Cancel</button>
                  </div>
                </div>
              ) : (
                <>
                  {v.photo ? (
                    <img src={v.photo} alt="" className="section-list-item__photo" />
                  ) : (
                    <div className="vendor-card__avatar" aria-hidden="true">
                      {v.name.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div className="section-list-item__body">
                    <div className="vendor-card__heading">
                      <span className="section-list-item__name">{v.name}</span>
                      {v.category && <span className="section-list-item__badge">{v.category}</span>}
                      {v.booked && (
                        <span className="section-list-item__badge vendor-card__booked">Booked</span>
                      )}
                      {hasCost && <span className="section-list-item__tag">${v.cost!.toFixed(2)}</span>}
                    </div>
                    {summary && <div className="vendor-card__meta">{summary}</div>}
                    {v.website && (
                      <a
                        className="vendor-card__link"
                        href={normalizeUrl(v.website)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {v.website}
                      </a>
                    )}
                    {v.notes && <div className="vendor-card__notes">{v.notes}</div>}
                  </div>
                  <div className="section-list-item__actions">
                    <button
                      className={`btn btn--sm ${v.booked ? 'btn--primary' : 'btn--secondary'}`}
                      onClick={() => toggleBooked(v.id)}
                      title="Toggle booked"
                    >
                      {v.booked ? 'Booked' : 'Book'}
                    </button>
                    <button className="btn btn--ghost btn--sm" onClick={() => handlePhoto(v.id)} title="Upload logo/photo">
                      Photo
                    </button>
                    <button className="btn btn--ghost btn--sm" onClick={() => startEdit(v)}>Edit</button>
                    <button
                      className="btn btn--ghost btn--sm section-list-item__delete"
                      onClick={() => deleteVendor(v.id)}
                    >
                      ×
                    </button>
                  </div>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

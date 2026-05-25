import { useState } from 'react';
import type { Artist } from '../../types';
import { generateId } from '../../utils/id';
import { ArtistProfile } from './ArtistProfile';

interface ArtistsSectionProps {
  artists: Artist[];
  onChange: (artists: Artist[]) => void;
}

export function ArtistsSection({ artists, onChange }: ArtistsSectionProps) {
  const [name, setName] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selectedArtist = artists.find((a) => a.id === selectedId) ?? null;

  function addArtist() {
    if (!name.trim()) return;
    const a: Artist = { id: generateId(), name: name.trim() };
    onChange([...artists, a]);
    setName('');
  }

  function updateArtist(updated: Artist) {
    onChange(artists.map((a) => (a.id === updated.id ? updated : a)));
  }

  function deleteArtist(id: string) {
    onChange(artists.filter((a) => a.id !== id));
    setSelectedId(null);
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
          <li
            key={a.id}
            className={`section-list-item ${a.lockedIn ? 'section-list-item--locked' : ''} ${selectedId === a.id ? 'section-list-item--active' : ''}`}
          >
            {a.photo && <img src={a.photo} alt="" className="section-list-item__photo" />}
            <div className="section-list-item__content">
              <div className="section-list-item__body">
                <span className="section-list-item__order">{idx + 1}</span>
                {a.lockedIn && <span className="section-list-item__lock-badge">Locked</span>}
                <span className="section-list-item__name">
                  {a.name}
                  {a.artistType && <span className="section-list-item__subtext"> ({a.artistType})</span>}
                </span>
                {a.socialMedia && <span className="section-list-item__tag">{a.socialMedia}</span>}
                {a.walkOnMusicName && <span className="section-list-item__tag">{a.walkOnMusicName}</span>}
                {(a.video || a.videoLink) && <span className="section-list-item__tag">Video</span>}
                {a.fileName && <span className="section-list-item__tag">{a.fileName}</span>}
              </div>
              <div className="section-list-item__buttons">
                <button className="btn btn--ghost btn--sm" onClick={() => moveUp(idx)} title="Move up" disabled={idx === 0}>↑</button>
                <button className="btn btn--ghost btn--sm" onClick={() => moveDown(idx)} title="Move down" disabled={idx >= artists.length - 1}>↓</button>
                <button className="btn btn--secondary btn--sm" onClick={() => setSelectedId(a.id)}>
                  View Profile →
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>

      {selectedArtist && (
        <>
          <div className="perf-drawer__backdrop" onClick={() => setSelectedId(null)} />
          <div className="perf-drawer">
            <ArtistProfile
              artist={selectedArtist}
              onBack={() => setSelectedId(null)}
              onChange={updateArtist}
              onDelete={deleteArtist}
            />
          </div>
        </>
      )}
    </div>
  );
}

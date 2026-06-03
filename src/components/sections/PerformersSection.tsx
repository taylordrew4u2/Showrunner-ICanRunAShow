import { useState } from 'react';
import type { Performer, PotentialComic } from '../../types';
import { generateId } from '../../utils/id';
import { PerformerProfile } from './PerformerProfile';

interface PerformersSectionProps {
  performers: Performer[];
  potentialComics?: PotentialComic[];
  onSaveToRolodex?: (comic: PotentialComic) => void;
  onChange: (performers: Performer[]) => void;
}

export function PerformersSection({ performers, potentialComics = [], onSaveToRolodex, onChange }: PerformersSectionProps) {
  const [name, setName] = useState('');
  const [instagram, setInstagram] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showRolodex, setShowRolodex] = useState(false);

  const selectedPerformer = performers.find(p => p.id === selectedId) ?? null;

  function addPerformer() {
    if (!name.trim()) return;
    const p: Performer = { id: generateId(), name: name.trim(), socialMedia: instagram.trim() || undefined };
    onChange([...performers, p]);
    setName('');
    setInstagram('');
  }

  function addFromRolodex(comic: PotentialComic) {
    const p: Performer = {
      id: generateId(),
      name: comic.name,
      socialMedia: comic.socialMedia,
      credits: comic.credits,
      photo: comic.photo,
      photos: comic.photos,
      walkOnMusic: comic.walkOnMusic,
      walkOnMusicName: comic.walkOnMusicName,
      walkOnMusicArtist: comic.walkOnMusicArtist,
      walkOnMusicTimestamp: comic.walkOnMusicTimestamp,
      walkOnMusicLink: comic.walkOnMusicLink,
    };
    onChange([...performers, p]);
    setShowRolodex(false);
  }

  function updatePerformer(updated: Performer) {
    onChange(performers.map(p => p.id === updated.id ? updated : p));
    // keep selectedId so profile stays open with fresh data
  }

  function deletePerformer(id: string) {
    onChange(performers.filter(p => p.id !== id));
    setSelectedId(null);
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
        <input
          className="section-field__input"
          value={instagram}
          onChange={(e) => setInstagram(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addPerformer())}
          placeholder="@instagram"
        />
        <button className="btn btn--primary btn--sm" onClick={addPerformer}>Add</button>
        {potentialComics.length > 0 && (
          <button
            className="btn btn--secondary btn--sm"
            onClick={() => setShowRolodex(v => !v)}
          >
            From Rolodex
          </button>
        )}
      </div>

      {showRolodex && (
        <div className="section-rolodex-picker">
          <p className="section-rolodex-picker__label">Pick from Rolodex</p>
          {potentialComics.map(comic => (
            <button
              key={comic.id}
              className="section-rolodex-picker__item"
              onClick={() => addFromRolodex(comic)}
            >
              {comic.photo && <img src={comic.photo} alt="" className="section-rolodex-picker__photo" />}
              <span className="section-rolodex-picker__name">{comic.name}</span>
              {comic.socialMedia && <span className="section-list-item__tag">{comic.socialMedia}</span>}
              {comic.walkOnMusicName && <span className="section-list-item__tag">{comic.walkOnMusicName}</span>}
            </button>
          ))}
        </div>
      )}


      {performers.length === 0 && <p className="section-empty">No performers yet.</p>}

      <ul className="section-list">
        {performers.map((p, idx) => (
          <li key={p.id} className={`section-list-item ${p.lockedIn ? 'section-list-item--locked' : ''} ${selectedId === p.id ? 'section-list-item--active' : ''}`}>
            {p.photo && <img src={p.photo} alt="" className="section-list-item__photo" />}
            <div className="section-list-item__content">
              <div className="section-list-item__body">
                <span className="section-list-item__order">{idx + 1}</span>
                {p.lockedIn && <span className="section-list-item__lock-badge">Locked</span>}
                <span className="section-list-item__name">{p.name}</span>
                {p.socialMedia && <span className="section-list-item__tag">{p.socialMedia}</span>}
                {(p.walkOnMusicName || p.walkOnMusicArtist) && (
                  <span className="section-list-item__tag">
                    {[p.walkOnMusicName, p.walkOnMusicArtist].filter(Boolean).join(' — ')}{p.walkOnMusicTimestamp ? ` @ ${p.walkOnMusicTimestamp}` : ''}
                  </span>
                )}
                {p.credits && <span className="section-list-item__tag">{p.credits}</span>}
              </div>
              <div className="section-list-item__buttons">
                <button
                  className="btn btn--secondary btn--sm"
                  onClick={() => setSelectedId(p.id)}
                >
                  View Profile →
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>

      {selectedPerformer && (
        <>
          <div className="perf-drawer__backdrop" onClick={() => setSelectedId(null)} />
          <div className="perf-drawer">
            <PerformerProfile
              performer={selectedPerformer}
              onBack={() => setSelectedId(null)}
              onChange={updatePerformer}
              onDelete={deletePerformer}
              onSaveToRolodex={onSaveToRolodex}
            />
          </div>
        </>
      )}
    </div>
  );
}

import { useState } from 'react';
import type { Performer } from '../../types';
import { generateId } from '../../utils/id';
import { PerformerProfile } from './PerformerProfile';

interface PerformersSectionProps {
  performers: Performer[];
  onChange: (performers: Performer[]) => void;
}

export function PerformersSection({ performers, onChange }: PerformersSectionProps) {
  const [name, setName] = useState('');
  const [instagram, setInstagram] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selectedPerformer = performers.find(p => p.id === selectedId) ?? null;

  function addPerformer() {
    if (!name.trim()) return;
    const p: Performer = { id: generateId(), name: name.trim(), socialMedia: instagram.trim() || undefined };
    onChange([...performers, p]);
    setName('');
    setInstagram('');
  }

  function updatePerformer(updated: Performer) {
    onChange(performers.map(p => p.id === updated.id ? updated : p));
    // keep selectedId so profile stays open with fresh data
  }

  function deletePerformer(id: string) {
    onChange(performers.filter(p => p.id !== id));
    setSelectedId(null);
  }

  // Show profile page when a performer is selected
  if (selectedPerformer) {
    return (
      <PerformerProfile
        performer={selectedPerformer}
        onBack={() => setSelectedId(null)}
        onChange={updatePerformer}
        onDelete={deletePerformer}
      />
    );
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
      </div>

      {performers.length === 0 && <p className="section-empty">No performers yet.</p>}

      <ul className="section-list">
        {performers.map((p, idx) => (
          <li key={p.id} className={`section-list-item ${p.lockedIn ? 'section-list-item--locked' : ''}`}>
            {p.photo && <img src={p.photo} alt="" className="section-list-item__photo" />}
            <div className="section-list-item__content">
              <div className="section-list-item__body">
                <span className="section-list-item__order">{idx + 1}</span>
                {p.lockedIn && <span className="section-list-item__lock-badge">🔒</span>}
                <span className="section-list-item__name">{p.name}</span>
                {p.socialMedia && <span className="section-list-item__tag">📱 {p.socialMedia}</span>}
                {p.walkOnMusicName && (
                  <span className="section-list-item__tag">
                    🎵 {p.walkOnMusicName}{p.walkOnMusicTimestamp ? ` @ ${p.walkOnMusicTimestamp}` : ''}
                  </span>
                )}
                {p.credits && <span className="section-list-item__tag">📝 {p.credits}</span>}
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
    </div>
  );
}

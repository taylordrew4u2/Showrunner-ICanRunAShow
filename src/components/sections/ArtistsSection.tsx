import { useState } from 'react';
import type { Artist, PotentialComic } from '../../types';
import { generateId } from '../../utils/id';
import { ArtistProfile } from './ArtistProfile';

interface ArtistsSectionProps {
  artists: Artist[];
  /** Everyone on file, so an act already worked with can be booked by name. */
  potentialComics?: PotentialComic[];
  onChange: (artists: Artist[]) => void;
}

export function ArtistsSection({ artists, potentialComics = [], onChange }: ArtistsSectionProps) {
  const [name, setName] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showRolodex, setShowRolodex] = useState(false);

  const selectedArtist = artists.find((a) => a.id === selectedId) ?? null;

  function addArtist() {
    if (!name.trim()) return;
    const a: Artist = { id: generateId(), name: name.trim() };
    onChange([...artists, a]);
    setName('');
  }

  /**
   * Book someone already on file.
   *
   * Performers have had this since the Rolodex existed; artists never did, so
   * the only way to put a act you've worked with on an artist bill was to type
   * their name again and lose everything filed against it. The fields an
   * Artist and a Rolodex entry share come across; the rest of the profile is
   * filled in on the artist itself.
   */
  function addFromRolodex(comic: PotentialComic) {
    const a: Artist = {
      id: generateId(),
      name: comic.name,
      socialMedia: comic.socialMedia,
      credits: comic.credits,
      walkOnMusic: comic.walkOnMusic,
      walkOnMusicName: comic.walkOnMusicName,
    };
    onChange([...artists, a]);
    setShowRolodex(false);
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
        {potentialComics.length > 0 && (
          <button
            className="btn btn--secondary btn--sm"
            onClick={() => setShowRolodex((v) => !v)}
            aria-expanded={showRolodex}
          >
            From Rolodex
          </button>
        )}
      </div>

      {showRolodex && (
        <div className="section-rolodex-picker">
          <p className="section-rolodex-picker__label">Pick from Rolodex</p>
          {potentialComics.map((comic) => (
            <button
              key={comic.id}
              className="section-rolodex-picker__item"
              onClick={() => addFromRolodex(comic)}
            >
              <span className="section-rolodex-picker__name">{comic.name}</span>
              {comic.socialMedia && (
                <span className="section-list-item__tag">{comic.socialMedia}</span>
              )}
              {comic.walkOnMusicName && (
                <span className="section-list-item__tag">{comic.walkOnMusicName}</span>
              )}
            </button>
          ))}
        </div>
      )}

      {artists.length === 0 && <p className="section-empty">No artists yet.</p>}

      <ul className="section-list">
        {artists.map((a, idx) => (
          <li
            key={a.id}
            className={`section-list-item ${selectedId === a.id ? 'section-list-item--active' : ''}`}
          >
            <div className="section-list-item__content">
              <div className="section-list-item__body">
                <span className="section-list-item__order">{idx + 1}</span>
                <span className="section-list-item__name">
                  {a.name}
                  {a.artistType && <span className="section-list-item__subtext"> ({a.artistType})</span>}
                </span>
                {a.socialMedia && <span className="section-list-item__tag">{a.socialMedia}</span>}
                {a.walkOnMusicName && <span className="section-list-item__tag">{a.walkOnMusicName}</span>}
                {a.videoLink && <span className="section-list-item__tag">Video</span>}
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

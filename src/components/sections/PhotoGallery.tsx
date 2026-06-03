import { useState } from 'react';
import { compressImage, pickFiles } from '../../utils/media';

interface PhotoGalleryProps {
  /** All photos; the first is treated as the cover. */
  photos: string[];
  /** Display name — used for the placeholder initial and image alt text. */
  name: string;
  /** Called with the new ordered photo list whenever it changes. */
  onChange: (next: string[]) => void;
  /** When true, the gallery is read-only (no add/remove/reorder). */
  locked?: boolean;
}

/**
 * Reusable photo gallery: a large cover drop-zone plus a thumbnail grid with
 * per-photo remove and "make cover" controls. Uploads are compressed and
 * multiple files can be added at once (drag-and-drop or file picker). Used by
 * both the performer profile and the Rolodex entry editor.
 */
export function PhotoGallery({ photos, name, onChange, locked = false }: PhotoGalleryProps) {
  const [photoDrag, setPhotoDrag] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function addPhotoFiles(files: File[]) {
    const images = files.filter(f => f.type.startsWith('image/'));
    if (!images.length) return;
    setError(null);
    // Process independently so one unreadable image doesn't drop the rest.
    Promise.allSettled(images.map(f => compressImage(f))).then(results => {
      const ok = results
        .filter((r): r is PromiseFulfilledResult<string> => r.status === 'fulfilled')
        .map(r => r.value);
      if (ok.length) onChange([...photos, ...ok]);
      if (ok.length < images.length) {
        setError(ok.length
          ? 'Some photos couldn’t be read and were skipped.'
          : 'Could not read that file. Please try again.');
      }
    });
  }

  function pickPhotos() {
    pickFiles('image/*').then(addPhotoFiles);
  }

  function handlePhotoDrop(e: React.DragEvent) {
    e.preventDefault();
    setPhotoDrag(false);
    addPhotoFiles(Array.from(e.dataTransfer.files || []));
  }

  function removePhotoAt(index: number) {
    onChange(photos.filter((_, i) => i !== index));
  }

  function makeCover(index: number) {
    if (index === 0) return;
    onChange([photos[index], ...photos.filter((_, i) => i !== index)]);
  }

  return (
    <div className="perf-profile__photo-panel">
      <div
        className={`perf-profile__photo-drop${photoDrag ? ' perf-profile__photo-drop--active' : ''}${locked ? ' perf-profile__photo-drop--locked' : ''}`}
        onDragOver={e => e.preventDefault()}
        onDragEnter={() => !locked && setPhotoDrag(true)}
        onDragLeave={() => setPhotoDrag(false)}
        onDrop={e => !locked && handlePhotoDrop(e)}
        onClick={() => !locked && pickPhotos()}
      >
        <div className="perf-profile__avatar-wrap">
          {photos[0] ? (
            <img src={photos[0]} alt={name} className="perf-profile__avatar" />
          ) : (
            <div className="perf-profile__avatar-placeholder">
              {name.charAt(0).toUpperCase()}
            </div>
          )}
        </div>
        {!locked && (
          <p className="perf-profile__photo-hint">
            {photoDrag ? 'Drop photos' : photos.length ? 'Click or drag to add more' : 'Click or drag to upload'}
          </p>
        )}
      </div>
      <p className="perf-profile__photo-name">{name}</p>
      {error && <p className="perf-profile__media-error">{error}</p>}

      {photos.length > 0 && (
        <div className="perf-profile__photo-gallery">
          {photos.map((src, i) => (
            <div key={i} className="perf-profile__photo-thumb">
              <img src={src} alt={`${name} ${i + 1}`} className="perf-profile__photo-thumb-img" />
              {i === 0 && photos.length > 1 && (
                <span className="perf-profile__photo-cover-badge">Cover</span>
              )}
              {!locked && (
                <div className="perf-profile__photo-thumb-actions">
                  {i !== 0 && (
                    <button
                      type="button"
                      className="perf-profile__photo-thumb-btn"
                      title="Make cover photo"
                      aria-label={`Make photo ${i + 1} the cover`}
                      onClick={e => { e.stopPropagation(); makeCover(i); }}
                    >
                      ★
                    </button>
                  )}
                  <button
                    type="button"
                    className="perf-profile__photo-thumb-btn perf-profile__photo-thumb-btn--remove"
                    title="Remove photo"
                    aria-label={`Remove photo ${i + 1}`}
                    onClick={e => { e.stopPropagation(); removePhotoAt(i); }}
                  >
                    ×
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

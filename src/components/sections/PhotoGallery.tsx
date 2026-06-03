import { useEffect, useState } from 'react';
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
  // Index of the photo shown full-size in the lightbox, or null when closed.
  const [lightbox, setLightbox] = useState<number | null>(null);

  // Arrow-key navigation / Escape-to-close while the lightbox is open.
  useEffect(() => {
    if (lightbox === null) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setLightbox(null);
      else if (e.key === 'ArrowLeft') setLightbox(i => (i === null ? i : (i - 1 + photos.length) % photos.length));
      else if (e.key === 'ArrowRight') setLightbox(i => (i === null ? i : (i + 1) % photos.length));
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightbox, photos.length]);

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
              <img
                src={src}
                alt={`${name} ${i + 1}`}
                className="perf-profile__photo-thumb-img"
                onClick={() => setLightbox(i)}
              />
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

      {lightbox !== null && photos[lightbox] && (
        <div
          className="photo-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label="Photo viewer"
          onClick={() => setLightbox(null)}
        >
          <button
            type="button"
            className="photo-lightbox__close"
            aria-label="Close photo viewer"
            onClick={() => setLightbox(null)}
          >
            ×
          </button>
          {photos.length > 1 && (
            <button
              type="button"
              className="photo-lightbox__nav photo-lightbox__nav--prev"
              aria-label="Previous photo"
              onClick={e => { e.stopPropagation(); setLightbox((lightbox - 1 + photos.length) % photos.length); }}
            >
              ‹
            </button>
          )}
          <img
            src={photos[lightbox]}
            alt={`${name} ${lightbox + 1}`}
            className="photo-lightbox__img"
            onClick={e => e.stopPropagation()}
          />
          {photos.length > 1 && (
            <button
              type="button"
              className="photo-lightbox__nav photo-lightbox__nav--next"
              aria-label="Next photo"
              onClick={e => { e.stopPropagation(); setLightbox((lightbox + 1) % photos.length); }}
            >
              ›
            </button>
          )}
          {photos.length > 1 && (
            <span className="photo-lightbox__counter">{lightbox + 1} / {photos.length}</span>
          )}
        </div>
      )}
    </div>
  );
}

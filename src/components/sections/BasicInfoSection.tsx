import type { Show } from '../../types';
import { compressImage, pickFile } from '../../utils/media';

interface BasicInfoSectionProps {
  show: Show;
  onChange: (updates: Partial<Show>) => void;
}

export function BasicInfoSection({ show, onChange }: BasicInfoSectionProps) {
  async function handleFlyerUpload() {
    const file = await pickFile('image/*');
    if (!file) return;
    try {
      const data = await compressImage(file, { maxDim: 2000, quality: 0.88 });
      onChange({ flyer: data });
    } catch {
      alert("Couldn't read that image. Try a different file.");
    }
  }

  function removeFlyerUpload() {
    if (window.confirm('Remove the show flyer?')) {
      onChange({ flyer: undefined });
    }
  }

  return (
    <div className="section-body">
      <label className="section-field">
        <span className="section-field__label">Show Flyer</span>
        {show.flyer ? (
          <div className="section-field__flyer-preview">
            <img src={show.flyer} alt="Show flyer" className="section-field__flyer-image" />
            <div className="section-field__flyer-actions">
              <button className="btn btn--primary btn--sm" onClick={handleFlyerUpload}>
                Change Flyer
              </button>
              <button className="btn btn--ghost btn--sm section-list-item__delete" onClick={removeFlyerUpload}>
                Remove
              </button>
            </div>
          </div>
        ) : (
          <button className="btn btn--secondary" onClick={handleFlyerUpload}>
            Upload Show Flyer
          </button>
        )}
      </label>
      <label className="section-field">
        <span className="section-field__label">Show Time</span>
        <input
          className="section-field__input"
          value={show.time}
          onChange={(e) => onChange({ time: e.target.value })}
          placeholder="e.g. 8:00 PM"
        />
      </label>
      <label className="section-field">
        <span className="section-field__label">Location</span>
        <input
          className="section-field__input"
          value={show.location}
          onChange={(e) => onChange({ location: e.target.value })}
          placeholder="Address or city"
        />
      </label>
      <label className="section-field">
        <span className="section-field__label">Venue Name</span>
        <input
          className="section-field__input"
          value={show.venueName}
          onChange={(e) => onChange({ venueName: e.target.value })}
          placeholder="Venue name"
        />
      </label>
      <label className="section-field">
        <span className="section-field__label">Ticket Link</span>
        <input
          className="section-field__input"
          value={show.ticketLink || ''}
          onChange={(e) => onChange({ ticketLink: e.target.value })}
          placeholder="https://..."
          type="url"
        />
        {show.ticketLink && (
          <a
            href={show.ticketLink}
            target="_blank"
            rel="noopener noreferrer"
            className="section-field__link"
          >
            🔗 Open ticket page
          </a>
        )}
      </label>
    </div>
  );
}

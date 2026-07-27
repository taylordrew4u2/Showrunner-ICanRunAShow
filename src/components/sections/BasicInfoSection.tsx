import type { Show } from '../../types';

interface BasicInfoSectionProps {
  show: Show;
  onChange: (updates: Partial<Show>) => void;
}

export function BasicInfoSection({ show, onChange }: BasicInfoSectionProps) {
  return (
    <div className="section-body">
      {/* Shows get moved. The date was previously only settable when the show
          was created, leaving no way to reschedule one. */}
      <label className="section-field">
        <span className="section-field__label">Date</span>
        <input
          className="section-field__input"
          type="date"
          value={show.date}
          onChange={(e) => onChange({ date: e.target.value })}
        />
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

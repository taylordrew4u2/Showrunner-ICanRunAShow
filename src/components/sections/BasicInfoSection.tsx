import type { Show } from '../../types';
import { normaliseShowTime } from '../../utils/readShowStart';

interface BasicInfoSectionProps {
  show: Show;
  onChange: (updates: Partial<Show>) => void;
}

export function BasicInfoSection({ show, onChange }: BasicInfoSectionProps) {
  return (
    <div className="section-body section-body--grid">
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
        {/* Typed freely, stored as a clock time. "Doors 8:30 Show 9" is how a
            run sheet says it, and it used to be stored verbatim — which reads
            back as no time at all to everything downstream, so the timeline
            drew nothing and the generator refused to run. Tidied on the way
            out of the field rather than as you type, so the caret doesn't jump
            around mid-word. */}
        <input
          className="section-field__input"
          value={show.time}
          onChange={(e) => onChange({ time: e.target.value })}
          onBlur={(e) => {
            const tidy = normaliseShowTime(e.target.value);
            if (tidy && tidy !== e.target.value) onChange({ time: tidy });
          }}
          placeholder="e.g. 8:00 PM, or doors 8:30 show 9"
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
      <label className="section-field section-field--full">
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

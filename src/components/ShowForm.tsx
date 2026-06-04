import { useState } from 'react';
import type { Show, ShowStatus, SectionKey } from '../types';
import './ShowForm.css';

interface ShowFormProps {
  initial?: Partial<Show>;
  onSave: (show: Omit<Show, 'id' | 'createdAt' | 'updatedAt' | 'scenes' | 'files'>) => void;
  onCancel: () => void;
}

// Optional content blocks the user can choose to include when creating a show.
// "Basic Info" is always present, so it isn't listed here.
const SELECTABLE_BLOCKS: { key: SectionKey; label: string }[] = [
  { key: 'performers', label: 'Performers' },
  { key: 'artists', label: 'Artists' },
  { key: 'schedule', label: 'Schedule' },
  { key: 'dj', label: 'DJ Music' },
  { key: 'staff', label: 'Staff' },
  { key: 'vendors', label: 'Vendors' },
  { key: 'files', label: 'Files' },
];

export function ShowForm({ initial, onSave, onCancel }: ShowFormProps) {
  const [name, setName] = useState(initial?.name ?? '');
  const [date, setDate] = useState(initial?.date ?? '');
  const [time, setTime] = useState(initial?.time ?? '');
  const [venueName, setVenueName] = useState(initial?.venueName ?? '');
  const [location, setLocation] = useState(initial?.location ?? '');
  const [status, setStatus] = useState<ShowStatus>(initial?.status ?? 'upcoming');
  const [selectedBlocks, setSelectedBlocks] = useState<Set<SectionKey>>(() => {
    const hidden = new Set(initial?.hiddenSections ?? []);
    return new Set(SELECTABLE_BLOCKS.map(b => b.key).filter(k => !hidden.has(k)));
  });

  function toggleBlock(key: SectionKey) {
    setSelectedBlocks(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // Only name + date are required up front; venue/time can be filled in later.
    if (!name.trim() || !date.trim()) return;
    const hiddenSections = SELECTABLE_BLOCKS
      .map(b => b.key)
      .filter(key => !selectedBlocks.has(key));
    onSave({
      name: name.trim(),
      date,
      time,
      venueName: venueName.trim(),
      location: location.trim(),
      status,
      performers: initial?.performers ?? [],
      artists: initial?.artists ?? [],
      schedule: initial?.schedule ?? [],
      hosts: initial?.hosts ?? [],
      djSongs: initial?.djSongs ?? [],
      staff: initial?.staff ?? [],
      vendors: initial?.vendors ?? [],
      expenses: initial?.expenses ?? [],
      hiddenSections,
    });
  }

  return (
    <form className="show-form" onSubmit={handleSubmit}>
      <h2 className="show-form__title">{initial?.id ? 'Edit Show' : 'New Show'}</h2>

      <label className="show-form__label">
        Show Name *
        <input
          className="show-form__input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Show name"
          required
          autoFocus
        />
      </label>

      <label className="show-form__label">
        Date *
        <input
          className="show-form__input"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          required
        />
      </label>

      <label className="show-form__label">
        Time
        <input
          className="show-form__input"
          type="text"
          value={time}
          onChange={(e) => setTime(e.target.value)}
          placeholder="e.g. 8:00 PM"
        />
      </label>

      <label className="show-form__label">
        Venue Name
        <input
          className="show-form__input"
          value={venueName}
          onChange={(e) => setVenueName(e.target.value)}
          placeholder="Venue name"
        />
      </label>

      <label className="show-form__label">
        Location
        <input
          className="show-form__input"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="City, address, or location details"
        />
      </label>

      <label className="show-form__label">
        Status
        <select
          className="show-form__select"
          value={status}
          onChange={(e) => setStatus(e.target.value as ShowStatus)}
        >
          <option value="upcoming">Upcoming</option>
          <option value="in-progress">In Progress</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </label>

      <fieldset className="show-form__blocks">
        <legend className="show-form__blocks-legend">Show Blocks</legend>
        <p className="show-form__blocks-hint">
          Choose which sections to include. You can always add or remove these later.
        </p>
        <div className="show-form__blocks-grid">
          {SELECTABLE_BLOCKS.map(block => {
            const checked = selectedBlocks.has(block.key);
            return (
              <label
                key={block.key}
                className={`show-form__block${checked ? ' show-form__block--on' : ''}`}
              >
                <input
                  type="checkbox"
                  className="show-form__block-checkbox"
                  checked={checked}
                  onChange={() => toggleBlock(block.key)}
                />
                <span>{block.label}</span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <div className="show-form__actions">
        <button type="button" className="btn btn--secondary" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="btn btn--primary">
          Save
        </button>
      </div>
    </form>
  );
}

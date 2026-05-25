import { useState } from 'react';
import type { Show, ShowStatus } from '../types';
import './ShowForm.css';

interface ShowFormProps {
  initial?: Partial<Show>;
  onSave: (show: Omit<Show, 'id' | 'createdAt' | 'updatedAt' | 'scenes' | 'files'>) => void;
  onCancel: () => void;
}

export function ShowForm({ initial, onSave, onCancel }: ShowFormProps) {
  const [name, setName] = useState(initial?.name ?? '');
  const [date, setDate] = useState(initial?.date ?? '');
  const [time, setTime] = useState(initial?.time ?? '');
  const [venueName, setVenueName] = useState(initial?.venueName ?? '');
  const [location, setLocation] = useState(initial?.location ?? '');
  const [status, setStatus] = useState<ShowStatus>(initial?.status ?? 'upcoming');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !date.trim() || !time.trim() || !venueName.trim()) return;
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
        Time *
        <input
          className="show-form__input"
          type="text"
          value={time}
          onChange={(e) => setTime(e.target.value)}
          placeholder="e.g. 8:00 PM"
          required
        />
      </label>

      <label className="show-form__label">
        Venue Name *
        <input
          className="show-form__input"
          value={venueName}
          onChange={(e) => setVenueName(e.target.value)}
          placeholder="Venue name"
          required
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

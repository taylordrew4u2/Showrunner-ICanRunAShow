import { useState } from 'react';
import type { Show } from '../types';
import './ShowForm.css';

type ShowCreateData = Pick<Show, 'name' | 'date' | 'time' | 'location' | 'venueName'>;

interface ShowFormProps {
  onSave: (data: ShowCreateData) => void;
  onCancel: () => void;
}

export function ShowForm({ onSave, onCancel }: ShowFormProps) {
  const [name, setName] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [location, setLocation] = useState('');
  const [venueName, setVenueName] = useState('');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    onSave({
      name: name.trim(),
      date,
      time: time.trim(),
      location: location.trim(),
      venueName: venueName.trim(),
    });
  }

  return (
    <form className="show-form" onSubmit={handleSubmit}>
      <h2 className="show-form__title">Create a Show</h2>

      <label className="show-form__label">
        Show Name *
        <input
          className="show-form__input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Spring Showcase 2026"
          required
          autoFocus
        />
      </label>

      <label className="show-form__label">
        Date
        <input
          className="show-form__input"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
      </label>

      <label className="show-form__label">
        Show Time
        <input
          className="show-form__input"
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
          placeholder="Address or city"
        />
      </label>

      <div className="show-form__actions">
        <button type="button" className="btn btn--secondary" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="btn btn--primary">
          Create
        </button>
      </div>
    </form>
  );
}

import { useState } from 'react';
import type { Show, ShowStatus } from '../types';
import './ShowForm.css';

interface ShowFormProps {
  initial?: Partial<Show>;
  onSave: (show: Omit<Show, 'id' | 'createdAt' | 'scenes'>) => void;
  onCancel: () => void;
}

export function ShowForm({ initial, onSave, onCancel }: ShowFormProps) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [date, setDate] = useState(initial?.date ?? '');
  const [venue, setVenue] = useState(initial?.venue ?? '');
  const [status, setStatus] = useState<ShowStatus>(initial?.status ?? 'upcoming');
  const [notes, setNotes] = useState(initial?.notes ?? '');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    onSave({ title: title.trim(), date, venue: venue.trim(), status, notes: notes.trim() });
  }

  return (
    <form className="show-form" onSubmit={handleSubmit}>
      <h2 className="show-form__title">{initial?.id ? 'Edit Show' : 'New Show'}</h2>

      <label className="show-form__label">
        Title *
        <input
          className="show-form__input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Show title"
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
        Venue
        <input
          className="show-form__input"
          value={venue}
          onChange={(e) => setVenue(e.target.value)}
          placeholder="Venue or location"
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

      <label className="show-form__label">
        Notes
        <textarea
          className="show-form__textarea"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Any notes about this show…"
          rows={3}
        />
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

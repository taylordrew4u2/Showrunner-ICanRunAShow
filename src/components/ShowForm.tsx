import { useState } from 'react';
import { DEFAULT_SECTIONS, SELECTABLE_SECTIONS, hiddenFromSelected } from '../utils/showBlocks';
import type { Show, ShowStatus, SectionKey } from '../types';
import './ShowForm.css';

interface ShowFormProps {
  initial?: Partial<Show>;
  onSave: (show: Omit<Show, 'id' | 'createdAt' | 'updatedAt'>) => void;
  onCancel: () => void;
}

// What each selectable section is called on this form. The list itself, and
// what a new show starts with, live in utils/showBlocks.
const BLOCK_LABELS: Record<string, string> = {
  performers: 'Performers',
  artists: 'Artists',
  schedule: 'Schedule',
  dj: 'DJ Music',
  staff: 'Staff',
  vendors: 'Vendors',
  scenes: 'Scenes & Segments',
};

export function ShowForm({ initial, onSave, onCancel }: ShowFormProps) {
  const [name, setName] = useState(initial?.name ?? '');
  const [date, setDate] = useState(initial?.date ?? '');
  const [time, setTime] = useState(initial?.time ?? '');
  const [venueName, setVenueName] = useState(initial?.venueName ?? '');
  const [location, setLocation] = useState(initial?.location ?? '');
  const [status, setStatus] = useState<ShowStatus>(initial?.status ?? 'upcoming');
  // Kept as the raw string so the field can be cleared. '' means no target,
  // which is a real state: a lineup with no target has no "full".
  const [performerTarget, setPerformerTarget] = useState(
    initial?.performerTarget ? String(initial.performerTarget) : '',
  );
  const [selectedBlocks, setSelectedBlocks] = useState<Set<SectionKey>>(() => {
    // New show: the sections a show almost always needs, so it opens on
    // something you can work on. Editing an existing show: reflect its current
    // sections so the boxes match what's already there.
    if (!initial?.id) return new Set<SectionKey>(DEFAULT_SECTIONS);
    const hidden = new Set(initial.hiddenSections ?? []);
    return new Set(
      SELECTABLE_SECTIONS.filter(k => {
        if (hidden.has(k)) return false;
        // Scenes is the one section that hides on "never used" rather than on
        // hiddenSections, so reading hiddenSections alone would show it ticked
        // on every show that has never had one — and ticked means it appears.
        if (k === 'scenes') return initial.scenes !== undefined;
        return true;
      }),
    );
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
    const hiddenSections = hiddenFromSelected(selectedBlocks);
    const target = Math.floor(Number(performerTarget.trim()));
    onSave({
      name: name.trim(),
      date,
      time,
      venueName: venueName.trim(),
      location: location.trim(),
      status,
      performerTarget:
        performerTarget.trim() !== '' && Number.isFinite(target) && target > 0 ? target : undefined,
      performers: initial?.performers ?? [],
      artists: initial?.artists ?? [],
      schedule: initial?.schedule ?? [],
      hosts: initial?.hosts ?? [],
      djSongs: initial?.djSongs ?? [],
      staff: initial?.staff ?? [],
      vendors: initial?.vendors ?? [],
      expenses: initial?.expenses ?? [],
      // An array — even an empty one — is what makes the section appear;
      // `undefined` means "never used". Unticking only hides it, via
      // hiddenSections, so scenes already written down survive.
      scenes: selectedBlocks.has('scenes') ? (initial?.scenes ?? []) : initial?.scenes,
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
        Performers Wanted
        <input
          className="show-form__input"
          type="number"
          min={1}
          inputMode="numeric"
          value={performerTarget}
          onChange={(e) => setPerformerTarget(e.target.value)}
          placeholder="How many you're booking (optional)"
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
          Every one of these can be turned on or off later from the show page.
        </p>
        <div className="show-form__blocks-grid">
          {SELECTABLE_SECTIONS.map(key => {
            const checked = selectedBlocks.has(key);
            return (
              <label
                key={key}
                className={`show-form__block${checked ? ' show-form__block--on' : ''}`}
              >
                <input
                  type="checkbox"
                  className="show-form__block-checkbox"
                  checked={checked}
                  onChange={() => toggleBlock(key)}
                />
                <span>{BLOCK_LABELS[key] ?? key}</span>
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

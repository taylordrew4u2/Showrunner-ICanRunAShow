import { useMemo, useState } from 'react';
import type { Show } from '../types';
import { parseShowDate, toDateKey } from '../utils/showDate';
import './ShowsCalendar.css';

interface ShowsCalendarProps {
  shows: Show[];
  onSelect: (show: Show, e: React.MouseEvent) => void;
}

const MAX_CHIPS = 3;

// Aug 1–7 2021 ran Sunday→Saturday; used only to produce localized weekday labels.
const WEEKDAY_LABELS = Array.from({ length: 7 }, (_, i) =>
  new Date(2021, 7, i + 1).toLocaleDateString(undefined, { weekday: 'short' })
);

export function ShowsCalendar({ shows, onSelect }: ShowsCalendarProps) {
  const today = new Date();
  const todayKey = toDateKey(today);
  const [cursor, setCursor] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const { byDate, undated } = useMemo(() => {
    const byDate = new Map<string, Show[]>();
    const undated: Show[] = [];
    for (const show of shows) {
      const d = parseShowDate(show.date);
      if (!d) {
        undated.push(show);
        continue;
      }
      const key = toDateKey(d);
      const list = byDate.get(key);
      if (list) list.push(show);
      else byDate.set(key, [show]);
    }
    return { byDate, undated };
  }, [shows]);

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells: (Date | null)[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);

  const monthLabel = cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const monthHasShows = cells.some((d) => d && byDate.has(toDateKey(d)));

  const selectedDate = selectedKey ? parseShowDate(selectedKey) : null;
  const selectedShows = selectedKey ? byDate.get(selectedKey) ?? [] : [];

  function goToMonth(y: number, m: number) {
    setCursor(new Date(y, m, 1));
    setSelectedKey(null);
  }

  function goToToday() {
    setCursor(new Date(today.getFullYear(), today.getMonth(), 1));
    setSelectedKey(byDate.has(todayKey) ? todayKey : null);
  }

  function renderShowRow(show: Show) {
    const time = show.time?.trim();
    return (
      <button
        key={show.id}
        className={`shows-calendar__show-row shows-calendar__show-row--${show.status}`}
        onClick={(e) => onSelect(show, e)}
      >
        <span className="shows-calendar__show-row-dot" aria-hidden="true" />
        <span className="shows-calendar__show-row-name">{show.name}</span>
        {(time || show.venueName) && (
          <span className="shows-calendar__show-row-meta">
            {[time, show.venueName].filter(Boolean).join(' · ')}
          </span>
        )}
      </button>
    );
  }

  return (
    <div className="shows-calendar">
      <div className="shows-calendar__header">
        <h2 className="shows-calendar__month">{monthLabel}</h2>
        <div className="shows-calendar__nav">
          <button
            className="shows-calendar__nav-btn"
            onClick={() => goToMonth(year, month - 1)}
            aria-label="Previous month"
          >
            ‹
          </button>
          <button className="shows-calendar__nav-btn shows-calendar__nav-btn--today" onClick={goToToday}>
            Today
          </button>
          <button
            className="shows-calendar__nav-btn"
            onClick={() => goToMonth(year, month + 1)}
            aria-label="Next month"
          >
            ›
          </button>
        </div>
      </div>

      <div className="shows-calendar__weekdays" aria-hidden="true">
        {WEEKDAY_LABELS.map((label) => (
          <span key={label} className="shows-calendar__weekday">{label}</span>
        ))}
      </div>

      <div className="shows-calendar__grid">
        {cells.map((date, i) => {
          if (!date) {
            return <div key={i} className="shows-calendar__cell shows-calendar__cell--blank" aria-hidden="true" />;
          }
          const key = toDateKey(date);
          const dayShows = byDate.get(key) ?? [];
          const isToday = key === todayKey;
          const isSelected = key === selectedKey;
          const cellClasses = [
            'shows-calendar__cell',
            isToday ? 'shows-calendar__cell--today' : '',
            isSelected ? 'shows-calendar__cell--selected' : '',
            dayShows.length > 0 ? 'shows-calendar__cell--has-shows' : '',
          ].filter(Boolean).join(' ');
          return (
            <button
              key={i}
              className={cellClasses}
              onClick={() => setSelectedKey(isSelected ? null : key)}
              aria-label={`${date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}${dayShows.length ? `, ${dayShows.length} show${dayShows.length === 1 ? '' : 's'}` : ''}`}
              aria-pressed={isSelected}
            >
              <span className="shows-calendar__day-num">{date.getDate()}</span>
              {dayShows.length > 0 && (
                <span className="shows-calendar__chips" aria-hidden="true">
                  {dayShows.slice(0, MAX_CHIPS).map((s) => (
                    <span key={s.id} className={`shows-calendar__chip shows-calendar__chip--${s.status}`}>
                      {s.name}
                    </span>
                  ))}
                  {dayShows.length > MAX_CHIPS && (
                    <span className="shows-calendar__chip-more">+{dayShows.length - MAX_CHIPS}</span>
                  )}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {!monthHasShows && !selectedKey && (
        <p className="shows-calendar__empty-month">No shows in {monthLabel}.</p>
      )}

      {selectedKey && selectedDate && (
        <div className="shows-calendar__day-list">
          <h3 className="shows-calendar__day-list-title">
            {selectedDate.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
          </h3>
          {selectedShows.length === 0 ? (
            <p className="shows-calendar__day-list-empty">No shows on this day.</p>
          ) : (
            selectedShows.map(renderShowRow)
          )}
        </div>
      )}

      {undated.length > 0 && (
        <div className="shows-calendar__day-list shows-calendar__day-list--undated">
          <h3 className="shows-calendar__day-list-title">No date yet</h3>
          {undated.map(renderShowRow)}
        </div>
      )}
    </div>
  );
}

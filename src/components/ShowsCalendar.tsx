import { useMemo, useState } from 'react';
import type { Show } from '../types';
import { parseShowDate, toDateKey, formatShowTime } from '../utils/showDate';
import './ShowsCalendar.css';

interface ShowsCalendarProps {
  shows: Show[];
  onSelectShow: (show: Show, e: React.MouseEvent) => void;
}

const STATUS_LABELS: Record<Show['status'], string> = {
  upcoming: 'Upcoming',
  'in-progress': 'In Progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export function ShowsCalendar({ shows, onSelectShow }: ShowsCalendarProps) {
  const today = new Date();
  const todayKey = toDateKey(today);
  const [monthCursor, setMonthCursor] = useState(
    () => new Date(today.getFullYear(), today.getMonth(), 1),
  );
  const [selectedKey, setSelectedKey] = useState(todayKey);

  const { showsByDay, undatedShows } = useMemo(() => {
    const map = new Map<string, Show[]>();
    const undated: Show[] = [];
    for (const show of shows) {
      const date = parseShowDate(show.date);
      if (!date) {
        undated.push(show);
        continue;
      }
      const key = toDateKey(date);
      const list = map.get(key);
      if (list) list.push(show);
      else map.set(key, [show]);
    }
    for (const list of map.values()) {
      list.sort((a, b) => (a.time || '').localeCompare(b.time || ''));
    }
    return { showsByDay: map, undatedShows: undated };
  }, [shows]);

  const year = monthCursor.getFullYear();
  const month = monthCursor.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startOffset = new Date(year, month, 1).getDay();

  const weekdayLabels = useMemo(() => {
    // Sunday-first, localized (Jan 4 2026 is a Sunday)
    return Array.from({ length: 7 }, (_, i) =>
      new Date(2026, 0, 4 + i).toLocaleDateString(undefined, { weekday: 'narrow' }),
    );
  }, []);

  const monthTitle = monthCursor.toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });

  function goToMonth(offset: number) {
    setMonthCursor((prev) => new Date(prev.getFullYear(), prev.getMonth() + offset, 1));
  }

  function goToToday() {
    setMonthCursor(new Date(today.getFullYear(), today.getMonth(), 1));
    setSelectedKey(todayKey);
  }

  const selectedDate = parseShowDate(selectedKey);
  const selectedShows = showsByDay.get(selectedKey) ?? [];
  const agendaTitle = selectedDate?.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });

  function renderAgendaRow(show: Show) {
    const timeStr = formatShowTime(show.time);
    return (
      <button
        key={show.id}
        className={`shows-cal__event shows-cal__event--${show.status}`}
        onClick={(e) => onSelectShow(show, e)}
      >
        <div className="shows-cal__event-main">
          <span className="shows-cal__event-name">{show.name}</span>
          {(timeStr || show.venueName) && (
            <span className="shows-cal__event-detail">
              {[timeStr, show.venueName].filter(Boolean).join(' · ')}
            </span>
          )}
        </div>
        <span className="shows-cal__event-status">{STATUS_LABELS[show.status]}</span>
      </button>
    );
  }

  return (
    <div className="shows-cal">
      <div className="shows-cal__header">
        <h2 className="shows-cal__title" aria-live="polite">{monthTitle}</h2>
        <button
          className="shows-cal__today-btn"
          onClick={goToToday}
          disabled={monthCursor.getMonth() === today.getMonth()
            && monthCursor.getFullYear() === today.getFullYear()
            && selectedKey === todayKey}
        >
          Today
        </button>
        <button
          className="shows-cal__nav-btn"
          onClick={() => goToMonth(-1)}
          aria-label="Previous month"
        >
          ‹
        </button>
        <button
          className="shows-cal__nav-btn"
          onClick={() => goToMonth(1)}
          aria-label="Next month"
        >
          ›
        </button>
      </div>

      <div className="shows-cal__weekdays" aria-hidden="true">
        {weekdayLabels.map((label, i) => (
          <span key={i} className="shows-cal__weekday">{label}</span>
        ))}
      </div>

      <div className="shows-cal__grid" role="grid" aria-label={monthTitle}>
        {Array.from({ length: startOffset }, (_, i) => (
          <span key={`blank-${i}`} className="shows-cal__day shows-cal__day--blank" aria-hidden="true" />
        ))}
        {Array.from({ length: daysInMonth }, (_, i) => {
          const day = i + 1;
          const key = toDateKey(new Date(year, month, day));
          const dayShows = showsByDay.get(key) ?? [];
          const classes = [
            'shows-cal__day',
            key === todayKey ? 'shows-cal__day--today' : '',
            key === selectedKey ? 'shows-cal__day--selected' : '',
            dayShows.length > 0 ? 'shows-cal__day--has-shows' : '',
          ].filter(Boolean).join(' ');
          const dateLabel = new Date(year, month, day).toLocaleDateString(undefined, {
            weekday: 'long',
            month: 'long',
            day: 'numeric',
          });
          return (
            <button
              key={key}
              className={classes}
              onClick={() => setSelectedKey(key)}
              aria-label={`${dateLabel}, ${dayShows.length} show${dayShows.length === 1 ? '' : 's'}`}
              aria-pressed={key === selectedKey}
            >
              <span className="shows-cal__day-num">{day}</span>
              <span className="shows-cal__dots" aria-hidden="true">
                {dayShows.slice(0, 3).map((s) => (
                  <span key={s.id} className={`shows-cal__dot shows-cal__dot--${s.status}`} />
                ))}
              </span>
            </button>
          );
        })}
      </div>

      <div className="shows-cal__agenda">
        <h3 className="shows-cal__agenda-title">{agendaTitle}</h3>
        {selectedShows.length === 0 ? (
          <p className="shows-cal__agenda-empty">No shows on this day.</p>
        ) : (
          <div className="shows-cal__agenda-list">
            {selectedShows.map(renderAgendaRow)}
          </div>
        )}
      </div>

      {undatedShows.length > 0 && (
        <div className="shows-cal__agenda shows-cal__agenda--undated">
          <h3 className="shows-cal__agenda-title">No date set</h3>
          <div className="shows-cal__agenda-list">
            {undatedShows.map(renderAgendaRow)}
          </div>
        </div>
      )}
    </div>
  );
}

import { useMemo, useRef, useState } from 'react';
import type { Show } from '../types';
import { parseShowDate, toDateKey, formatShowTime } from '../utils/showDate';
import { parseClockToMinutes } from '../utils/showTiming';
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

/**
 * The month as rows of seven, Sunday first, with `null` where a cell belongs
 * to the neighbouring month. Rows are what a screen reader needs to announce
 * "row 3, column 5" for a grid; a flat run of buttons reads as an empty table.
 *
 * Exported so a test can pin the layout. Fast refresh only minds exports it
 * has to re-render, and this one has no UI of its own.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function weeksOfMonth(startOffset: number, daysInMonth: number): (number | null)[][] {
  const cells: (number | null)[] = [
    ...Array.from({ length: startOffset }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (number | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/**
 * Which day of the month a key moves focus to from `day`, or null for a key
 * the grid does not handle. Arrows step a day or a week; Home and End go to
 * the ends of the week. Movement stops at the month's edges rather than
 * turning the page — the month buttons do that, and a producer skimming for
 * a free Saturday should not find themselves in October by accident.
 *
 * Exported so a test can pin the rule; see weeksOfMonth on fast refresh.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function dayReachedByKey(
  key: string,
  day: number,
  startOffset: number,
  daysInMonth: number,
): number | null {
  const column = (startOffset + day - 1) % 7;
  let next: number;
  switch (key) {
    case 'ArrowLeft': next = day - 1; break;
    case 'ArrowRight': next = day + 1; break;
    case 'ArrowUp': next = day - 7; break;
    case 'ArrowDown': next = day + 7; break;
    case 'Home': next = day - column; break;
    case 'End': next = day + (6 - column); break;
    default: return null;
  }
  return Math.min(daysInMonth, Math.max(1, next));
}

export function ShowsCalendar({ shows, onSelectShow }: ShowsCalendarProps) {
  const today = new Date();
  const todayKey = toDateKey(today);
  const [monthCursor, setMonthCursor] = useState(
    () => new Date(today.getFullYear(), today.getMonth(), 1),
  );
  const [selectedKey, setSelectedKey] = useState(todayKey);
  // The one day that is in the Tab order. Arrow keys move it; Tab then leaves
  // the grid in a single press instead of walking every remaining day.
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);

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
      // By the clock, not the text: "10:00 PM" sorts before "7:30 PM" as a
      // string. A show with no time yet goes last, after the ones that have one.
      list.sort((a, b) => (parseClockToMinutes(a.time) ?? Infinity) - (parseClockToMinutes(b.time) ?? Infinity));
    }
    return { showsByDay: map, undatedShows: undated };
  }, [shows]);

  const year = monthCursor.getFullYear();
  const month = monthCursor.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startOffset = new Date(year, month, 1).getDay();
  const weeks = weeksOfMonth(startOffset, daysInMonth);

  const inThisMonth = (key: string | null) => key !== null && key.startsWith(toDateKey(monthCursor).slice(0, 7));
  // Tab lands on the day being looked at, the selected day, or failing both
  // the 1st — whichever is actually on screen this month.
  const tabStopKey = inThisMonth(focusedKey) ? focusedKey
    : inThisMonth(selectedKey) ? selectedKey
    : toDateKey(new Date(year, month, 1));

  function handleGridKeyDown(e: React.KeyboardEvent<HTMLButtonElement>, day: number) {
    const next = dayReachedByKey(e.key, day, startOffset, daysInMonth);
    if (next === null) return;
    e.preventDefault();
    const key = toDateKey(new Date(year, month, next));
    setFocusedKey(key);
    gridRef.current?.querySelector<HTMLButtonElement>(`[data-day-key="${key}"]`)?.focus();
  }

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

      <div ref={gridRef} className="shows-cal__grid" role="grid" aria-label={monthTitle}>
        {weeks.map((week, w) => (
          <div key={w} className="shows-cal__week" role="row">
            {week.map((day, col) => {
              if (day === null) {
                // Still a cell, and not hidden: an announced column number only
                // lines up with the weekday header if the empty ones count too.
                return <span key={`blank-${col}`} className="shows-cal__day shows-cal__day--blank" role="gridcell" />;
              }
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
                <div key={key} role="gridcell" aria-selected={key === selectedKey} className="shows-cal__cell">
                  <button
                    className={classes}
                    data-day-key={key}
                    tabIndex={key === tabStopKey ? 0 : -1}
                    onClick={() => setSelectedKey(key)}
                    onFocus={() => setFocusedKey(key)}
                    onKeyDown={(e) => handleGridKeyDown(e, day)}
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
                </div>
              );
            })}
          </div>
        ))}
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

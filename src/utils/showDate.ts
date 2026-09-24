// Date helpers for show cards and the calendar view.
//
// Show dates are stored as 'YYYY-MM-DD' strings. Parsing those with
// `new Date(str)` treats them as UTC midnight, which shifts the displayed
// day backwards in western timezones — so parse the parts manually and
// build a local date instead.
import { parseClockToMinutes } from './showTiming';

export function parseShowDate(value: string | undefined | null): Date | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (match) {
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * The moment a show starts, as an ISO timestamp for a machine on another
 * clock — the public viewer, which counts down to it.
 *
 * Built from the parts rather than glued together: `"2026-09-24T8:00 PM"`
 * is not a date to `new Date`, so the room's screen said "Time TBA" for a show
 * that had one, and a bare `"2026-09-24"` reads as UTC midnight, which in New
 * York is the evening before. Undefined when there is no date, or the time
 * will not parse — the viewer then shows nothing rather than something wrong.
 */
export function showStartISO(date: string | undefined, time: string | undefined): string | undefined {
  const day = parseShowDate(date);
  if (!day) return undefined;
  const minutes = parseClockToMinutes(time);
  if (minutes === null) return undefined;
  day.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return day.toISOString();
}

/** Local-timezone 'YYYY-MM-DD' key for grouping shows by day. */
export function toDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Render 'HH:MM' as a localized time (e.g. 7:30 PM); pass anything else through. */
export function formatShowTime(time: string | undefined | null): string | null {
  if (!time) return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!match) return time;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return time;
  return new Date(2000, 0, 1, hours, minutes).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
}

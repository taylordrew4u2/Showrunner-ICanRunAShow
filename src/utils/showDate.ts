// Date helpers for show cards and the calendar view.
//
// Show dates are stored as 'YYYY-MM-DD' strings. Parsing those with
// `new Date(str)` treats them as UTC midnight, which shifts the displayed
// day backwards in western timezones — so parse the parts manually and
// build a local date instead.

export function parseShowDate(value: string | undefined | null): Date | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (match) {
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
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

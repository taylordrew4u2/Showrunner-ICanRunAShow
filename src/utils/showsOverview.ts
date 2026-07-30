import type { Show } from '../types';
import { parseShowDate, toDateKey } from './showDate';

/**
 * What the Shows page can tell you before you read a single card.
 *
 * A list of shows answers "what have I got". It doesn't answer the two
 * questions a promoter actually opens the app with: *what's next*, and *what
 * still needs doing*. Both are derivable from data already on screen — they
 * just weren't being derived.
 *
 * Everything here takes `today` as an argument rather than reading the clock,
 * so the wording can be tested at every boundary instead of only on the day
 * the test happens to run.
 */

export interface ShowsOverview {
  nextShow: Show | null;
  /** "Tonight", "Tomorrow", "In 5 days", "Fri, Aug 14" — null with no date. */
  nextShowWhen: string | null;
  upcomingCount: number;
  /** Upcoming shows with nobody booked yet. */
  needsLineup: Show[];
  /** Upcoming shows with a lineup but no run-of-show. */
  needsSchedule: Show[];
}

/** Whole days from `today` to `date`, both floored to local midnight. */
export function daysUntil(date: Date, today: Date): number {
  const a = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const b = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((a.getTime() - b.getTime()) / 86_400_000);
}

/**
 * How far off a show is, in the words someone would actually use.
 *
 * "In 6 days" beats a date while it's still countable; past a week the date is
 * more use than the count. Anything already gone says so plainly rather than
 * reporting a negative number of days.
 */
export function whenLabel(date: Date, today: Date): string {
  const days = daysUntil(date, today);
  if (days === 0) return 'Tonight';
  if (days === 1) return 'Tomorrow';
  if (days === -1) return 'Yesterday';
  if (days < -1) return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  if (days <= 7) return `In ${days} days`;
  return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

/** A show still ahead of us: not finished, not called off, and dated today or later. */
function isAhead(show: Show, today: Date): boolean {
  if (show.status === 'completed' || show.status === 'cancelled') return false;
  const date = parseShowDate(show.date);
  // An undated show is still on the books — it just can't be sorted by when.
  if (!date) return true;
  return daysUntil(date, today) >= 0;
}

export function buildOverview(shows: Show[], today: Date = new Date()): ShowsOverview {
  const ahead = shows.filter((show) => isAhead(show, today));

  // Dated shows first, soonest wins; an undated show can't be "next".
  const dated = ahead
    .map((show) => ({ show, date: parseShowDate(show.date) }))
    .filter((entry): entry is { show: Show; date: Date } => entry.date !== null)
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  const next = dated[0] ?? null;

  return {
    nextShow: next?.show ?? null,
    nextShowWhen: next ? whenLabel(next.date, today) : null,
    upcomingCount: ahead.length,
    needsLineup: ahead.filter((s) => s.performers.length === 0 && s.artists.length === 0),
    // Only shows that *have* a bill — telling you to write a running order for
    // a show with nobody on it is noise, and "needs a lineup" already has it.
    needsSchedule: ahead.filter(
      (s) => (s.performers.length > 0 || s.artists.length > 0) && s.schedule.length === 0,
    ),
  };
}

/** Shows falling on the same local day, for the calendar-ish reads. */
export function showsOnDay(shows: Show[], day: Date): Show[] {
  const key = toDateKey(day);
  return shows.filter((show) => {
    const date = parseShowDate(show.date);
    return date ? toDateKey(date) === key : false;
  });
}

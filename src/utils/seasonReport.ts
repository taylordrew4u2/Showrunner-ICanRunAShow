// Roll every show up into the numbers a producer quotes when they pitch a
// venue or decide whether a night is worth keeping. Kept out of the component
// so the arithmetic is testable on its own, like showStats.
import type { Expense, Show } from '../types';
import { rolodexKey } from './rolodex';
import { parseShowDate } from './showDate';

export type SeasonRange = 'year' | 'all';

export interface RankedName {
  name: string;
  count: number;
}

export interface SeasonReport {
  /** Shows in range, before anything is filtered by status. */
  shows: number;
  run: number;
  upcoming: number;
  cancelled: number;
  /** Sum of recap attendance over the shows that recorded one. */
  audience: number;
  /** Shows with an attendance figure — the average divides by this, not by run. */
  showsWithAudience: number;
  averageAudience: number;
  bestNight?: { name: string; date: string; attendance: number };
  revenue: number;
  showCosts: number;
  net: number;
  brandSpending: number;
  bookings: number;
  uniquePerformers: number;
  topPerformers: RankedName[];
  topVenues: RankedName[];
}

// Costs and counts arrive from imports and hand-typed fields; anything that
// isn't a number counts as zero rather than turning the total into NaN.
function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function inRange(date: string | undefined, range: SeasonRange, year: number): boolean {
  if (range === 'all') return true;
  // An undated show or expense can't be placed in a year, so it only counts
  // toward all time — guessing would put last year's costs on this year.
  const parsed = parseShowDate(date);
  return parsed !== null && parsed.getFullYear() === year;
}

function rank(counts: Map<string, RankedName>, limit: number): RankedName[] {
  return [...counts.values()]
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, limit);
}

export function buildSeasonReport(
  allShows: Show[],
  brandExpenses: Expense[] = [],
  range: SeasonRange = 'year',
  today: Date = new Date(),
): SeasonReport {
  const year = today.getFullYear();
  // The sample night is a demo, not a booking; quoting it to a venue would
  // be claiming a show that never happened.
  const shows = allShows.filter((s) => !s.sample && inRange(s.date, range, year));
  const live = shows.filter((s) => s.status !== 'cancelled');
  const completed = shows.filter((s) => s.status === 'completed');

  let audience = 0;
  let withAudience = 0;
  let bestNight: SeasonReport['bestNight'];
  let revenue = 0;
  for (const show of completed) {
    const attendance = num(show.recap?.attendance);
    if (attendance > 0) {
      audience += attendance;
      withAudience += 1;
      if (!bestNight || attendance > bestNight.attendance) {
        bestNight = { name: show.name, date: show.date, attendance };
      }
    }
    revenue += num(show.recap?.merchSales);
  }

  // Costs from the nights that are over, cancelled ones included since their
  // deposits were still spent. An upcoming night's costs wait for it to run,
  // or a deposit paid ahead would read as a loss against income not yet earned.
  const showCosts = shows
    .filter((s) => s.status === 'completed' || s.status === 'cancelled')
    .reduce((sum, s) => sum + (s.expenses ?? []).reduce((acc, e) => acc + num(e.cost), 0), 0);

  const brandSpending = brandExpenses
    .filter((e) => inRange(e.date, range, year))
    .reduce((sum, e) => sum + num(e.cost), 0);

  const people = new Map<string, RankedName>();
  let bookings = 0;
  for (const show of live) {
    // One person on a show twice (performer and artist) is still one booking.
    const seen = new Set<string>();
    for (const p of [...(show.performers ?? []), ...(show.artists ?? [])]) {
      if (!p.name?.trim()) continue;
      // By name, the way the Rolodex matches people: the same comic booked from
      // the Rolodex on one night and typed in by hand on another is one person.
      const key = rolodexKey(p.name);
      if (seen.has(key)) continue;
      seen.add(key);
      bookings += 1;
      const entry = people.get(key) ?? { name: p.name.trim(), count: 0 };
      entry.count += 1;
      people.set(key, entry);
    }
  }

  const venues = new Map<string, RankedName>();
  for (const show of live) {
    // The venue name only: the location field is a city or street address,
    // and "Brooklyn" is not a room.
    const name = (show.venueName || '').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    const entry = venues.get(key) ?? { name, count: 0 };
    entry.count += 1;
    venues.set(key, entry);
  }

  return {
    shows: shows.length,
    run: completed.length,
    upcoming: shows.filter((s) => s.status === 'upcoming' || s.status === 'in-progress').length,
    cancelled: shows.length - live.length,
    audience,
    showsWithAudience: withAudience,
    averageAudience: withAudience ? Math.round(audience / withAudience) : 0,
    bestNight,
    revenue,
    showCosts,
    net: revenue - showCosts,
    brandSpending,
    bookings,
    uniquePerformers: people.size,
    topPerformers: rank(people, 5),
    topVenues: rank(venues, 3),
  };
}

export function formatMoney(value: number): string {
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  // Whole dollars stay whole; anything with cents shows both digits ($12.50,
  // not $12.5), matching the PDF export.
  const digits = Number.isInteger(abs) ? 0 : 2;
  return `${sign}$${abs.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

/**
 * The few lines a producer pastes into an email to a venue they want to book.
 * Only the numbers that make the case — and none that weren't recorded, since
 * "0 people came" is worse than saying nothing.
 */
export function seasonPitch(report: SeasonReport, brandName: string, range: SeasonRange, today: Date = new Date()): string {
  const who = brandName.trim() || 'We';
  const when = range === 'year' ? `in ${today.getFullYear()}` : 'so far';
  const lines: string[] = [];
  const has = brandName.trim() ? 'has' : 'have';
  const shows = (n: number) => `${n} ${n === 1 ? 'show' : 'shows'}`;
  // "We have produced 0 shows" talks a venue out of it; a producer starting
  // out leads with what's booked instead.
  if (report.run > 0) {
    lines.push(`${who} ${has} produced ${shows(report.run)} ${when}.`);
  } else if (report.upcoming > 0) {
    lines.push(`${who} ${has} ${shows(report.upcoming)} on the calendar.`);
  }
  if (report.audience > 0) {
    lines.push(`${report.audience.toLocaleString('en-US')} people through the door — an average of ${report.averageAudience} a night.`);
  }
  if (report.bestNight) {
    lines.push(`Biggest night: ${report.bestNight.name} (${report.bestNight.attendance.toLocaleString('en-US')}).`);
  }
  if (report.uniquePerformers > 0) {
    const performersWord = report.uniquePerformers === 1 ? 'performer' : 'performers';
    const spotsWord = report.bookings === 1 ? 'spot' : 'spots';
    lines.push(`${report.uniquePerformers} ${performersWord} booked across ${report.bookings} ${spotsWord}.`);
  }
  if (report.run > 0 && report.upcoming > 0) {
    lines.push(`${report.upcoming} more on the calendar.`);
  }
  return lines.join('\n');
}

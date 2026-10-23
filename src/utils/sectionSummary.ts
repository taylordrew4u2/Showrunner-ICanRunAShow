import type { Performer, ScheduleItem, StaffMember, Vendor } from '../types';
import { baseDurations, parseClockToMinutes } from './showTiming';
import { timeLabelFor } from './elapsed';
import { billedPerformers, surpriseGuests } from './surpriseGuests';

/**
 * One-line summaries of what's inside a collapsed section.
 *
 * A collapsed accordion told you a section had 3 things in it but not what they
 * were, so answering "who's on this bill?" meant opening every card. These put
 * the actual contents in the header, which is more information on screen
 * without another thing to look at.
 *
 * They're deliberately terse: this is a glanceable line, not a replacement for
 * opening the section.
 */

/** "Alice, Bea, Cal" — or "Alice, Bea +3" once the list stops being glanceable. */
export function joinNames(names: (string | undefined)[], max = 3): string | null {
  const clean = names.map((n) => n?.trim()).filter((n): n is string => !!n);
  if (clean.length === 0) return null;
  if (clean.length <= max) return clean.join(', ');
  return `${clean.slice(0, max).join(', ')} +${clean.length - max}`;
}

/**
 * "Alice, Bea, Cal · 1 surprise guest" — the bill, then how many are being
 * kept quiet. Counted rather than named: this line sits on the collapsed card,
 * which is the part of the page a producer has open with the room looking
 * over their shoulder.
 */
export function performersSummary(performers: Performer[]): string | null {
  const names = joinNames(billedPerformers(performers).map((p) => p.name));
  const guests = surpriseGuests(performers).length;
  const extra = guests > 0 ? `${guests} surprise guest${guests === 1 ? '' : 's'}` : null;
  const parts = [names, extra].filter((part): part is string => !!part);
  return parts.length ? parts.join(' · ') : null;
}

/** "45 min" / "1 hr" / "1 hr 10 min" — never "0 hr 70 min". */
export function formatRuntime(totalSeconds: number): string | null {
  const minutes = Math.round(totalSeconds / 60);
  if (minutes <= 0) return null;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} min`;
  if (rest === 0) return `${hours} hr`;
  return `${hours} hr ${rest} min`;
}

/**
 * "Doors 7:30 PM → Encore 9:15 PM" — the shape of the night in one line.
 *
 * The first and last cue by name, because "7:30 PM" alone says when to be
 * there and nothing about what happens; the two ends of a running order are
 * what a producer checks when they open a show they built last week.
 */
export function scheduleSpan(schedule: ScheduleItem[]): string | null {
  if (schedule.length === 0) return null;
  // The way this sheet already writes its times: a generated order counts up
  // from zero, and "0:00" read as a clock put the doors at 12:00 AM.
  const label = timeLabelFor(schedule);
  const end = (cue: ScheduleItem | undefined): string | null => {
    if (!cue) return null;
    const minutes = parseClockToMinutes(cue.time);
    const time = minutes === null ? cue.time?.trim() || null : label(minutes);
    const name = cue.description?.trim();
    if (!time) return name || null;
    return name ? `${name} ${time}` : time;
  };
  const first = end(schedule[0]);
  const last = schedule.length > 1 ? end(schedule[schedule.length - 1]) : null;
  if (!first) return null;
  return last && last !== first ? `${first} → ${last}` : first;
}

/**
 * "Doors 7:30 PM → Encore 9:15 PM · 1 hr 45 min" — where the night starts and
 * ends, and how long it runs. Runtime comes from the same duration logic Run
 * Show uses, so the estimate here and the countdown on the night agree.
 */
export function scheduleSummary(schedule: ScheduleItem[]): string | null {
  if (schedule.length === 0) return null;
  const runtime = formatRuntime(baseDurations(schedule).reduce((sum, s) => sum + s, 0));
  const parts = [scheduleSpan(schedule), runtime].filter((p): p is string => !!p);
  if (parts.length === 0) return joinNames(schedule.map((s) => s.description), 2);
  return parts.join(' · ');
}

/** "Emmy Cho — Sound, Ana Diaz — Door" */
export function staffSummary(staff: StaffMember[]): string | null {
  return joinNames(
    staff.map((s) => (s.role ? `${s.personName} — ${s.role}` : s.personName)),
    2,
  );
}

/**
 * What a show's vendors cost: every vendor's cost added up, booked or not, and
 * a cost that isn't a number counted as nothing.
 *
 * The one rule for it. The Vendors card prints this total and the recap counts
 * it as the night's vendor spend, so the two can't disagree about a show.
 */
export function vendorsCost(vendors: Vendor[]): number {
  return vendors.reduce((sum, v) => sum + (Number(v.cost) || 0), 0);
}

/** "Tacos El Sol, Sound Rental · $420" — names plus what they add up to. */
export function vendorsSummary(vendors: Vendor[]): string | null {
  const names = joinNames(vendors.map((v) => v.name), 2);
  if (!names) return null;
  const total = vendorsCost(vendors);
  if (total <= 0) return names;
  // No decimals: this is a glance value, and "$420" reads faster than "$420.00".
  return `${names} · $${Math.round(total).toLocaleString()}`;
}

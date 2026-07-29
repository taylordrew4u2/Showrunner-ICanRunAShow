import type { ScheduleItem, StaffMember, Vendor } from '../types';
import { baseDurations } from './showTiming';
import { formatShowTime } from './showDate';

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
 * "8:00 PM · 1 hr 10 min" — when the night starts and how long it runs.
 * Runtime comes from the same duration logic Run Show uses, so the estimate
 * here and the countdown on the night agree.
 */
export function scheduleSummary(schedule: ScheduleItem[]): string | null {
  if (schedule.length === 0) return null;
  const runtime = formatRuntime(baseDurations(schedule).reduce((sum, s) => sum + s, 0));
  const start = formatShowTime(schedule[0]?.time);
  const parts = [start, runtime].filter((p): p is string => !!p);
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

/** "Tacos El Sol, Sound Rental · $420" — names plus what they add up to. */
export function vendorsSummary(vendors: Vendor[]): string | null {
  const names = joinNames(vendors.map((v) => v.name), 2);
  if (!names) return null;
  const total = vendors.reduce((sum, v) => sum + (Number(v.cost) || 0), 0);
  if (total <= 0) return names;
  // No decimals: this is a glance value, and "$420" reads faster than "$420.00".
  return `${names} · $${Math.round(total).toLocaleString()}`;
}

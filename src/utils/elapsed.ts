/**
 * Timing a show by how far into it you are, rather than by the clock.
 *
 * Shows do not start when the poster says. Doors run late, the room is slow to
 * sit down, the host takes the stage six minutes after the hour — and from
 * that moment a run sheet of wall-clock times is wrong on every single row,
 * quietly, for the rest of the night. Nobody re-times it mid-show. They do the
 * arithmetic in their head, badly, in the dark.
 *
 * So the sheet counts from zero instead. 0:00 is whenever you start running
 * it; every row after that is how long into the night that cue lands, which is
 * the number that stays true whatever time the doors actually opened. It is
 * also the number people already speak in — "we're forty minutes in", "you're
 * on at the hour" — rather than one they have to convert to.
 *
 * Offsets are stored in the same `time` field as clock times and parse through
 * `parseClockToMinutes` unchanged ("0:35" is thirty-five minutes either way),
 * so nothing downstream had to learn a second format. What differs is how they
 * are written and rendered, which is what lives here.
 */

import type { ScheduleItem } from '../types';
import { parseClockToMinutes } from './showTiming';

/** Minutes-since-midnight → "8:00 PM", wrapping past midnight. */
export function clockLabel(minutes: number): string {
  const wrapped = ((minutes % 1440) + 1440) % 1440;
  const h = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  return new Date(2000, 0, 1, h, m).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** Minutes into the show → "0:00", "0:35", "1:05", "12:20". */
export function elapsedLabel(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  return `${hours}:${String(mins).padStart(2, '0')}`;
}

/**
 * Whether a running order is timed from zero rather than off the clock.
 *
 * Told by its first cue: a sheet that opens at hour zero is counting up from
 * the top of the night, because no show's first cue is midnight. Shows built
 * before this existed still carry clock times and still read as clock times —
 * the two kinds sit side by side without either being converted behind the
 * producer's back.
 */
export function isElapsedSchedule(schedule: ScheduleItem[]): boolean {
  const first = schedule.find((cue) => parseClockToMinutes(cue.time) != null);
  if (!first) return false;
  return /^\s*0\s*:/.test(first.time) || first.time.trim() === '0';
}

/** Renders minutes the way this schedule already writes them. */
export function timeLabelFor(schedule: ScheduleItem[]): (minutes: number) => string {
  return isElapsedSchedule(schedule) ? elapsedLabel : clockLabel;
}

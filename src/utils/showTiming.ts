import type { ScheduleItem } from '../types';

// Cue-duration bounds shared by Run Show and its timing helpers.
export const DEFAULT_CUE_SECONDS = 5 * 60;
export const MIN_CUE_SECONDS = 30;

/** Parse a wall-clock time ("7:00 PM", "19:00", "7pm") to minutes-since-midnight, or null. */
export function parseClockToMinutes(time: string | undefined): number | null {
  if (!time) return null;
  const m = time.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const mins = m[2] ? parseInt(m[2], 10) : 0;
  const meridiem = m[3]?.toLowerCase();
  if (meridiem === 'pm' && h < 12) h += 12;
  if (meridiem === 'am' && h === 12) h = 0;
  if (h > 23 || mins > 59) return null;
  return h * 60 + mins;
}

/** Pull an explicit duration out of a cue, e.g. "Host transition (1 min)" or "Intro 90 sec". */
export function parseDurationSeconds(text: string | undefined): number | null {
  if (!text) return null;
  const min = text.match(/(\d+(?:\.\d+)?)\s*min/i);
  if (min) return Math.round(parseFloat(min[1]) * 60);
  const sec = text.match(/(\d+)\s*sec/i);
  if (sec) return parseInt(sec[1], 10);
  return null;
}

/**
 * Whole minutes from one clock time to another, or null if either won't parse
 * or the pair doesn't describe a forward span.
 *
 * A schedule that says "8:00–8:20" has already stated how long that segment
 * runs; this is what reads it. An end earlier than the start is treated as
 * crossing midnight, because a late show genuinely does — "11:40 PM–12:10 AM"
 * is thirty minutes, not a negative number. Anything longer than a night is
 * refused rather than guessed at.
 */
const MINUTES_IN_DAY = 24 * 60;
const MAX_SPAN_MINUTES = 12 * 60;

/**
 * "8:00" alongside "8:20 PM" → "8:00 PM".
 *
 * A written range states the meridiem once, at the end — nobody types
 * "8:00 PM–8:20 PM". Read literally the start of that range is eight in the
 * morning, which turns a twenty-minute set into a twelve-hour one.
 */
export function borrowMeridiem(start: string, end: string | undefined): string {
  if (!end || /[ap]\.?m\.?/i.test(start)) return start;
  const meridiem = end.match(/([ap])\.?m\.?/i)?.[1];
  return meridiem ? `${start.trim()} ${meridiem.toLowerCase()}m` : start;
}

export function minutesBetweenClock(
  start: string | undefined,
  end: string | undefined,
): number | null {
  const a = parseClockToMinutes(start ? borrowMeridiem(start, end) : start);
  const b = parseClockToMinutes(end);
  if (a == null || b == null) return null;
  const span = b >= a ? b - a : b + MINUTES_IN_DAY - a;
  if (span <= 0 || span > MAX_SPAN_MINUTES) return null;
  return span;
}

/**
 * The base (pre-adjustment) length in seconds for each cue. An explicit
 * per-segment length wins; otherwise the gap to the next clock time; otherwise
 * a duration parsed from the description; otherwise the default.
 */
export function baseDurations(schedule: ScheduleItem[]): number[] {
  const clock = schedule.map((s) => parseClockToMinutes(s.time));
  return schedule.map((s, i) => {
    if (s.durationMin && s.durationMin > 0) return Math.max(MIN_CUE_SECONDS, s.durationMin * 60);
    const cur = clock[i];
    const next = clock[i + 1];
    if (cur != null && next != null && next > cur) return (next - cur) * 60;
    const fromText = parseDurationSeconds(s.description);
    if (fromText != null) return Math.max(MIN_CUE_SECONDS, fromText);
    return DEFAULT_CUE_SECONDS;
  });
}

/** A cue with no length of its own. */
export function isUntimed(cue: ScheduleItem): boolean {
  return !(cue.durationMin && cue.durationMin > 0);
}

/**
 * Write the length the show is *already* running each cue at into the cue.
 *
 * baseDurations always returns a number — from the gap to the next cue, from a
 * duration in the text, or from the default — so a cue with an empty minutes
 * field is not an untimed cue, it's a cue whose timing is implied and invisible.
 * That's why an imported show reads "Cues timed 0/N" while Run Show counts it
 * down quite happily.
 *
 * Filling them in changes nothing about how the show runs: every value written
 * here is the value that was going to be used anyway. What it changes is that
 * you can now see the numbers, edit them, and have the readiness count tell the
 * truth. Deliberately not automatic — freezing a length that was tracking the
 * gap to the next cue is a real change of behaviour once you edit a time
 * afterwards, and that should be a decision, not a side effect of opening a
 * show.
 */
export function fillCueDurations(
  schedule: ScheduleItem[],
): { schedule: ScheduleItem[]; filled: number } {
  const seconds = baseDurations(schedule);
  let filled = 0;
  const next = schedule.map((cue, i) => {
    if (!isUntimed(cue)) return cue;
    filled++;
    return { ...cue, durationMin: Math.max(1, Math.round(seconds[i] / 60)) };
  });
  return { schedule: filled > 0 ? next : schedule, filled };
}

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

/** MM:SS, or H:MM:SS once we cross an hour. Used for the planned segment range. */
export function fmtOffset(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

/** HH:MM:SS for the running show clock. */
export function fmtShowTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

/** MM:SS countdown, negative once a cue runs over. */
export function fmtCountdown(seconds: number): string {
  const neg = seconds < 0;
  const s = Math.abs(Math.floor(seconds));
  return `${neg ? '-' : ''}${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
}

/** "Description (N min)" label for the up-next cue, unless it already states a length. */
export function nextUpLabel(desc: string, durationSec: number): string {
  const mins = Math.max(1, Math.round(durationSec / 60));
  if (/\d+\s*(min|sec)/i.test(desc)) return desc;
  return `${desc} (${mins} min)`;
}

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

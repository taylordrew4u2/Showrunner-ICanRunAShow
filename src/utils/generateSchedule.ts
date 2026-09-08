/**
 * Building a run-of-show from the lineup you already booked.
 *
 * The rule this exists for: a comic never follows a comic. Between two acts the
 * host has to bring one off and the next on, and that takes a real minute. Hand-
 * built schedules almost never write it down — so the time gets spent anyway and
 * the show runs late by exactly the number of handovers in it. Here the handover
 * is a cue like any other, with a time against it, so the end time you are shown
 * is the end time you will get.
 */

import { generateId } from './id';
import type { Performer, ScheduleItem } from '../types';

/** One booked act, and how long they have. */
export interface ScheduleAct {
  performer: Performer;
  /** Their set length. Falls back to `defaultSetMin` when not set. */
  durationMin?: number;
  /** What the slot is called on the sheet, e.g. "Feature". */
  role?: string;
}

export interface GenerateScheduleOptions {
  /** When the room opens, as `Show.time` holds it: "HH:MM". */
  startTime: string;
  acts: ScheduleAct[];
  /** Who is running the night. Without one, no handover cues are written. */
  hostName?: string;
  /** How long the room is open before the first cue. */
  doorsMin?: number;
  /** The host's opening, which carries the first act's introduction. */
  welcomeMin?: number;
  /** The host's handover before every act after the first. */
  introMin?: number;
  /** Used for any act with no length of its own. */
  defaultSetMin?: number;
  /** Put an interval after this many acts. 0 or undefined means none. */
  intermissionAfter?: number;
  intermissionMin?: number;
  /** The host's close. 0 means don't write one. */
  outroMin?: number;
}

const DEFAULTS = {
  doorsMin: 30,
  welcomeMin: 5,
  introMin: 1,
  defaultSetMin: 10,
  intermissionMin: 10,
  outroMin: 4,
};

/** Read "20:30" as minutes past midnight. Null when it isn't a time. */
export function parseClock(input: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(input.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/** Print minutes past midnight as "HH:MM", wrapping past midnight. */
export function formatClock(totalMinutes: number): string {
  const wrapped = ((Math.round(totalMinutes) % 1440) + 1440) % 1440;
  const hours = Math.floor(wrapped / 60);
  const minutes = wrapped % 60;
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
}

/**
 * The cue list for a night, timed from doors.
 *
 * Returns an empty list rather than guessing when the start time is unreadable —
 * a schedule hung off the wrong hour is worse than no schedule.
 */
export function generateSchedule(options: GenerateScheduleOptions): ScheduleItem[] {
  const start = parseClock(options.startTime);
  if (start === null) return [];

  const doorsMin = options.doorsMin ?? DEFAULTS.doorsMin;
  const welcomeMin = options.welcomeMin ?? DEFAULTS.welcomeMin;
  const introMin = options.introMin ?? DEFAULTS.introMin;
  const defaultSetMin = options.defaultSetMin ?? DEFAULTS.defaultSetMin;
  const intermissionMin = options.intermissionMin ?? DEFAULTS.intermissionMin;
  const outroMin = options.outroMin ?? DEFAULTS.outroMin;
  const host = options.hostName?.trim();

  const items: ScheduleItem[] = [];
  let cursor = start;

  const push = (
    description: string,
    durationMin: number,
    performer?: string,
    performerId?: string,
  ) => {
    if (durationMin <= 0) return;
    items.push({
      id: generateId(),
      time: formatClock(cursor),
      description,
      durationMin,
      ...(performer ? { performer } : {}),
      ...(performerId ? { performerId } : {}),
    });
    cursor += durationMin;
  };

  push('Doors — house music', doorsMin);
  if (host) push('Welcome, rules, first intro', welcomeMin, host);

  options.acts.forEach((act, index) => {
    // The handover the host actually performs, given its own line. Skipped
    // before the first act, whose introduction lives inside the welcome.
    if (host && index > 0) {
      push(`Intro — ${act.performer.name}`, introMin, host);
    }

    push(
      act.role ?? 'Set',
      act.durationMin ?? defaultSetMin,
      act.performer.name,
      act.performer.id,
    );

    const isLast = index === options.acts.length - 1;
    if (options.intermissionAfter && index + 1 === options.intermissionAfter && !isLast) {
      push('Intermission', intermissionMin);
    }
  });

  if (host) push('Outro and plugs', outroMin, host);

  return items;
}

/** How long the whole night runs, in minutes. */
export function scheduleRuntime(items: ScheduleItem[]): number {
  return items.reduce((total, item) => total + (item.durationMin ?? 0), 0);
}

/** When the last cue ends, as "HH:MM". Empty when the start is unreadable. */
export function scheduleEndTime(startTime: string, items: ScheduleItem[]): string {
  const start = parseClock(startTime);
  if (start === null) return '';
  return formatClock(start + scheduleRuntime(items));
}

/**
 * Minutes of the night that are the host doing handovers.
 *
 * Worth showing back to a producer: it is usually more than they expect, and it
 * is the number that explains why the show ends when it does.
 */
export function handoverRuntime(items: ScheduleItem[]): number {
  return items
    .filter((item) => item.description.startsWith('Intro — '))
    .reduce((total, item) => total + (item.durationMin ?? 0), 0);
}

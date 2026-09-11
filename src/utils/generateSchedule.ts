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
import { parseClockToMinutes } from './showTiming';
import { clockLabel } from './showTimeline';
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
  /** When the first thing happens on stage, however `Show.time` holds it. */
  startTime: string;
  acts: ScheduleAct[];
  /** Who is running the night. Without one, no handover cues are written. */
  hostName?: string;
  /** How long the room is open *before* `startTime`. */
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

/**
 * The cue list for a night, timed from doors.
 *
 * Returns an empty list rather than guessing when the start time is unreadable —
 * a schedule hung off the wrong hour is worse than no schedule.
 */
export function generateSchedule(options: GenerateScheduleOptions): ScheduleItem[] {
  const start = parseClockToMinutes(options.startTime);
  if (start === null) return [];

  const doorsMin = options.doorsMin ?? DEFAULTS.doorsMin;
  const welcomeMin = options.welcomeMin ?? DEFAULTS.welcomeMin;
  const introMin = options.introMin ?? DEFAULTS.introMin;
  const defaultSetMin = options.defaultSetMin ?? DEFAULTS.defaultSetMin;
  const intermissionMin = options.intermissionMin ?? DEFAULTS.intermissionMin;
  const outroMin = options.outroMin ?? DEFAULTS.outroMin;
  const host = options.hostName?.trim();

  const items: ScheduleItem[] = [];
  // Doors run up to the start time, not from it. A show billed at 8 with
  // thirty minutes of doors opens the room at 7:30 and starts at 8 — it does
  // not start at 8:35. Timing doors forward from the billed time quietly moved
  // every act half an hour later than the poster said, which is the one number
  // an audience actually holds you to.
  let cursor = start - doorsMin;

  const push = (
    description: string,
    durationMin: number,
    performer?: string,
    performerId?: string,
  ) => {
    if (durationMin <= 0) return;
    items.push({
      id: generateId(),
      time: clockLabel(cursor),
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
  // From the top of the sheet, which is doors when there are doors — not from
  // the billed start time, or the night reads half an hour longer than it is.
  const first = parseClockToMinutes(items[0]?.time) ?? parseClockToMinutes(startTime);
  if (first === null) return '';
  return clockLabel(first + scheduleRuntime(items));
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

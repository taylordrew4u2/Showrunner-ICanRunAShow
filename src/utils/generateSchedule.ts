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
import { elapsedLabel } from './elapsed';
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
  acts: ScheduleAct[];
  /** Who is running the night. Without one, no handover cues are written. */
  hostName?: string;
  /** How long the room is open before the first thing on stage. */
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
 * The cue list for a night, timed from the top of the sheet.
 *
 * 0:00 is whenever you start running it — doors, when there are doors. Not a
 * wall-clock time: shows do not start when the poster says, and from the
 * moment the first one slips, a sheet of clock times is wrong on every row for
 * the rest of the night. How far into the show a cue lands is the one number
 * that stays true, and it is the number people already speak in.
 */
export function generateSchedule(options: GenerateScheduleOptions): ScheduleItem[] {
  const doorsMin = options.doorsMin ?? DEFAULTS.doorsMin;
  const welcomeMin = options.welcomeMin ?? DEFAULTS.welcomeMin;
  const introMin = options.introMin ?? DEFAULTS.introMin;
  const defaultSetMin = options.defaultSetMin ?? DEFAULTS.defaultSetMin;
  const intermissionMin = options.intermissionMin ?? DEFAULTS.intermissionMin;
  const outroMin = options.outroMin ?? DEFAULTS.outroMin;
  const host = options.hostName?.trim();

  const items: ScheduleItem[] = [];
  let cursor = 0;

  const push = (
    description: string,
    durationMin: number,
    performer?: string,
    performerId?: string,
  ) => {
    if (durationMin <= 0) return;
    items.push({
      id: generateId(),
      time: elapsedLabel(cursor),
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

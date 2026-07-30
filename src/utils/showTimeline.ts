import type { ScheduleItem } from '../types';
import { baseDurations, parseClockToMinutes } from './showTiming';

/**
 * The shape of the night, as one proportional strip.
 *
 * A run-of-show is a list of rows, and a list is a bad way to answer the
 * questions people actually ask before a door opens: is the first half twice
 * the second? Is anybody on for fifteen minutes while everyone else gets six?
 * Where does the night sag? Those are proportions, and proportions are seen,
 * not read.
 *
 * Durations come from `baseDurations` — the same function Run Show uses — so
 * the picture is of the night that will actually be run, not a second estimate
 * that drifts from it.
 */

export type SegmentKind = 'set' | 'break';

export interface TimelineSegment {
  id: string;
  label: string;
  performer?: string;
  /** Seconds from the top of the show. */
  startSec: number;
  durationSec: number;
  /** Position and size as a share of the whole night, for the strip. */
  startPct: number;
  widthPct: number;
  /** Wall clock this segment starts at, once the show's start time is known. */
  clock: string | null;
  /** A cue with someone on stage, versus doors/turnaround/reset. */
  kind: SegmentKind;
  /** Share of the night, for the "who has the room longest" read. */
  sharePct: number;
}

export interface Timeline {
  segments: TimelineSegment[];
  totalSec: number;
  /** Minutes-since-midnight of the top of the show, when it can be derived. */
  startMinutes: number | null;
  endMinutes: number | null;
  /** The longest single segment, which is what sets the eye's reference. */
  longestId: string | null;
}

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

/**
 * Where the night starts: the first cue that carries a clock time, backed off
 * by everything scheduled before it. A run sheet whose first timed cue is the
 * third row still knows when the doors opened.
 */
function startMinutesFor(schedule: ScheduleItem[], durations: number[], showTime?: string): number | null {
  let offset = 0;
  for (let i = 0; i < schedule.length; i++) {
    const cue = parseClockToMinutes(schedule[i].time);
    if (cue != null) return cue - Math.round(offset / 60);
    offset += durations[i];
  }
  return parseClockToMinutes(showTime);
}

export function buildTimeline(schedule: ScheduleItem[], showTime?: string): Timeline | null {
  if (schedule.length === 0) return null;

  const durations = baseDurations(schedule);
  const totalSec = durations.reduce((sum, d) => sum + d, 0);
  if (totalSec <= 0) return null;

  const startMinutes = startMinutesFor(schedule, durations, showTime);

  let offset = 0;
  let longestId: string | null = null;
  let longest = -1;

  const segments = schedule.map((cue, i) => {
    const durationSec = durations[i];
    const startSec = offset;
    offset += durationSec;

    if (durationSec > longest) {
      longest = durationSec;
      longestId = cue.id;
    }

    const performer = cue.performer?.trim() || undefined;
    return {
      id: cue.id,
      label: cue.description?.trim() || 'Untitled cue',
      performer,
      startSec,
      durationSec,
      startPct: (startSec / totalSec) * 100,
      widthPct: (durationSec / totalSec) * 100,
      sharePct: (durationSec / totalSec) * 100,
      clock: startMinutes == null ? null : clockLabel(startMinutes + Math.round(startSec / 60)),
      kind: (performer ? 'set' : 'break') as SegmentKind,
    };
  });

  return {
    segments,
    totalSec,
    startMinutes,
    endMinutes: startMinutes == null ? null : startMinutes + Math.round(totalSec / 60),
    longestId,
  };
}

/** "6 min", "1 hr 5 min" — segment lengths, where "0 min" would be a lie. */
export function segmentLength(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} min`;
  if (rest === 0) return `${hours} hr`;
  return `${hours} hr ${rest} min`;
}

/**
 * How lopsided the bill is: the longest set over the shortest, counting only
 * cues with someone on stage. Doors and turnarounds are meant to be short, so
 * including them would report every show as wildly uneven.
 *
 * Null when there's nothing to compare — fewer than two sets.
 */
export function billBalance(segments: TimelineSegment[]): { ratio: number; longest: TimelineSegment; shortest: TimelineSegment } | null {
  const sets = segments.filter((s) => s.kind === 'set');
  if (sets.length < 2) return null;
  let longest = sets[0];
  let shortest = sets[0];
  for (const s of sets) {
    if (s.durationSec > longest.durationSec) longest = s;
    if (s.durationSec < shortest.durationSec) shortest = s;
  }
  if (shortest.durationSec <= 0) return null;
  return { ratio: longest.durationSec / shortest.durationSec, longest, shortest };
}

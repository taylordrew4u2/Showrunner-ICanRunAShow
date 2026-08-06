/**
 * Reusable run-of-show templates, and the one piece of cue-time math they need.
 *
 * `showTiming` already reads times and lengths in one direction: given clock
 * times, `fillCueDurations` writes down how long each cue runs. This is the
 * other direction — given lengths, work out the clock times — which is what a
 * saved template needs, because a template carries last week's times and has
 * to be re-anchored to tonight's start.
 */
import type { ScheduleItem, ScheduleTemplateItem } from '../types';
import { parseClockToMinutes } from './showTiming';
import { clockLabel } from './showTimeline';

/**
 * Set each cue's time by running the lengths forward from the first cue.
 *
 * Stops at the first cue whose predecessor has no length — past that point the
 * clock is genuinely unknown, so those cues keep the times the producer gave
 * them rather than being silently shifted onto a guess.
 */
export function timesFromLengths(items: ScheduleItem[]): ScheduleItem[] {
  let clock = parseClockToMinutes(items[0]?.time);
  if (clock == null) return items;
  return items.map((item, i) => {
    if (i === 0) return item;
    const prevLength = items[i - 1]?.durationMin;
    if (clock == null || !prevLength || prevLength <= 0) {
      clock = null;
      return item;
    }
    // clockLabel wraps past midnight, so a late show reads 12:10 AM rather
    // than a 25th hour.
    clock += prevLength;
    return { ...item, time: clockLabel(clock) };
  });
}

/**
 * True when the running order can be re-timed: an anchor time on the first cue,
 * and a written length on every cue that has one after it.
 */
export function canDeriveTimes(items: ScheduleItem[]): boolean {
  if (items.length < 2) return false;
  if (parseClockToMinutes(items[0].time) == null) return false;
  return items.slice(0, -1).every((i) => !!i.durationMin && i.durationMin > 0);
}

/**
 * Strip a live schedule down to what's safe and meaningful to reuse.
 *
 * Ids and performer links belong to one show, and uploaded audio would put an
 * unbounded blob in the settings payload — which has a hard size ceiling that
 * blocks every settings save once crossed. Templates stay plain text.
 */
export function toTemplateItems(schedule: ScheduleItem[]): ScheduleTemplateItem[] {
  return schedule.map((item) => ({
    time: item.time,
    description: item.description,
    performer: item.performer || undefined,
    durationMin: item.durationMin,
  }));
}

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ScheduleItem } from '../types';
import { clockLabel } from './elapsed';
import { parseClockToMinutes } from './showTiming';
import { normaliseShowTime } from './readShowStart';
import { canDeriveTimes, timesFromLengths } from './scheduleTemplates';

const at = (h: number, m = 0) => h * 60 + m;

function cue(partial: Partial<ScheduleItem> & { id: string }): ScheduleItem {
  return { time: '', description: 'Segment', ...partial };
}

/**
 * A phone set to English (Canada) prints "8:30 p.m."; Korean prints "PM 8:30";
 * French Canadian prints "20 h 30". The stored time has to read back on every
 * one of them, so these stand in for a device whose locale is not en-US.
 */
function onADeviceThatPrints(sample: string) {
  vi.spyOn(Date.prototype, 'toLocaleTimeString').mockReturnValue(sample);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the clock time the app writes down', () => {
  it('is the one form its own parser reads, whatever the device locale', () => {
    onADeviceThatPrints('8:30 p.m.');
    expect(clockLabel(at(20, 30))).toBe('8:30 PM');
    expect(parseClockToMinutes(clockLabel(at(20, 30)))).toBe(at(20, 30));

    onADeviceThatPrints('PM 8:30');
    expect(clockLabel(at(20, 30))).toBe('8:30 PM');

    onADeviceThatPrints('20 h 30');
    expect(clockLabel(at(20, 30))).toBe('8:30 PM');
  });

  it('reads as a clock at both ends of the day', () => {
    expect(clockLabel(0)).toBe('12:00 AM');
    expect(clockLabel(at(0, 10))).toBe('12:10 AM');
    expect(clockLabel(at(12))).toBe('12:00 PM');
    expect(clockLabel(at(12, 5))).toBe('12:05 PM');
    expect(clockLabel(at(9))).toBe('9:00 AM');
    expect(clockLabel(at(23, 59))).toBe('11:59 PM');
  });

  it('survives a round trip through the parser for every minute of the day', () => {
    for (let minutes = 0; minutes < 24 * 60; minutes++) {
      expect(parseClockToMinutes(clockLabel(minutes))).toBe(minutes);
    }
  });

  // The Show Time field rewrites itself on blur; on an en-CA phone that used
  // to leave a string the timeline could not read, and re-editing produced
  // the same string again, so there was no way out.
  it('keeps the Show Time field readable after it tidies itself on a Canadian phone', () => {
    onADeviceThatPrints('8:00 p.m.');
    const tidy = normaliseShowTime('8pm');
    expect(tidy).toBe('8:00 PM');
    expect(parseClockToMinutes(tidy ?? undefined)).toBe(at(20));
    // Tidying the tidied value changes nothing, so blur does not churn.
    expect(normaliseShowTime(tidy ?? undefined)).toBe(tidy);
  });

  it('keeps "Re-time from lengths" re-timeable on a Canadian phone', () => {
    onADeviceThatPrints('8:30 p.m.');
    const retimed = timesFromLengths([
      cue({ id: '1', time: '8:00 PM', durationMin: 30 }),
      cue({ id: '2', time: '', durationMin: 15 }),
      cue({ id: '3', time: '' }),
    ]);
    expect(retimed.map((r) => r.time)).toEqual(['8:00 PM', '8:30 PM', '8:45 PM']);
    // The button must not vanish the moment it has been pressed once.
    expect(canDeriveTimes(retimed)).toBe(true);
  });
});

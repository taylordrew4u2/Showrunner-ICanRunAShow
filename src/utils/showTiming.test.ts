import { describe, expect, it } from 'vitest';
import type { ScheduleItem } from '../types';
import {
  DEFAULT_CUE_SECONDS,
  baseDurations,
  fmtCountdown,
  fmtOffset,
  fmtShowTime,
  nextUpLabel,
  parseClockToMinutes,
  parseDurationSeconds,
} from './showTiming';

function cue(partial: Partial<ScheduleItem>): ScheduleItem {
  return { id: 'x', time: '', description: '', ...partial };
}

describe('parseClockToMinutes', () => {
  it('parses 12-hour times with meridiem', () => {
    expect(parseClockToMinutes('7:00 PM')).toBe(19 * 60);
    expect(parseClockToMinutes('7pm')).toBe(19 * 60);
    expect(parseClockToMinutes('12 am')).toBe(0);
    expect(parseClockToMinutes('12 pm')).toBe(12 * 60);
  });

  it('parses 24-hour times', () => {
    expect(parseClockToMinutes('19:30')).toBe(19 * 60 + 30);
    expect(parseClockToMinutes('00:00')).toBe(0);
  });

  it('returns null for empty or invalid input', () => {
    expect(parseClockToMinutes(undefined)).toBeNull();
    expect(parseClockToMinutes('')).toBeNull();
    expect(parseClockToMinutes('not a time')).toBeNull();
    expect(parseClockToMinutes('25:00')).toBeNull();
    expect(parseClockToMinutes('10:75')).toBeNull();
  });
});

describe('parseDurationSeconds', () => {
  it('reads minutes and seconds from text', () => {
    expect(parseDurationSeconds('Host transition (1 min)')).toBe(60);
    expect(parseDurationSeconds('Intro 1.5 min')).toBe(90);
    expect(parseDurationSeconds('Sting 90 sec')).toBe(90);
  });

  it('returns null when no duration is present', () => {
    expect(parseDurationSeconds('Opening set')).toBeNull();
    expect(parseDurationSeconds(undefined)).toBeNull();
  });
});

describe('baseDurations', () => {
  it('prefers an explicit per-segment length', () => {
    expect(baseDurations([cue({ durationMin: 4 })])).toEqual([240]);
  });

  it('falls back to the gap between clock times', () => {
    const out = baseDurations([cue({ time: '7:00 PM' }), cue({ time: '7:20 PM' })]);
    expect(out[0]).toBe(20 * 60);
  });

  it('uses a duration parsed from the description', () => {
    expect(baseDurations([cue({ description: 'Break (2 min)' })])[0]).toBe(120);
  });

  it('uses the default when nothing else is known', () => {
    expect(baseDurations([cue({})])[0]).toBe(DEFAULT_CUE_SECONDS);
  });
});

describe('formatting helpers', () => {
  it('fmtCountdown shows MM:SS and a leading minus when negative', () => {
    expect(fmtCountdown(90)).toBe('01:30');
    expect(fmtCountdown(-5)).toBe('-00:05');
  });

  it('fmtOffset rolls over to H:MM:SS past an hour', () => {
    expect(fmtOffset(65)).toBe('01:05');
    expect(fmtOffset(3661)).toBe('1:01:01');
  });

  it('fmtShowTime is HH:MM:SS', () => {
    expect(fmtShowTime(3661)).toBe('01:01:01');
  });

  it('nextUpLabel appends a minute estimate unless one is present', () => {
    expect(nextUpLabel('Opening set', 180)).toBe('Opening set (3 min)');
    expect(nextUpLabel('Break 5 min', 300)).toBe('Break 5 min');
  });
});

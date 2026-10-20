import { describe, expect, it } from 'vitest';
import type { ScheduleItem } from '../types';
import {
  DEFAULT_CUE_SECONDS,
  baseDurations,
  MIN_CUE_SECONDS,
  carryCueClock,
  fillCueDurations,
  isUntimed,
  fmtCountdown,
  fmtOffset,
  fmtShowTime,
  nextUpLabel,
  nudgeAdjustment,
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

  it('follows a late show across midnight instead of giving the last cue five minutes', () => {
    const out = baseDurations([cue({ time: '11:45 PM' }), cue({ time: '12:15 AM' })]);
    expect(out[0]).toBe(30 * 60);
  });

  it('does not read two cues at the same time, or a gap longer than a night, as a length', () => {
    expect(baseDurations([cue({ time: '8:00 PM' }), cue({ time: '8:00 PM' })])[0]).toBe(DEFAULT_CUE_SECONDS);
    expect(baseDurations([cue({ time: '8:00 PM' }), cue({ time: '9:00 AM' })])[0]).toBe(DEFAULT_CUE_SECONDS);
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


describe('fillCueDurations', () => {
  const cue = (over: Partial<ScheduleItem> = {}): ScheduleItem => ({
    id: Math.random().toString(36).slice(2), time: '', description: '', ...over,
  });

  it('writes the length the show was already running the cue at', () => {
    // The gap to the next cue is what baseDurations was using; filling in has
    // to produce that same number, or the show changes shape when you press it.
    const schedule = [cue({ time: '8:00 PM' }), cue({ time: '8:30 PM' })];
    const before = baseDurations(schedule);
    const { schedule: after, filled } = fillCueDurations(schedule);
    expect(filled).toBe(2);
    expect(after[0].durationMin).toBe(30);
    expect(baseDurations(after)).toEqual(before);
  });

  it('leaves a cue that already has a length alone', () => {
    const schedule = [cue({ time: '8:00 PM', durationMin: 12 }), cue({ time: '8:30 PM' })];
    const { schedule: after, filled } = fillCueDurations(schedule);
    expect(filled).toBe(1);
    expect(after[0].durationMin).toBe(12);
    expect(after[0]).toBe(schedule[0]); // untouched, same reference
  });

  it('reads a length stated in the description', () => {
    const { schedule: after } = fillCueDurations([cue({ description: 'Intermission (15 min)' })]);
    expect(after[0].durationMin).toBe(15);
  });

  it('does nothing, and keeps the same array, when every cue is timed', () => {
    const schedule = [cue({ durationMin: 5 }), cue({ durationMin: 10 })];
    const result = fillCueDurations(schedule);
    expect(result.filled).toBe(0);
    expect(result.schedule).toBe(schedule);
  });

  it('never writes a zero — a cue of no length is not a cue', () => {
    const { schedule: after } = fillCueDurations([cue({ description: 'Sting 20 sec' })]);
    expect(after[0].durationMin).toBeGreaterThanOrEqual(1);
  });

  it('agrees with isUntimed about what needs filling', () => {
    const schedule = [cue(), cue({ durationMin: 5 }), cue({ durationMin: 0 })];
    expect(schedule.filter(isUntimed)).toHaveLength(2);
    expect(fillCueDurations(schedule).filled).toBe(2);
  });
});

describe('the clock of an auto-advanced cue', () => {
  it('starts when the last cue was due to end, so a run of cues keeps to plan', () => {
    // A minute-long cue each, the clock read once a second, and the advance
    // landing a few milliseconds after the read that saw the cue run out.
    let startedAt = 0;
    const advancedAt: number[] = [];
    for (let tick = 1; advancedAt.length < 10; tick++) {
      const now = tick * 1_000;
      if (Math.floor((now - startedAt) / 1_000) >= 60) {
        advancedAt.push(now / 1_000);
        startedAt = carryCueClock(startedAt, 60, now + 4).cueStartedAt;
      }
    }
    expect(advancedAt).toEqual([60, 120, 180, 240, 300, 360, 420, 480, 540, 600]);
  });

  it('counts the time a locked phone spent past the end of the cue', () => {
    // A 5:00 cue with a minute left when the phone locked; unlocked six
    // minutes later, the next 5:00 cue has already run its course too.
    const next = carryCueClock(0, 300, 600_000);
    expect(next).toEqual({ cueStartedAt: 300_000, elapsed: 300 });
    expect(carryCueClock(next.cueStartedAt, 300, 600_000)).toEqual({ cueStartedAt: 600_000, elapsed: 0 });
  });
});

describe('nudging a cue shorter or longer', () => {
  it('moves the cue back up on the first + once it has hit the floor', () => {
    // A 5:00 cue: −2 min three times stops at 0:30. The next +30s has to
    // show, not pay back presses the screen never showed.
    let adjust = 0;
    const lengths: number[] = [];
    for (const delta of [-120, -120, -120, 30, 30, 30]) {
      adjust = nudgeAdjustment(adjust, 300, delta);
      lengths.push(Math.max(MIN_CUE_SECONDS, 300 + adjust));
    }
    expect(lengths).toEqual([180, 60, 30, 60, 90, 120]);
  });

  it('adds and takes away freely above the floor', () => {
    expect(nudgeAdjustment(0, 300, 120)).toBe(120);
    expect(nudgeAdjustment(120, 300, -30)).toBe(90);
  });
});

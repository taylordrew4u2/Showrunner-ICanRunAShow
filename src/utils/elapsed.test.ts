import { describe, expect, it } from 'vitest';
import { elapsedLabel, isElapsedSchedule, timeLabelFor } from './elapsed';
import type { ScheduleItem } from '../types';

function cue(time: string, description = 'Set'): ScheduleItem {
  return { id: time || 'x', time, description };
}

describe('timing a show by how far into it you are', () => {
  it('writes minutes the way people say them', () => {
    expect(elapsedLabel(0)).toBe('0:00');
    expect(elapsedLabel(5)).toBe('0:05');
    expect(elapsedLabel(35)).toBe('0:35');
    expect(elapsedLabel(60)).toBe('1:00');
    expect(elapsedLabel(65)).toBe('1:05');
    expect(elapsedLabel(125)).toBe('2:05');
  });

  it('does not run backwards past the top of the show', () => {
    expect(elapsedLabel(-10)).toBe('0:00');
  });

  it('knows a sheet counting from zero from one hung off the clock', () => {
    expect(isElapsedSchedule([cue('0:00', 'Doors'), cue('0:30')])).toBe(true);
    expect(isElapsedSchedule([cue('8:00 PM', 'Doors'), cue('8:30 PM')])).toBe(false);
    expect(isElapsedSchedule([cue('20:00'), cue('20:30')])).toBe(false);
  });

  // An imported sheet often has a heading row before the first timed cue.
  it('reads past untimed rows to find out which kind it is', () => {
    expect(isElapsedSchedule([cue('', 'Load in'), cue('0:00', 'Doors')])).toBe(true);
    expect(isElapsedSchedule([cue('', 'Load in'), cue('8:00 PM', 'Doors')])).toBe(false);
  });

  it('has no opinion about a sheet with no times on it at all', () => {
    expect(isElapsedSchedule([cue('', 'Doors')])).toBe(false);
    expect(isElapsedSchedule([])).toBe(false);
  });

  it('hands back the formatter the schedule already uses', () => {
    expect(timeLabelFor([cue('0:00')])(65)).toBe('1:05');
    // A clocked sheet keeps reading as the clock — neither kind is converted
    // behind the producer's back.
    expect(timeLabelFor([cue('8:00 PM')])(65)).toContain('AM');
  });
});

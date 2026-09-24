import { describe, expect, it } from 'vitest';
import { borrowMeridiem, minutesBetweenClock, parseClockToMinutes } from './showTiming';

describe('a cue time written with dots', () => {
  it('reads "8:00 p.m." the same as "8:00 PM"', () => {
    expect(parseClockToMinutes('8:00 p.m.')).toBe(20 * 60);
    expect(parseClockToMinutes('8 P.M.')).toBe(20 * 60);
    expect(parseClockToMinutes('9:15 a.m.')).toBe(9 * 60 + 15);
    expect(parseClockToMinutes('12 a.m.')).toBe(0);
  });

  it('still refuses text that only looks like a meridiem', () => {
    expect(parseClockToMinutes('8:00 pmx')).toBeNull();
    expect(parseClockToMinutes('8:00 p')).toBeNull();
  });
});

describe('a range that states the meridiem once, at the end', () => {
  it('gives the start the same half of the day as the end', () => {
    expect(borrowMeridiem('8:00', '8:20 PM')).toBe('8:00 pm');
    expect(borrowMeridiem('8:00', '8:20 a.m.')).toBe('8:00 am');
    expect(minutesBetweenClock('8:00', '8:20 PM')).toBe(20);
  });

  it('keeps the closer at night when the range crosses midnight', () => {
    // "11:30–12:00 AM" is the one shape a late show writes; the end's "am"
    // belongs to the next day, not to the start.
    expect(borrowMeridiem('11:30', '12:00 AM')).toBe('11:30 pm');
    expect(minutesBetweenClock('11:40', '12:10 AM')).toBe(30);
  });

  it('keeps a late-morning start before a noon end', () => {
    expect(borrowMeridiem('11:30', '12:00 PM')).toBe('11:30 am');
    expect(minutesBetweenClock('11:30', '12:00 PM')).toBe(30);
  });

  it('reads a start after one in the morning that ends after midnight as the night before', () => {
    expect(borrowMeridiem('10:00', '1:00 AM')).toBe('10:00 pm');
    expect(minutesBetweenClock('10:00', '1:00 AM')).toBe(180);
  });

  it('does not flip a range that stays on one side of twelve', () => {
    expect(borrowMeridiem('12:00', '12:30 AM')).toBe('12:00 am');
    expect(borrowMeridiem('12:00', '1:00 PM')).toBe('12:00 pm');
    expect(borrowMeridiem('7:00', '12:30 PM')).toBe('7:00 am');
    expect(borrowMeridiem('8:00', '11:00 PM')).toBe('8:00 pm');
  });

  it('leaves a start that already says its meridiem alone', () => {
    expect(borrowMeridiem('11:40 PM', '12:10 AM')).toBe('11:40 PM');
    expect(borrowMeridiem('8:00', undefined)).toBe('8:00');
  });
});

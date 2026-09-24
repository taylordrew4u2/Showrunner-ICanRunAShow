import { describe, expect, it } from 'vitest';
import { weeksOfMonth, dayReachedByKey } from './ShowsCalendar';

// September 2026 starts on a Tuesday and has 30 days.
const SEPT_2026 = { startOffset: 2, daysInMonth: 30 };

describe('the calendar month laid out in weeks', () => {
  it('pads the first week so the 1st sits under its weekday', () => {
    const weeks = weeksOfMonth(SEPT_2026.startOffset, SEPT_2026.daysInMonth);
    expect(weeks[0]).toEqual([null, null, 1, 2, 3, 4, 5]);
  });

  it('pads the last week out to a full seven columns', () => {
    const weeks = weeksOfMonth(SEPT_2026.startOffset, SEPT_2026.daysInMonth);
    expect(weeks).toHaveLength(5);
    expect(weeks[4]).toEqual([27, 28, 29, 30, null, null, null]);
    for (const week of weeks) expect(week).toHaveLength(7);
  });

  it('shows every day of the month exactly once', () => {
    const days = weeksOfMonth(SEPT_2026.startOffset, SEPT_2026.daysInMonth).flat().filter((d) => d !== null);
    expect(days).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
  });
});

describe('moving around the calendar with the keyboard', () => {
  const reach = (key: string, day: number) => dayReachedByKey(key, day, SEPT_2026.startOffset, SEPT_2026.daysInMonth);

  it('steps a day at a time with the left and right arrows', () => {
    expect(reach('ArrowRight', 10)).toBe(11);
    expect(reach('ArrowLeft', 10)).toBe(9);
  });

  it('steps a week at a time with the up and down arrows', () => {
    expect(reach('ArrowDown', 10)).toBe(17);
    expect(reach('ArrowUp', 10)).toBe(3);
  });

  it('jumps to the start and end of the week with Home and End', () => {
    // The 10th is a Thursday: its week runs Sunday the 6th to Saturday the 12th.
    expect(reach('Home', 10)).toBe(6);
    expect(reach('End', 10)).toBe(12);
  });

  it('stays inside the month at its edges', () => {
    expect(reach('ArrowLeft', 1)).toBe(1);
    expect(reach('ArrowUp', 3)).toBe(1);
    expect(reach('Home', 1)).toBe(1);
    expect(reach('ArrowRight', 30)).toBe(30);
    expect(reach('ArrowDown', 25)).toBe(30);
    expect(reach('End', 29)).toBe(30);
  });

  it('leaves every other key alone', () => {
    expect(reach('Enter', 10)).toBeNull();
    expect(reach('Tab', 10)).toBeNull();
    expect(reach('a', 10)).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { readShowStart, normaliseShowTime } from './readShowStart';
import { clockLabel } from './showTimeline';

const at = (h: number, m = 0) => h * 60 + m;

describe('reading the start time a producer actually typed', () => {
  it('reads a plain clock time, however it is written', () => {
    for (const text of ['9:00 PM', '9pm', '21:00', '9 p.m.']) {
      expect(readShowStart(text)?.startMinutes).toBe(at(21));
    }
  });

  // The line that used to stop the generator dead.
  it('pulls the show out of "Doors 8:30 Show 9:"', () => {
    const read = readShowStart('Doors 8:30 Show 9:');
    expect(read?.startMinutes).toBe(at(21));
    expect(read?.doorsMin).toBe(30);
  });

  it('reads the doors gap the same however the line is ordered', () => {
    expect(readShowStart('8pm doors, 8:30 show')).toMatchObject({
      startMinutes: at(20, 30),
      doorsMin: 30,
    });
    expect(readShowStart('Doors 7, show 8')).toMatchObject({
      startMinutes: at(20),
      doorsMin: 60,
    });
  });

  // Matinees exist, so this is reported rather than assumed quietly — the
  // dialog says what it read.
  it('takes a bare evening hour as evening, and says that it did', () => {
    expect(readShowStart('8')).toMatchObject({ startMinutes: at(20), assumedEvening: true });
    expect(readShowStart('8 AM')).toMatchObject({ startMinutes: at(8), assumedEvening: false });
    expect(readShowStart('20:00')?.assumedEvening).toBe(false);
  });

  it('lets one written meridiem cover the whole line', () => {
    // "doors 8:30" on its own would read as half eight in the evening anyway;
    // what matters is that an explicit AM is not overridden.
    const morning = readShowStart('Doors 10:30, show 11 AM');
    expect(morning?.startMinutes).toBe(at(11));
    expect(morning?.doorsMin).toBe(30);
  });

  it('picks the show when the line names both, not just the last number', () => {
    expect(readShowStart('Show 9:00 PM (doors 8:15 PM)')?.startMinutes).toBe(at(21));
  });

  it('ignores a doors time that cannot be doors', () => {
    // Doors after the show is a misread, not a very late audience.
    expect(readShowStart('Show 8:00 PM, doors 9:00 PM')?.doorsMin).toBeUndefined();
  });

  it('has nothing to say about text with no time in it', () => {
    expect(readShowStart('doors at sundown')).toBeNull();
    expect(readShowStart('')).toBeNull();
    expect(readShowStart(undefined)).toBeNull();
  });

  it('rewrites what was typed as the clock time the rest of the app reads', () => {
    expect(normaliseShowTime('Doors 8:30 Show 9:')).toBe(clockLabel(at(21)));
    expect(normaliseShowTime('not a time')).toBeNull();
  });
});

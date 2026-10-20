import { describe, expect, it } from 'vitest';
import { normaliseShowTime, readShowStart } from './readShowStart';

const at = (h: number, m = 0) => h * 60 + m;

/**
 * What else ends up in a Show Time field: the end of the night, the date,
 * the age limit, the ticket price. None of those is the show time, and the
 * field rewrites itself on blur, so a misread here overwrites what was typed.
 */
describe('reading the show time past everything else typed beside it', () => {
  it('takes the start of a range, not the end', () => {
    expect(readShowStart('8pm-9pm')?.startMinutes).toBe(at(20));
    expect(readShowStart('8-10pm')?.startMinutes).toBe(at(20));
    expect(readShowStart('7:30-9:30pm')?.startMinutes).toBe(at(19, 30));
    expect(readShowStart('8pm – 10pm')?.startMinutes).toBe(at(20));
    expect(readShowStart('8pm to 10pm')?.startMinutes).toBe(at(20));
    expect(readShowStart('8 to 10pm')?.startMinutes).toBe(at(20));
  });

  it('knows a range that crosses twelve started on the other side of it', () => {
    expect(readShowStart('10-1am')?.startMinutes).toBe(at(22));
    expect(readShowStart('11:30-12:30am')?.startMinutes).toBe(at(23, 30));
  });

  it('does not mistake a date for a time', () => {
    expect(readShowStart('8pm on 9/12')?.startMinutes).toBe(at(20));
    expect(readShowStart('8pm 9/12/2026')?.startMinutes).toBe(at(20));
    expect(readShowStart('8pm (Sept 12)')?.startMinutes).toBe(at(20));
    expect(readShowStart('8pm, Sept. 12th')?.startMinutes).toBe(at(20));
    expect(readShowStart('8pm on the 12th')?.startMinutes).toBe(at(20));
    expect(readShowStart('Sat 12 Sept, 8pm')?.startMinutes).toBe(at(20));
  });

  it('does not mistake an age limit or a price for a time', () => {
    expect(readShowStart('8pm 21+')?.startMinutes).toBe(at(20));
    expect(readShowStart('8:30pm (18+)')?.startMinutes).toBe(at(20, 30));
    expect(readShowStart('8pm $10')?.startMinutes).toBe(at(20));
    expect(readShowStart('8pm, $15 at the door')?.startMinutes).toBe(at(20));
  });

  it('has no time to read out of a bare age limit or price', () => {
    expect(readShowStart('21+')).toBeNull();
    expect(readShowStart('$10')).toBeNull();
    expect(readShowStart('9/12')).toBeNull();
  });

  it('still reads doors-then-show when two plain times are a doors gap apart', () => {
    expect(readShowStart('7:30 8:30')?.startMinutes).toBe(at(20, 30));
  });

  it('rewrites the field to the start it read, not to whatever number came last', () => {
    expect(normaliseShowTime('8pm-9pm')).toBe('8:00 PM');
    expect(normaliseShowTime('8pm 21+')).toBe('8:00 PM');
    expect(normaliseShowTime('8pm on 9/12')).toBe('8:00 PM');
  });
});

/**
 * Outside the US a time is as often written with a dot as a colon — "7.30pm",
 * "20.30" — and in much of Europe with an h: "19h30". Read with only the colon
 * rule, the minutes fell off and the field rewrote itself on the hour.
 */
describe('reading a time written with a dot or an h', () => {
  it('keeps the minutes of a dotted time', () => {
    expect(readShowStart('8.30pm')?.startMinutes).toBe(at(20, 30));
    expect(readShowStart('7.30 p.m.')?.startMinutes).toBe(at(19, 30));
    expect(readShowStart('20.30')?.startMinutes).toBe(at(20, 30));
    expect(readShowStart('Show at 8.45.')?.startMinutes).toBe(at(20, 45));
  });

  it('keeps the minutes of a time written with an h', () => {
    expect(readShowStart('19h30')?.startMinutes).toBe(at(19, 30));
    expect(readShowStart('20H15')?.startMinutes).toBe(at(20, 15));
  });

  it('reads doors and show both written with dots', () => {
    expect(readShowStart('Doors 7.30pm, show 8.15pm')).toMatchObject({
      startMinutes: at(20, 15),
      doorsMin: 45,
    });
  });

  it('rewrites a dotted time to the clock time, not to the hour', () => {
    expect(normaliseShowTime('7.30pm')).toBe('7:30 PM');
    expect(normaliseShowTime('19h30')).toBe('7:30 PM');
  });

  // A dot also writes the date — "19.10" is the nineteenth of October as
  // easily as ten past seven — so a dotted number that could be a month is
  // only a time when the line says pm or am beside it.
  it('does not take a dotted date for a time', () => {
    expect(readShowStart('9.12')).toBeNull();
    expect(readShowStart('19.10.2026')).toBeNull();
    expect(readShowStart('Fri 19.10, 8pm')?.startMinutes).toBe(at(20));
    expect(readShowStart('8pm, 19.10.2026')?.startMinutes).toBe(at(20));
    expect(readShowStart('9.12pm')?.startMinutes).toBe(at(21, 12));
  });

  it('does not read the pence of a price as a time', () => {
    expect(readShowStart('8pm, £7.50 on the door')?.startMinutes).toBe(at(20));
    expect(readShowStart('$12.50')).toBeNull();
    // The 15 used to be read on its own, as three in the afternoon.
    expect(readShowStart('$7.15')).toBeNull();
    expect(readShowStart('€7.45')).toBeNull();
  });
});

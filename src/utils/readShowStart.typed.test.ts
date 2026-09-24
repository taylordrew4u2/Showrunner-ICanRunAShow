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

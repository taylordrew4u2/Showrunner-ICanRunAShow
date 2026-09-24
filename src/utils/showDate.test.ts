import { describe, expect, it } from 'vitest';
import { parseShowDate, showStartISO } from './showDate';

describe('the moment a show starts, for a machine on another clock', () => {
  it('is the local evening the producer typed, whatever the time was written as', () => {
    const expected = new Date(2026, 8, 24, 20, 0).toISOString();
    expect(showStartISO('2026-09-24', '8:00 PM')).toBe(expected);
    expect(showStartISO('2026-09-24', '20:00')).toBe(expected);
    expect(showStartISO('2026-09-24', '8pm')).toBe(expected);
  });

  it('says nothing rather than something wrong when the time will not parse', () => {
    // A bare date used to go out as-is and read as UTC midnight: the evening
    // before, in New York.
    expect(showStartISO('2026-09-24', '')).toBeUndefined();
    expect(showStartISO('2026-09-24', 'doors 8ish')).toBeUndefined();
    expect(showStartISO('', '8:00 PM')).toBeUndefined();
  });
});

describe('reading a stored show date', () => {
  it('lands on the calendar day that was typed, not the UTC one', () => {
    const day = parseShowDate('2026-09-24');
    expect(day?.getFullYear()).toBe(2026);
    expect(day?.getMonth()).toBe(8);
    expect(day?.getDate()).toBe(24);
    expect(day?.getHours()).toBe(0);
  });
});

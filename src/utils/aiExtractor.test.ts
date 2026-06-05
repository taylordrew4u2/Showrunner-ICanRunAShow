import { describe, expect, it } from 'vitest';
import { parseScheduleManually } from './aiExtractor';

describe('parseScheduleManually', () => {
  it('extracts time + description from each line', () => {
    const items = parseScheduleManually('7:00 PM Doors open\n7:30 PM Host intro\n8:00 PM Headliner');
    expect(items.map((i) => [i.time, i.description])).toEqual([
      ['7:00 PM', 'Doors open'],
      ['7:30 PM', 'Host intro'],
      ['8:00 PM', 'Headliner'],
    ]);
  });

  it('handles ranges by dropping the range-end time', () => {
    const items = parseScheduleManually('8:00–8:20 PM Devon');
    expect(items).toHaveLength(1);
    expect(items[0].description).toBe('Devon');
  });

  it('strips leading bullets and separators', () => {
    const items = parseScheduleManually('• 9:00 PM — Closing set');
    expect(items[0].description).toBe('Closing set');
  });

  it('skips lines without a time', () => {
    expect(parseScheduleManually('Just a note\nAnother line')).toEqual([]);
  });

  it('keeps a description that merely starts with a number', () => {
    const items = parseScheduleManually('7:00 PM 5 min break');
    expect(items[0].description).toBe('5 min break');
  });
});

import { describe, it, expect } from 'vitest';
import { buildSampleShow } from './sampleShow';
import { parseClockToMinutes } from './showTiming';

describe('the sample show', () => {
  const sample = buildSampleShow(new Date(2026, 9, 5));

  it('is a week out, so it lands under upcoming', () => {
    expect(sample.date).toBe('2026-10-12');
    expect(sample.status).toBe('upcoming');
    expect(sample.sample).toBe(true);
  });

  it('runs cue to cue with no gaps, from doors at 7:30 to the show at 8', () => {
    expect(sample.schedule[0].time).toBe('7:30 PM');
    expect(sample.schedule[1].time).toBe('8:00 PM');
    for (let i = 1; i < sample.schedule.length; i++) {
      const prev = sample.schedule[i - 1];
      expect(parseClockToMinutes(sample.schedule[i].time)).toBe(
        (parseClockToMinutes(prev.time) ?? 0) + (prev.durationMin ?? 0),
      );
    }
  });

  it('puts nobody in the lineup, so no made-up people end up in the Rolodex', () => {
    expect(sample.performers).toEqual([]);
    expect(sample.artists).toEqual([]);
  });
});

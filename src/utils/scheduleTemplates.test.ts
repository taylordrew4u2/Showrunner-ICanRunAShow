import { describe, expect, it } from 'vitest';
import type { ScheduleItem } from '../types';
import { canDeriveTimes, timesFromLengths, toTemplateItems } from './scheduleTemplates';

function cue(partial: Partial<ScheduleItem> & { id: string }): ScheduleItem {
  return { time: '', description: 'Segment', ...partial };
}

describe('timesFromLengths', () => {
  it('runs the lengths forward from the first cue', () => {
    const result = timesFromLengths([
      cue({ id: '1', time: '8:00 PM', durationMin: 10 }),
      cue({ id: '2', time: 'whenever', durationMin: 25 }),
      cue({ id: '3', time: 'whenever' }),
    ]);
    expect(result.map((r) => r.time)).toEqual(['8:00 PM', '8:10 PM', '8:35 PM']);
  });

  it('rolls past midnight instead of inventing a 25th hour', () => {
    const result = timesFromLengths([
      cue({ id: '1', time: '11:40 PM', durationMin: 30 }),
      cue({ id: '2', time: '' }),
    ]);
    expect(result[1].time).toBe('12:10 AM');
  });

  it('is what makes a saved template portable: move the start, the night follows', () => {
    // A template carries last week's clock times. Re-anchoring is the whole point.
    const template = [
      cue({ id: '1', time: '7:00 PM', durationMin: 30 }),
      cue({ id: '2', time: '7:30 PM', durationMin: 15 }),
      cue({ id: '3', time: '7:45 PM' }),
    ];
    const moved = timesFromLengths([{ ...template[0], time: '9:00 PM' }, ...template.slice(1)]);
    expect(moved.map((r) => r.time)).toEqual(['9:00 PM', '9:30 PM', '9:45 PM']);
  });

  it('stops rather than shifting cues it can no longer place', () => {
    const result = timesFromLengths([
      cue({ id: '1', time: '8:00 PM', durationMin: 10 }),
      cue({ id: '2', time: 'set by hand' }), // no length — the clock is unknown from here
      cue({ id: '3', time: 'also by hand' }),
    ]);
    expect(result.map((r) => r.time)).toEqual(['8:00 PM', '8:10 PM', 'also by hand']);
  });

  it('does nothing without a readable anchor time', () => {
    const items = [cue({ id: '1', time: 'doors', durationMin: 10 }), cue({ id: '2', time: 'x' })];
    expect(timesFromLengths(items)).toEqual(items);
  });
});

describe('canDeriveTimes', () => {
  it('needs an anchor time and a length on every cue that has one after it', () => {
    expect(canDeriveTimes([
      cue({ id: '1', time: '8:00 PM', durationMin: 10 }),
      cue({ id: '2', time: '' }),
    ])).toBe(true);
  });

  it('is false when a length in the middle is missing', () => {
    expect(canDeriveTimes([
      cue({ id: '1', time: '8:00 PM', durationMin: 10 }),
      cue({ id: '2', time: '' }),
      cue({ id: '3', time: '' }),
    ])).toBe(false);
  });

  it('is false without an anchor, or with nothing to re-time', () => {
    expect(canDeriveTimes([
      cue({ id: '1', time: '', durationMin: 10 }),
      cue({ id: '2', time: '' }),
    ])).toBe(false);
    expect(canDeriveTimes([cue({ id: '1', time: '8:00 PM' })])).toBe(false);
  });
});

describe('toTemplateItems', () => {
  it('keeps the running order but drops everything tied to one show', () => {
    expect(
      toTemplateItems([
        cue({
          id: 'show-specific-id',
          time: '8:00 PM',
          description: 'Opener',
          performer: 'Sam',
          durationMin: 10,
          performerId: 'perf-1',
          music: 'media:abc123',
          musicName: 'intro.mp3',
          musicDuration: 20,
        }),
      ]),
    ).toEqual([
      { time: '8:00 PM', description: 'Opener', performer: 'Sam', durationMin: 10 },
    ]);
  });

  it('never carries audio into settings, whatever the cue holds', () => {
    // Settings has a hard request-size ceiling; a blob in here would block
    // every settings save for the account.
    const items = toTemplateItems([cue({ id: '1', music: 'media:x', musicName: 'y.mp3' })]);
    expect(JSON.stringify(items)).not.toContain('media:');
    expect(JSON.stringify(items)).not.toContain('mp3');
  });
});

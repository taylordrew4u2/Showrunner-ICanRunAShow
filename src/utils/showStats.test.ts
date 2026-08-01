import { describe, it, expect } from 'vitest';
import { buildShowStats, progressPercent, formatRunTime, formatMoney } from './showStats';
import type { Show } from '../types';

const show = (over: Partial<Show>): Show => ({
  id: 's', name: 'Show', date: '', time: '', location: '', venueName: '',
  status: 'upcoming', performers: [], artists: [], schedule: [], hosts: [],
  djSongs: [], staff: [], vendors: [], expenses: [], scenes: [],
  createdAt: '', updatedAt: '', ...over,
});

describe('buildShowStats — counts', () => {
  it('counts each section', () => {
    const stats = buildShowStats(show({
      performers: [{ id: 'p1', name: 'Ada' }, { id: 'p2', name: 'Bea' }],
      artists: [{ id: 'a1', name: 'Cal' }],
      schedule: [{ id: 'c1', time: '', description: 'Doors' }],
      djSongs: [{ id: 'd1', title: 'Song', artist: 'Band' }],
      staff: [{ id: 's1', role: 'Sound', personName: 'Dee' }],
      vendors: [{ id: 'v1', name: 'Bar' }],
      expenses: [{ id: 'e1', category: 'Venue', itemName: 'Rent', cost: 100 }],
      todos: [{ id: 't1', text: 'Confirm', completed: false }],
    }));
    expect(stats.counts).toEqual({
      performers: 2, artists: 1, cues: 1, songs: 1,
      staff: 1, vendors: 1, expenses: 1, todos: 1,
    });
  });

  it('treats the optional collections as empty when absent', () => {
    const stats = buildShowStats(show({}));
    expect(stats.counts.vendors).toBe(0);
    expect(stats.counts.todos).toBe(0);
    expect(stats.spend).toBe(0);
    expect(stats.runMinutes).toBe(0);
  });
});

describe('buildShowStats — spend', () => {
  it('adds vendor costs to line-item expenses', () => {
    const stats = buildShowStats(show({
      expenses: [
        { id: 'e1', category: 'Venue', itemName: 'Rent', cost: 250 },
        { id: 'e2', category: 'Print', itemName: 'Flyers', cost: 40.5 },
      ],
      vendors: [{ id: 'v1', name: 'Bar', cost: 100 }],
    }));
    expect(stats.spend).toBe(390.5);
  });

  // Costs come from imports and free-typed fields, so one bad value must not
  // turn the whole tile into NaN.
  it('counts a missing or unparseable cost as zero', () => {
    const stats = buildShowStats(show({
      expenses: [
        { id: 'e1', category: 'Venue', itemName: 'Rent', cost: 100 },
        { id: 'e2', category: '?', itemName: 'Mystery', cost: undefined as unknown as number },
        { id: 'e3', category: '?', itemName: 'Typo', cost: 'abc' as unknown as number },
      ],
      vendors: [{ id: 'v1', name: 'Bar' }],
    }));
    expect(stats.spend).toBe(100);
  });
});

describe('buildShowStats — run time', () => {
  it('sums only the cues that carry a duration', () => {
    const stats = buildShowStats(show({
      schedule: [
        { id: 'c1', time: '', description: 'Doors', durationMin: 30 },
        { id: 'c2', time: '', description: 'Set one', durationMin: 45 },
        { id: 'c3', time: '', description: 'Untimed' },
      ],
    }));
    expect(stats.runMinutes).toBe(75);
  });
});

describe('buildShowStats — progress', () => {
  const find = (stats: ReturnType<typeof buildShowStats>, key: string) =>
    stats.progress.find((p) => p.key === key)!;

  it('counts locked-in performers and artists together', () => {
    const stats = buildShowStats(show({
      performers: [{ id: 'p1', name: 'Ada', lockedIn: true }, { id: 'p2', name: 'Bea' }],
      artists: [{ id: 'a1', name: 'Cal', lockedIn: true }],
    }));
    expect(find(stats, 'lineup')).toMatchObject({ done: 2, total: 3 });
  });

  it('accepts any of the walk-on music fields as "set"', () => {
    const stats = buildShowStats(show({
      performers: [
        { id: 'p1', name: 'Ada', walkOnMusic: 'media:1' },
        { id: 'p2', name: 'Bea', walkOnMusicName: 'track.mp3' },
        { id: 'p3', name: 'Cal', walkOnMusicLink: 'https://example.com/x' },
        { id: 'p4', name: 'Dee' },
      ],
    }));
    expect(find(stats, 'walkon')).toMatchObject({ done: 3, total: 4 });
  });

  it('does not count a zero-minute cue as timed', () => {
    const stats = buildShowStats(show({
      schedule: [
        { id: 'c1', time: '', description: 'Doors', durationMin: 0 },
        { id: 'c2', time: '', description: 'Set', durationMin: 20 },
      ],
    }));
    expect(find(stats, 'cues')).toMatchObject({ done: 1, total: 2 });
  });

  it('counts booked vendors', () => {
    const stats = buildShowStats(show({
      vendors: [{ id: 'v1', name: 'Bar', booked: true }, { id: 'v2', name: 'Food' }],
    }));
    expect(find(stats, 'vendors')).toMatchObject({ done: 1, total: 2 });
  });
});

describe('progressPercent', () => {
  it('rounds to whole percent', () => {
    expect(progressPercent({ key: 'k', label: '', done: 1, total: 3 })).toBe(33);
  });

  it('is 0 rather than NaN for an empty section', () => {
    expect(progressPercent({ key: 'k', label: '', done: 0, total: 0 })).toBe(0);
  });

  it('reaches 100 when everything is done', () => {
    expect(progressPercent({ key: 'k', label: '', done: 4, total: 4 })).toBe(100);
  });
});

describe('formatRunTime', () => {
  it('shows a dash when nothing is timed', () => {
    expect(formatRunTime(0)).toBe('—');
    expect(formatRunTime(-5)).toBe('—');
  });

  it('drops the hour when under one', () => {
    expect(formatRunTime(45)).toBe('45m');
  });

  it('drops the minutes when they are zero', () => {
    expect(formatRunTime(120)).toBe('2h');
  });

  it('shows both otherwise', () => {
    expect(formatRunTime(95)).toBe('1h 35m');
  });
});

describe('formatMoney', () => {
  it('matches the $0.00 form used on the expenses screen', () => {
    expect(formatMoney(0)).toBe('$0.00');
    expect(formatMoney(1240.5)).toBe('$1240.50');
  });

  it('does not render NaN', () => {
    expect(formatMoney(NaN)).toBe('$0.00');
  });
});

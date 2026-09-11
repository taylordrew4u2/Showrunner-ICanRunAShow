import { describe, it, expect } from 'vitest';
import { duplicateShow } from './duplicateShow';
import type { Show } from '../types';

const original = {
  id: 'show-1',
  name: 'Late Night Laughs',
  date: '2026-04-07',
  time: '20:00',
  location: 'Portland, OR',
  venueName: 'The Basement',
  status: 'completed',
  performers: [{ id: 'p1', name: 'Ada Cole' }],
  artists: [],
  schedule: [{ id: 's1', time: '0:00', description: 'Doors', durationMin: 10 }],
  hosts: [],
  djSongs: [],
  staff: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
  viewToken: 'live-token',
  viewNote: 'Doors at 7:30',
  recap: { attendance: 60 },
} as unknown as Show;

describe('duplicateShow', () => {
  it('keeps the show setup and starts a fresh lineup', () => {
    const copy = duplicateShow(original);
    expect(copy.performers).toEqual([]);
    expect(copy.artists).toEqual([]);
    expect(copy.schedule).toEqual(original.schedule);
    expect(copy.venueName).toBe('The Basement');
    expect(copy.time).toBe('20:00');
  });

  it('drops what belonged to that one night', () => {
    const copy = duplicateShow(original);
    // A copy carrying the viewer token would publish over the original's
    // live page.
    expect(copy.viewToken).toBeUndefined();
    expect(copy.viewNote).toBeUndefined();
    expect(copy.recap).toBeUndefined();
    expect(copy.status).toBe('upcoming');
    expect(copy.id).not.toBe(original.id);
  });

  it('clears the date when there is no new one, so the app asks for one', () => {
    expect(duplicateShow(original).date).toBe('');
    expect(duplicateShow(original).name).toBe('Late Night Laughs (copy)');
  });

  it('takes a date and keeps the name for a booked repeat', () => {
    const copy = duplicateShow(original, { name: original.name, date: '2026-04-14' });
    expect(copy.date).toBe('2026-04-14');
    expect(copy.name).toBe('Late Night Laughs');
    expect(copy.performers).toEqual([]);
    expect(original.performers).toHaveLength(1);
  });

  it('is a deep copy — editing the copy cannot reach back into the original', () => {
    const copy = duplicateShow(original);
    copy.schedule[0].description = 'Different doors';
    copy.performers.push({ id: 'p2', name: 'Someone Else' });
    expect(original.schedule[0].description).toBe('Doors');
    expect(original.performers).toEqual([{ id: 'p1', name: 'Ada Cole' }]);
  });

  it('gives every copy its own id', () => {
    const ids = new Set(Array.from({ length: 20 }, () => duplicateShow(original).id));
    expect(ids.size).toBe(20);
  });
});

for (const options of [{}, { name: original.name, date: '2026-04-14' }]) {
  it(`clears artist bookings and old cue assignments for ${options.date ? 'a repeat' : 'a duplicate'}`, () => {
    const source: Show = {
      ...original,
      artists: [{ id: 'a1', name: 'Jo Park' }],
      schedule: [
        { id: 's1', time: '0:00', description: 'Doors', music: 'media:house' },
        { id: 's2', time: '10:00', description: 'Opening set', performerId: 'p1', performer: 'Ada Cole', durationMin: 10 },
        { id: 's3', time: '20:00', description: 'Feature', performer: '  JO   park ', durationMin: 15 },
        { id: 's4', time: '35:00', description: 'Welcome', performer: 'Host' },
      ],
      completions: { performers: true, artists: true, schedule: true, basic: true },
    };
    const before = structuredClone(source);
    const copy = duplicateShow(source, options);
    expect(copy.performers).toEqual([]);
    expect(copy.artists).toEqual([]);
    expect(copy.schedule).toEqual([
      source.schedule[0],
      { id: 's2', time: '10:00', description: 'Opening set', durationMin: 10 },
      { id: 's3', time: '20:00', description: 'Feature', durationMin: 15 },
      source.schedule[3],
    ]);
    expect(copy.completions).toEqual({ performers: false, artists: false, schedule: false, basic: true });
    expect(source).toEqual(before);
  });
}

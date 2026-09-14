import { describe, expect, it } from 'vitest';
import type { Performer, Show, ShowStatus } from '../types';
import { showContextForSigner } from './contractShow';

const NOW = new Date('2026-10-01T12:00:00Z');

const show = (over: Partial<Show> = {}): Show =>
  ({
    id: over.id ?? 's1',
    name: 'Basement Comedy Hour',
    date: '2026-10-03',
    time: '8:00 PM',
    location: 'Brooklyn',
    venueName: 'The Bell House',
    status: 'upcoming' as ShowStatus,
    performers: [],
    artists: [],
    schedule: [],
    hosts: [],
    djSongs: [],
    staff: [],
    expenses: [],
    ...over,
  }) as Show;

const booked = (...names: string[]): Performer[] =>
  names.map((name, i) => ({ id: `p${i}`, name }) as Performer);

describe('which show a contract sent from the library is for', () => {
  it('is the soonest night they are booked on', () => {
    const shows = [
      show({ id: 'later', name: 'November', date: '2026-11-20', performers: booked('Nadia Okonjo') }),
      show({ id: 'soon', name: 'October', date: '2026-10-03', performers: booked('Nadia Okonjo') }),
    ];
    expect(showContextForSigner(shows, 'Nadia Okonjo', NOW)?.showName).toBe('October');
  });

  it('carries the date and the venue, which is the whole point', () => {
    const ctx = showContextForSigner([show({ performers: booked('Nadia Okonjo') })], 'Nadia Okonjo', NOW);
    expect(ctx).toEqual({
      showName: 'Basement Comedy Hour',
      date: '2026-10-03',
      time: '8:00 PM',
      venueName: 'The Bell House',
      location: 'Brooklyn',
    });
  });

  it('counts tonight as upcoming', () => {
    // A contract sent hours before doors is for tonight, not for nothing.
    const tonight = show({ date: '2026-10-01', performers: booked('Nadia Okonjo') });
    expect(showContextForSigner([tonight], 'Nadia Okonjo', NOW)?.date).toBe('2026-10-01');
  });

  it('never reaches back into a show that has happened', () => {
    const past = show({ date: '2026-09-01', performers: booked('Nadia Okonjo') });
    expect(showContextForSigner([past], 'Nadia Okonjo', NOW)).toBeUndefined();
  });

  it('skips a cancelled night', () => {
    const shows = [
      show({ id: 'off', date: '2026-10-02', status: 'cancelled', performers: booked('Nadia Okonjo') }),
      show({ id: 'on', name: 'The one that is happening', date: '2026-10-09', performers: booked('Nadia Okonjo') }),
    ];
    expect(showContextForSigner(shows, 'Nadia Okonjo', NOW)?.showName).toBe('The one that is happening');
  });

  it('matches a name the way the Rolodex does, not by exact spelling', () => {
    const shows = [show({ performers: booked('nadia   OKONJO') })];
    expect(showContextForSigner(shows, 'Nadia Okonjo', NOW)?.venueName).toBe('The Bell House');
  });

  it('fills in nothing for someone who is not booked, rather than guessing', () => {
    const shows = [show({ performers: booked('Someone Else') })];
    expect(showContextForSigner(shows, 'Nadia Okonjo', NOW)).toBeUndefined();
    expect(showContextForSigner([], 'Nadia Okonjo', NOW)).toBeUndefined();
    expect(showContextForSigner(undefined, 'Nadia Okonjo', NOW)).toBeUndefined();
    expect(showContextForSigner(shows, '   ', NOW)).toBeUndefined();
  });

  it('ignores a show with no usable date', () => {
    const shows = [show({ date: '', performers: booked('Nadia Okonjo') })];
    expect(showContextForSigner(shows, 'Nadia Okonjo', NOW)).toBeUndefined();
  });
});

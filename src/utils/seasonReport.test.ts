import { describe, it, expect } from 'vitest';
import { buildSeasonReport, formatMoney, seasonPitch } from './seasonReport';
import type { Show } from '../types';

const show = (over: Partial<Show>): Show => ({
  id: 's', name: 'Show', date: '', time: '', location: '', venueName: '',
  status: 'completed', performers: [], artists: [], schedule: [], hosts: [],
  djSongs: [], staff: [], vendors: [], expenses: [], scenes: [],
  createdAt: '', updatedAt: '', ...over,
});

const TODAY = new Date(2026, 9, 5);

describe('the season report', () => {
  it('counts only this year’s shows unless all time is asked for', () => {
    const shows = [
      show({ id: 'a', date: '2026-03-01' }),
      show({ id: 'b', date: '2025-11-20' }),
      show({ id: 'c', date: '' }),
    ];
    expect(buildSeasonReport(shows, [], 'year', TODAY).shows).toBe(1);
    expect(buildSeasonReport(shows, [], 'all', TODAY).shows).toBe(3);
  });

  it('sorts shows into run, upcoming and cancelled', () => {
    const report = buildSeasonReport([
      show({ id: 'a', date: '2026-01-01', status: 'completed' }),
      show({ id: 'b', date: '2026-12-01', status: 'upcoming' }),
      show({ id: 'c', date: '2026-02-01', status: 'cancelled' }),
    ], [], 'year', TODAY);
    expect(report).toMatchObject({ run: 1, upcoming: 1, cancelled: 1 });
  });

  it('averages the audience over the nights that recorded one, and names the biggest', () => {
    const report = buildSeasonReport([
      show({ id: 'a', name: 'Small', date: '2026-01-01', recap: { attendance: 40 } }),
      show({ id: 'b', name: 'Big', date: '2026-02-01', recap: { attendance: 120 } }),
      show({ id: 'c', name: 'Unknown', date: '2026-03-01' }),
    ], [], 'year', TODAY);
    expect(report.audience).toBe(160);
    expect(report.averageAudience).toBe(80);
    expect(report.bestNight?.name).toBe('Big');
  });

  it('takes the night’s costs from cancelled shows too, since the deposit was still spent', () => {
    const report = buildSeasonReport([
      show({ id: 'a', date: '2026-01-01', recap: { merchSales: 300 }, expenses: [{ id: 'e', category: 'Venue', itemName: 'Room', cost: 100 }] }),
      show({ id: 'b', date: '2026-02-01', status: 'cancelled', expenses: [{ id: 'f', category: 'Venue', itemName: 'Deposit', cost: 50 }] }),
    ], [], 'year', TODAY);
    expect(report.revenue).toBe(300);
    expect(report.showCosts).toBe(150);
    expect(report.net).toBe(150);
  });

  it('counts a performer typed in by hand twice as one person, and ranks the most booked', () => {
    const report = buildSeasonReport([
      show({ id: 'a', date: '2026-01-01', performers: [{ id: '1', name: 'Ada' }, { id: '2', name: 'Bea' }] }),
      show({ id: 'b', date: '2026-02-01', performers: [{ id: '3', name: 'ada ' }] }),
      show({ id: 'c', date: '2026-03-01', status: 'cancelled', performers: [{ id: '4', name: 'Bea' }] }),
    ], [], 'year', TODAY);
    expect(report.bookings).toBe(3);
    expect(report.uniquePerformers).toBe(2);
    expect(report.topPerformers[0]).toEqual({ name: 'Ada', count: 2 });
  });

  it('keeps brand spending out of a year it can’t be dated to', () => {
    const report = buildSeasonReport([], [
      { id: 'x', category: 'Marketing', itemName: 'Posters', cost: 20, date: '2026-04-01' },
      { id: 'y', category: 'Marketing', itemName: 'Mystery', cost: 999 },
    ], 'year', TODAY);
    expect(report.brandSpending).toBe(20);
  });

  it('survives costs and attendance that aren’t numbers', () => {
    const report = buildSeasonReport([
      show({ date: '2026-01-01', recap: { attendance: NaN }, expenses: [{ id: 'e', category: 'x', itemName: 'y', cost: undefined as unknown as number }] }),
    ], [], 'year', TODAY);
    expect(report.audience).toBe(0);
    expect(report.showCosts).toBe(0);
  });
});

describe('the venue pitch', () => {
  it('leads with what is booked when nothing has run yet', () => {
    const report = buildSeasonReport([show({ date: '2026-12-01', status: 'upcoming' })], [], 'year', TODAY);
    expect(seasonPitch(report, '', 'year', TODAY)).toBe('We have 1 show on the calendar.');
  });

  it('leaves out numbers that were never recorded', () => {
    const report = buildSeasonReport([show({ date: '2026-01-01' })], [], 'year', TODAY);
    const pitch = seasonPitch(report, 'Basement Laughs', 'year', TODAY);
    expect(pitch).toBe('Basement Laughs has produced 1 show in 2026.');
  });

  it('quotes the audience, the biggest night and the bill when they are known', () => {
    const report = buildSeasonReport([
      show({ name: 'Opener', date: '2026-01-01', recap: { attendance: 90 }, performers: [{ id: '1', name: 'Ada' }] }),
      show({ name: 'Finale', date: '2026-12-01', status: 'upcoming' }),
    ], [], 'year', TODAY);
    const pitch = seasonPitch(report, '', 'year', TODAY);
    expect(pitch).toContain('We have produced 1 show in 2026.');
    expect(pitch).toContain('90 people through the door');
    expect(pitch).toContain('Biggest night: Opener (90).');
    expect(pitch).toContain('1 performer booked across 1 spot.');
    expect(pitch).toContain('1 more on the calendar.');
  });
});

describe('money on the report', () => {
  it('prints losses with the sign before the dollar', () => {
    expect(formatMoney(-12.5)).toBe('-$12.5');
    expect(formatMoney(1234)).toBe('$1,234');
  });
});

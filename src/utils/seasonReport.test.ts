import { describe, it, expect } from 'vitest';
import { buildSeasonReport, formatMoney, seasonPitch } from './seasonReport';
import { recapMoney } from './recapMoney';
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
      show({ id: 'a', date: '2026-01-01', recap: { merchSales: 300 }, vendors: [{ id: 'e', name: 'Room', cost: 100 }] }),
      show({ id: 'b', date: '2026-02-01', status: 'cancelled', vendors: [{ id: 'f', name: 'Deposit', cost: 50 }] }),
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
      show({ date: '2026-01-01', recap: { attendance: NaN, otherCosts: NaN }, vendors: [{ id: 'e', name: 'y', cost: NaN }] }),
    ], [], 'year', TODAY);
    expect(report.audience).toBe(0);
    expect(report.showCosts).toBe(0);
  });
});

describe('the season report’s money, night by night', () => {
  it('takes ticket sales and merch as revenue, and vendors and other costs as costs', () => {
    const report = buildSeasonReport([
      show({
        date: '2026-03-01',
        recap: { ticketSales: 800, merchSales: 120, otherCosts: 200 },
        vendors: [{ id: 'v', name: 'Sound', cost: 150, booked: true }, { id: 'w', name: 'Flyers', cost: 50 }],
      }),
    ], [], 'year', TODAY);
    expect(report).toMatchObject({ revenue: 920, showCosts: 400, net: 520 });
  });

  it('agrees with what each night’s recap says it made', () => {
    const nights = [
      show({ id: 'a', date: '2026-03-01', recap: { ticketSales: 300 }, vendors: [{ id: 'v', name: 'Room', cost: 400 }] }),
      show({ id: 'b', date: '2026-04-01', recap: { merchSales: 90, otherCosts: 30 } }),
    ];
    const report = buildSeasonReport(nights, [], 'year', TODAY);
    const perNight = nights.map((n) => recapMoney(n.recap, n.vendors).profitLoss);
    expect(perNight).toEqual([-100, 60]);
    expect(report.net).toBe(-40);
  });

  it('reads a recap saved before ticket sales and other costs existed', () => {
    const report = buildSeasonReport([
      show({ date: '2026-03-01', recap: { attendance: 60, merchSales: 200, profitLoss: 200 } }),
    ], [], 'year', TODAY);
    expect(report).toMatchObject({ revenue: 200, showCosts: 0, net: 200 });
  });

  it('counts each vendor once, on the show it was booked for', () => {
    const report = buildSeasonReport([
      show({ date: '2026-03-01', vendors: [{ id: 'v', name: 'Room', cost: 250 }] }),
    ], [], 'year', TODAY);
    expect(report.showCosts).toBe(250);
    expect(report.brandSpending).toBe(0);
  });

  // Per-show expenses were moved onto the account's Expenses page when that
  // page arrived. A copy still on a show is the same money, and the Expenses
  // page already counts it as brand spending.
  it('leaves a show’s old expense list to brand spending rather than charging it twice', () => {
    const moved = { id: 'e', category: 'Venue', itemName: 'Room', cost: 100, date: '2026-03-01' };
    const report = buildSeasonReport([
      show({ date: '2026-03-01', recap: { ticketSales: 300 }, expenses: [moved] }),
    ], [moved], 'year', TODAY);
    expect(report.showCosts).toBe(0);
    expect(report.brandSpending).toBe(100);
    expect(report.net - report.brandSpending).toBe(200);
  });
});

describe('the season report, edge cases', () => {
  it('leaves the sample night out, so a demo is never quoted to a venue', () => {
    const report = buildSeasonReport([
      show({ date: '2026-01-01', sample: true, venueName: 'The Basement', recap: { attendance: 50 } }),
    ], [], 'year', TODAY);
    expect(report.shows).toBe(0);
    expect(report.topVenues).toEqual([]);
  });

  it('does not count a deposit on a night that has not happened as a loss yet', () => {
    const report = buildSeasonReport([
      show({ date: '2026-01-01', recap: { merchSales: 300 }, vendors: [{ id: 'a', name: 'Room', cost: 100 }] }),
      show({ date: '2026-12-01', status: 'upcoming', vendors: [{ id: 'b', name: 'Deposit', cost: 500 }] }),
    ], [], 'year', TODAY);
    expect(report.showCosts).toBe(100);
    expect(report.net).toBe(200);
  });

  it('counts a comic booked from the Rolodex once and typed in by hand once as one person', () => {
    const report = buildSeasonReport([
      show({ date: '2026-01-01', performers: [{ id: '1', name: 'Ada Lovelace', comicId: 'c1' }] }),
      show({ date: '2026-02-01', performers: [{ id: '2', name: 'Ada  Lovelace' }] }),
    ], [], 'year', TODAY);
    expect(report.uniquePerformers).toBe(1);
    expect(report.topPerformers[0].count).toBe(2);
  });

  // Run Show marks a night in progress when it starts, and only "End show"
  // finishes it. Closed any other way it stays in progress, its recap still
  // opens once the date has passed, and the figures typed into it were left
  // out of every total while the night was counted as still to come.
  it('counts a past night left in progress as run, with its recap and costs', () => {
    const report = buildSeasonReport([
      show({ id: 'a', date: '2026-09-01', recap: { attendance: 50 } }),
      show({
        id: 'b',
        date: '2026-10-02',
        status: 'in-progress',
        recap: { attendance: 80, merchSales: 200 },
        vendors: [{ id: 'e', name: 'Room', cost: 150 }],
      }),
    ], [], 'year', TODAY);
    expect(report).toMatchObject({ run: 2, upcoming: 0, audience: 130, revenue: 200, showCosts: 150, net: 50 });
    expect(seasonPitch(report, '', 'year', TODAY)).not.toContain('on the calendar');
  });

  it('still counts tonight’s show as on the calendar while it is in progress', () => {
    const report = buildSeasonReport([
      show({ date: '2026-10-05', status: 'in-progress', vendors: [{ id: 'e', name: 'Room', cost: 150 }] }),
    ], [], 'year', TODAY);
    expect(report).toMatchObject({ run: 0, upcoming: 1, showCosts: 0 });
  });

  it('ranks rooms by venue name, never by city', () => {
    const report = buildSeasonReport([
      show({ date: '2026-01-01', location: 'Brooklyn' }),
    ], [], 'year', TODAY);
    expect(report.topVenues).toEqual([]);
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
    expect(formatMoney(-12.5)).toBe('-$12.50');
    expect(formatMoney(1234)).toBe('$1,234');
    expect(formatMoney(12.5)).toBe('$12.50');
  });

  // Adding up cents in floating point leaves dust: $0.10 + $0.20 is not quite
  // $0.30. A season that broke even printed "-$0.00" in red.
  it('calls a season that broke even to the cent exactly even', () => {
    const report = buildSeasonReport([
      show({ date: '2026-01-01', vendors: [
        { id: 'a', name: 'Room', cost: 0.1 },
        { id: 'b', name: 'Tape', cost: 0.2 },
      ] }),
      show({ date: '2026-02-01', recap: { merchSales: 0.3 } }),
    ], [], 'year', TODAY);
    expect(report.net).toBe(0);
    expect(formatMoney(report.net)).toBe('$0');

    const busier = buildSeasonReport([
      show({ date: '2026-01-01', vendors: [
        { id: 'a', name: 'Room', cost: 10.1 },
        { id: 'b', name: 'Sound', cost: 20.2 },
      ] }),
      show({ date: '2026-02-01', recap: { merchSales: 30.3 } }),
    ], [], 'year', TODAY);
    expect(busier.net).toBe(0);
  });

  it('never prints a sign or cents on a sum that rounds to nothing', () => {
    expect(formatMoney(-5.551115123125783e-17)).toBe('$0');
    expect(formatMoney(3.552713678800501e-15)).toBe('$0');
    expect(formatMoney(12.499999999999998)).toBe('$12.50');
  });
});

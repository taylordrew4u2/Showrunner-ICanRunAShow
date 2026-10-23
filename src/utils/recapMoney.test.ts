import { describe, it, expect } from 'vitest';
import { recapMoney, settleRecapProfit } from './recapMoney';
import { vendorsSummary } from './sectionSummary';
import type { Show, Vendor } from '../types';

const vendor = (over: Partial<Vendor>): Vendor => ({ id: over.name ?? 'v', name: 'Vendor', ...over });

const show = (over: Partial<Show>): Show => ({
  id: 's', name: 'Show', date: '', time: '', location: '', venueName: '',
  status: 'completed', performers: [], artists: [], schedule: [], hosts: [],
  djSongs: [], staff: [], vendors: [], expenses: [], scenes: [],
  createdAt: '', updatedAt: '', ...over,
});

describe('a night’s money', () => {
  it('reads a recap saved before ticket sales and other costs existed', () => {
    // An old recap carries merch and the profit it stored when merch was the
    // only figure. The new fields are missing, which is nothing sold and
    // nothing else spent, not an error.
    const money = recapMoney({ attendance: 80, merchSales: 300, profitLoss: 300 });
    expect(money).toEqual({
      ticketSales: 0,
      merchSales: 300,
      revenue: 300,
      vendorCosts: 0,
      otherCosts: 0,
      costs: 0,
      profitLoss: 300,
    });
  });

  it('is all zero for a show with no recap and no vendors', () => {
    expect(recapMoney(undefined)).toMatchObject({ revenue: 0, costs: 0, profitLoss: 0 });
  });

  it('counts the vendors the way the Vendors card does, booked or not', () => {
    const vendors = [
      vendor({ name: 'Tacos', cost: 300, booked: true }),
      vendor({ name: 'Sound', cost: 120, booked: false }),
      vendor({ name: 'Flyers' }),
    ];
    const money = recapMoney({}, vendors);
    expect(money.vendorCosts).toBe(420);
    expect(money.costs).toBe(420);
    expect(money.profitLoss).toBe(-420);
    // The same $420 the collapsed card shows.
    expect(vendorsSummary(vendors)).toBe('Tacos, Sound +1 · $420');
  });

  it('adds the recap’s other costs to the vendors', () => {
    const money = recapMoney({ otherCosts: 150 }, [vendor({ cost: 100 })]);
    expect(money).toMatchObject({ vendorCosts: 100, otherCosts: 150, costs: 250, profitLoss: -250 });
  });

  it('takes ticket sales and merch together as the night’s revenue', () => {
    const money = recapMoney({ ticketSales: 500, merchSales: 120 });
    expect(money).toMatchObject({ ticketSales: 500, merchSales: 120, revenue: 620, profitLoss: 620 });
  });

  it('comes out below zero for a night that cost more than it took', () => {
    const money = recapMoney(
      { ticketSales: 200, merchSales: 40, otherCosts: 90 },
      [vendor({ name: 'Room', cost: 250 }), vendor({ name: 'Sound', cost: 60 })],
    );
    expect(money).toMatchObject({ revenue: 240, vendorCosts: 310, costs: 400, profitLoss: -160 });
  });

  it('ignores a stored profit that a vendor’s later change of cost left behind', () => {
    // Saved when the room cost $100; the room now costs $250.
    const money = recapMoney({ ticketSales: 300, profitLoss: 200 }, [vendor({ cost: 250 })]);
    expect(money.profitLoss).toBe(50);
  });

  it('breaks even to the cent, not a hair either side of zero', () => {
    const money = recapMoney({ ticketSales: 0.1, merchSales: 0.2, otherCosts: 0.3 });
    expect(money.profitLoss).toBe(0);
    expect(Object.is(money.profitLoss, -0)).toBe(false);
  });

  it('counts a figure that isn’t a number as nothing', () => {
    const money = recapMoney(
      { ticketSales: NaN, merchSales: '45' as unknown as number, otherCosts: 'n/a' as unknown as number },
      [vendor({ cost: undefined }), vendor({ cost: NaN })],
    );
    expect(money).toMatchObject({ ticketSales: 0, merchSales: 45, otherCosts: 0, vendorCosts: 0, profitLoss: 45 });
  });
});

describe('the stored profit', () => {
  it('is brought up to date when the vendors change under it', () => {
    const before = show({ recap: { ticketSales: 300, profitLoss: 200 }, vendors: [vendor({ cost: 250 })] });
    const settled = settleRecapProfit(before);
    expect(settled.recap).toEqual({ ticketSales: 300, profitLoss: 50 });
    expect(before.recap?.profitLoss).toBe(200);
  });

  it('is written on an old recap that never had one', () => {
    const settled = settleRecapProfit(show({ recap: { merchSales: 80 }, vendors: [vendor({ cost: 30 })] }));
    expect(settled.recap?.profitLoss).toBe(50);
  });

  it('hands back the same show when it is already right', () => {
    const steady = show({ recap: { merchSales: 80, profitLoss: 50 }, vendors: [vendor({ cost: 30 })] });
    expect(settleRecapProfit(steady)).toBe(steady);
  });

  it('does not start a recap on a show that has none', () => {
    const upcoming = show({ status: 'upcoming', vendors: [vendor({ cost: 30 })] });
    expect(settleRecapProfit(upcoming)).toBe(upcoming);
    expect(settleRecapProfit(upcoming).recap).toBeUndefined();
  });
});

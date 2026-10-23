// A night's money, added up one way. The recap page, the printed runsheet and
// the season report all read it from here, so the three agree with each other
// and with the total on the Vendors card.
import type { Show, ShowRecap, Vendor } from '../types';
import { vendorsCost } from './sectionSummary';

export interface RecapMoney {
  ticketSales: number;
  merchSales: number;
  /** Ticket sales plus merch. */
  revenue: number;
  /** The show's vendors, counted the way the Vendors card counts them. */
  vendorCosts: number;
  otherCosts: number;
  /** Vendors plus other costs. */
  costs: number;
  /** Revenue less costs; below zero for a night that lost money. */
  profitLoss: number;
}

// Recap figures arrive from hand-typed fields and from recaps saved before a
// field existed. Anything that isn't a number counts as zero rather than
// turning the total into NaN.
function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

// Money adds up in floating point, where $0.10 + $0.20 is not quite $0.30, so
// a night that broke even came out a hair either side of zero. Every figure is
// rounded to the cent; `|| 0` turns a rounded -0 into 0.
function toCents(value: number): number {
  return Math.round(value * 100) / 100 || 0;
}

/**
 * What a night took and what it cost.
 *
 * Per-show expenses moved to the account's Expenses page, which says nothing
 * about which show they were for, so a show's costs are its vendors plus the
 * recap's "other costs" (the door split, performer pay). Its revenue is ticket
 * sales plus merch. Worked out from those figures every time it is shown,
 * rather than read from the stored profitLoss, so a vendor's cost changed
 * after the recap was typed still reaches the bottom line.
 */
export function recapMoney(recap: ShowRecap | undefined, vendors: Vendor[] = []): RecapMoney {
  const ticketSales = toCents(num(recap?.ticketSales));
  const merchSales = toCents(num(recap?.merchSales));
  const vendorCosts = toCents(vendorsCost(vendors));
  const otherCosts = toCents(num(recap?.otherCosts));
  const revenue = toCents(ticketSales + merchSales);
  const costs = toCents(vendorCosts + otherCosts);
  return {
    ticketSales,
    merchSales,
    revenue,
    vendorCosts,
    otherCosts,
    costs,
    profitLoss: toCents(revenue - costs),
  };
}

/**
 * The show with its recap's stored profitLoss matching its figures.
 *
 * Nothing on screen reads the stored number, but it is saved with the show and
 * an older copy of the app still prints it, so it is kept true rather than left
 * at whatever it was when a recap field was last typed in. A show with no recap
 * gets none, and one already in step comes back as the same object.
 */
export function settleRecapProfit(show: Show): Show {
  if (!show.recap) return show;
  const { profitLoss } = recapMoney(show.recap, show.vendors ?? []);
  if (show.recap.profitLoss === profitLoss) return show;
  return { ...show, recap: { ...show.recap, profitLoss } };
}

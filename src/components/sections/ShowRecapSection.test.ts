import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ShowRecapSection, shownAmount, storedNote } from './ShowRecapSection';
import type { ShowRecap, Vendor } from '../../types';

describe('storing a recap note while it is being typed', () => {
  it('keeps the note as typed, trailing space and blank lines included', () => {
    // Every keystroke is saved, and the saved value is written back into the
    // field. Trimmed on the way in, backspacing "Great show" to "Great " put
    // "Great" back in the box, and the next word landed as "Greatgig".
    expect(storedNote('Great ')).toBe('Great ');
    expect(storedNote('Line1\n\n')).toBe('Line1\n\n');
  });

  it('stores nothing for a note that is only whitespace', () => {
    expect(storedNote('')).toBeUndefined();
    expect(storedNote('  \n ')).toBeUndefined();
  });
});

describe('writing a saved recap amount back into its box', () => {
  // Every keystroke is saved and the saved number comes back into the box.
  // Backspacing "20.05" to "20.0" saved 20, the box was rewritten to "20",
  // and the next digit made it 201.
  it('keeps what is typed while it still reads as the saved number', () => {
    expect(shownAmount('20.0', 20)).toBe('20.0');
    expect(shownAmount('12.', 12)).toBe('12.');
    expect(shownAmount('0', undefined)).toBe('0');
    expect(shownAmount('', undefined)).toBe('');
  });

  it('shows the saved number when it changed somewhere else', () => {
    expect(shownAmount('20', 25)).toBe('25');
    expect(shownAmount('20.0', undefined)).toBe('');
    expect(shownAmount('', 12.5)).toBe('12.5');
  });
});

/** The recap's money panel as label → amount, in the order it reads. */
function ledger(recap: ShowRecap | undefined, vendors: Vendor[]): [string, string][] {
  const html = renderToStaticMarkup(createElement(ShowRecapSection, {
    recap,
    vendors,
    todos: [],
    onChange: () => undefined,
    onAddTodo: () => undefined,
    onToggleTodo: () => undefined,
    onDeleteTodo: () => undefined,
  }));
  const text = (s: string) => s.replace(/<[^>]*>/g, '');
  return [...html.matchAll(/<dt>(.*?)<\/dt><dd>(.*?)<\/dd>/g)].map((m) => [text(m[1]), text(m[2])]);
}

describe('the recap’s money', () => {
  it('lays out what came in, what went out, and the bottom line', () => {
    const rows = ledger(
      { ticketSales: 500, merchSales: 120, otherCosts: 100 },
      [{ id: 'a', name: 'Room', cost: 300, booked: true }, { id: 'b', name: 'Sound', cost: 50 }],
    );
    expect(rows).toEqual([
      ['Ticket sales', '$500'],
      ['Merch sales', '$120'],
      ['Vendors (2)', '-$350'],
      ['Other costs', '-$100'],
      ['Profit / loss', '$170'],
    ]);
  });

  // Total Expenses came from the show's own expense list, which has been
  // empty since expenses moved to the account's Expenses page — so every
  // recap read $0 spent and a profit equal to its merch.
  it('charges the night for its vendors, so a loss reads as a loss', () => {
    const rows = ledger({ merchSales: 80 }, [{ id: 'a', name: 'Room', cost: 250 }]);
    expect(rows.at(-1)).toEqual(['Profit / loss', '-$170']);
  });

  it('opens an old recap, saved before ticket sales and other costs, without them', () => {
    const rows = ledger({ attendance: 40, merchSales: 60.5, profitLoss: 60.5 }, []);
    expect(rows).toEqual([
      ['Ticket sales', '$0'],
      ['Merch sales', '$60.50'],
      ['Vendors', '$0'],
      ['Other costs', '$0'],
      ['Profit / loss', '$60.50'],
    ]);
  });

  it('marks the bottom line of a losing night, and says where the vendor figure comes from', () => {
    const html = renderToStaticMarkup(createElement(ShowRecapSection, {
      recap: undefined,
      vendors: [{ id: 'a', name: 'Room', cost: 100 }],
      todos: [],
      onChange: () => undefined,
      onAddTodo: () => undefined,
      onToggleTodo: () => undefined,
      onDeleteTodo: () => undefined,
    }));
    expect(html).toContain('recap-financial__row--total recap-financial__row--loss');
    expect(html).toContain('Vendors are added up from the Vendors section, booked or not.');
    expect(html).toContain('Ticket Sales ($)');
    expect(html).toContain('Other Costs ($)');
  });
});

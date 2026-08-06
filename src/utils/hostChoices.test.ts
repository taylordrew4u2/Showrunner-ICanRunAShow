import { describe, expect, it } from 'vitest';
import type { Artist, Performer, PotentialComic } from '../types';
import { hostChoices } from './hostChoices';

const performer = (name: string): Performer => ({ id: `p-${name}`, name });
const artist = (name: string): Artist => ({ id: `a-${name}`, name });
const comic = (name: string): PotentialComic => ({ id: `c-${name}`, name });

describe('hostChoices', () => {
  it('offers the Rolodex, not just the bill — the host usually is not performing', () => {
    const { onBill, rolodex } = hostChoices([performer('Sam Reyes')], [], [comic('Jo Park')]);
    expect(onBill).toEqual(['Sam Reyes']);
    expect(rolodex).toEqual(['Jo Park']);
  });

  it('lists a name in both places once, under the bill', () => {
    const { onBill, rolodex } = hostChoices(
      [performer('Marcus Webb')],
      [],
      [comic('marcus webb'), comic('Jo Park')],
    );
    expect(onBill).toEqual(['Marcus Webb']);
    expect(rolodex).toEqual(['Jo Park']);
  });

  it('keeps the spelling this show uses when the two differ', () => {
    // Booked as "Jo Park", filed in the Rolodex as "Jo  Park" — the lineup wins.
    const { onBill, rolodex } = hostChoices([performer('Jo Park')], [], [comic(' jo park ')]);
    expect(onBill).toEqual(['Jo Park']);
    expect(rolodex).toEqual([]);
  });

  it('counts artists as part of the bill', () => {
    expect(hostChoices([], [artist('The Rhythm Section')], []).onBill).toEqual([
      'The Rhythm Section',
    ]);
  });

  it('drops blanks rather than offering an empty row', () => {
    const { onBill, rolodex } = hostChoices([performer('   ')], undefined, [comic('')]);
    expect(onBill).toEqual([]);
    expect(rolodex).toEqual([]);
  });
});

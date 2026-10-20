import { describe, expect, it } from 'vitest';
import {
  billedPerformers,
  isSurpriseGuest,
  moveWithinGroup,
  surpriseGuests,
} from './surpriseGuests';
import type { Performer } from '../types';

const ada: Performer = { id: 'ada', name: 'Ada Cole' };
const jo: Performer = { id: 'jo', name: 'Jo Park' };
const guest: Performer = { id: 'guest', name: 'Miles Trent', surpriseGuest: true };
const second: Performer = { id: 'second', name: 'Rae Sun', surpriseGuest: true };

describe('isSurpriseGuest', () => {
  it('is only the flag, set on purpose', () => {
    expect(isSurpriseGuest(guest)).toBe(true);
    expect(isSurpriseGuest(ada)).toBe(false);
    expect(isSurpriseGuest({ surpriseGuest: false })).toBe(false);
    expect(isSurpriseGuest(undefined)).toBe(false);
    expect(isSurpriseGuest(null)).toBe(false);
  });
});

describe('the two halves of a lineup', () => {
  const lineup = [ada, guest, jo, second];

  it('posts the bill without its surprise guests, in bill order', () => {
    expect(billedPerformers(lineup)).toEqual([ada, jo]);
  });

  it('keeps the guests apart, in the order they were booked', () => {
    expect(surpriseGuests(lineup)).toEqual([guest, second]);
  });

  it('splits a lineup with nobody kept back into the whole bill and nothing', () => {
    expect(billedPerformers([ada, jo])).toEqual([ada, jo]);
    expect(surpriseGuests([ada, jo])).toEqual([]);
  });
});

describe('moveWithinGroup', () => {
  it('swaps with the next person on the same tab, over a guest in between', () => {
    // On screen the bill reads Ada, Jo; the guest between them is on the
    // other tab. Moving Jo up has to put Jo above Ada, not above the guest.
    expect(moveWithinGroup([ada, guest, jo], 'jo', -1).map((p) => p.id)).toEqual(['jo', 'guest', 'ada']);
  });

  it('moves guests among guests the same way', () => {
    expect(moveWithinGroup([guest, ada, second], 'guest', 1).map((p) => p.id)).toEqual(['second', 'ada', 'guest']);
  });

  it('leaves the list alone at either end of a tab', () => {
    const lineup = [ada, guest, jo];
    expect(moveWithinGroup(lineup, 'ada', -1)).toBe(lineup);
    expect(moveWithinGroup(lineup, 'jo', 1)).toBe(lineup);
    expect(moveWithinGroup(lineup, 'guest', 1)).toBe(lineup);
    expect(moveWithinGroup(lineup, 'nobody', 1)).toBe(lineup);
  });

  it('keeps everything about the people it moves', () => {
    const moved = moveWithinGroup([guest, second], 'second', -1);
    expect(moved).toEqual([second, guest]);
    expect(moved[0]).toBe(second);
  });
});

import { describe, expect, it } from 'vitest';
import type { Artist, Performer, PotentialComic } from '../types';
import { hostChoices, hostPick } from './hostChoices';

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

describe('hostPick', () => {
  const comics: PotentialComic[] = [
    { id: 'c-jo', name: 'Jo Park', socialMedia: '@jopark' },
    { id: 'c-dev', name: 'Dev Okonjo' },
  ];

  it('brings the Rolodex entry’s handle and its link with the name', () => {
    expect(hostPick('Jo Park', [], [], comics)).toEqual({ name: 'Jo Park', social: '@jopark', comicId: 'c-jo' });
    expect(hostPick('Dev Okonjo', [], [], comics)).toEqual({ name: 'Dev Okonjo', social: undefined, comicId: 'c-dev' });
  });

  it('takes someone on this bill as their booking has them', () => {
    const booked: Performer = { id: 'slot', comicId: 'c-jo', name: 'Jo  Park', socialMedia: '@jo.on.the.bill' };
    expect(hostPick('jo park', [booked], [], comics)).toEqual({ name: 'Jo  Park', social: '@jo.on.the.bill', comicId: 'c-jo' });
    const painter: Artist = { id: 'a', name: 'Bea Painter', socialMedia: '@beapaints' };
    expect(hostPick('Bea Painter', [], [painter], comics)).toEqual({ name: 'Bea Painter', social: '@beapaints', comicId: undefined });
  });

  it('is only a name for someone on neither list', () => {
    expect(hostPick(' Sam Reyes ', [], undefined, comics)).toEqual({ name: 'Sam Reyes' });
  });
});

import { describe, it, expect } from 'vitest';
import { buildIntroCards, walkOnLine } from './introCards';
import type { Show, Performer } from '../types';

const show = (over: Partial<Show>): Show => ({
  id: 's', name: 'Show', date: '', time: '', location: '', venueName: '',
  status: 'upcoming', performers: [], artists: [], schedule: [], hosts: [],
  djSongs: [], staff: [], vendors: [], expenses: [], scenes: [],
  createdAt: '', updatedAt: '', ...over,
});

const p = (over: Partial<Performer>): Performer => ({ id: 'p', name: '', ...over });
const cue = (performer: string) => ({ id: `c-${performer}`, time: '', description: 'Set', performer });

describe('walkOnLine', () => {
  it('says the track and who it is by', () => {
    expect(walkOnLine({ walkOnMusicName: 'Nightcall', walkOnMusicArtist: 'Kavinsky' }))
      .toBe('Nightcall — Kavinsky');
  });

  it('adds the cue point when there is one', () => {
    expect(walkOnLine({ walkOnMusicName: 'Nightcall', walkOnMusicArtist: 'Kavinsky', walkOnMusicTimestamp: '0:42' }))
      .toBe('Nightcall — Kavinsky @ 0:42');
  });

  it('copes with only half the details', () => {
    expect(walkOnLine({ walkOnMusicName: 'Nightcall' })).toBe('Nightcall');
    expect(walkOnLine({ walkOnMusicArtist: 'Kavinsky' })).toBe('Kavinsky');
  });

  it('is nothing when there is no music, not a stray timestamp', () => {
    expect(walkOnLine({ walkOnMusicTimestamp: '0:42' })).toBeNull();
    expect(walkOnLine({})).toBeNull();
  });
});

describe('buildIntroCards', () => {
  it('has no cards for an empty bill', () => {
    expect(buildIntroCards(show({}))).toEqual([]);
  });

  it('gives every act a card, performers then artists', () => {
    const cards = buildIntroCards(show({
      performers: [p({ id: 'p1', name: 'Ada Cole' })],
      artists: [{ id: 'a1', name: 'DJ Halcyon' }],
    }));
    expect(cards.map((c) => [c.name, c.kind])).toEqual([
      ['Ada Cole', 'performer'],
      ['DJ Halcyon', 'artist'],
    ]);
  });

  it('numbers the stack so a dropped deck can be put back in order', () => {
    const cards = buildIntroCards(show({
      performers: [p({ id: 'p1', name: 'A' }), p({ id: 'p2', name: 'B' }), p({ id: 'p3', name: 'C' })],
    }));
    expect(cards.map((c) => c.order)).toEqual([1, 2, 3]);
  });

  it('stacks them in the order the running order will call them', () => {
    const cards = buildIntroCards(show({
      performers: [p({ id: 'p1', name: 'Ada Cole' }), p({ id: 'p2', name: 'Miles Trent' })],
      schedule: [cue('Miles Trent'), cue('Ada Cole')],
    }));
    expect(cards.map((c) => c.name)).toEqual(['Miles Trent', 'Ada Cole']);
  });

  it('matches the running order regardless of casing or stray spaces', () => {
    const cards = buildIntroCards(show({
      performers: [p({ id: 'p1', name: 'Ada Cole' }), p({ id: 'p2', name: 'Miles Trent' })],
      schedule: [cue('  miles trent ')],
    }));
    expect(cards.map((c) => c.name)).toEqual(['Miles Trent', 'Ada Cole']);
  });

  it('keeps acts the schedule has not reached yet, behind the ones it has', () => {
    const cards = buildIntroCards(show({
      performers: [p({ id: 'p1', name: 'Ada' }), p({ id: 'p2', name: 'Miles' }), p({ id: 'p3', name: 'Jo' })],
      // Only the closer is scheduled so far.
      schedule: [cue('Jo')],
    }));
    expect(cards.map((c) => c.name)).toEqual(['Jo', 'Ada', 'Miles']);
  });

  it('uses a performer’s first appearance, not their last', () => {
    const cards = buildIntroCards(show({
      performers: [p({ id: 'p1', name: 'Ada' }), p({ id: 'p2', name: 'Host' })],
      schedule: [cue('Host'), cue('Ada'), cue('Host')],
    }));
    expect(cards.map((c) => c.name)).toEqual(['Host', 'Ada']);
  });

  it('carries the credits and the walk-on cue the host needs', () => {
    const [card] = buildIntroCards(show({
      performers: [p({
        id: 'p1', name: 'Ada Cole', credits: 'Just For Laughs, Netflix',
        socialMedia: '@adacole', walkOnMusicName: 'Nightcall', walkOnMusicArtist: 'Kavinsky',
      })],
    }));
    expect(card.credits).toBe('Just For Laughs, Netflix');
    expect(card.social).toBe('@adacole');
    expect(card.walkOn).toBe('Nightcall — Kavinsky');
  });

  it('leaves blanks null rather than printing empty lines', () => {
    const [card] = buildIntroCards(show({
      performers: [p({ id: 'p1', name: 'Ada Cole', credits: '   ', socialMedia: '' })],
    }));
    expect(card.credits).toBeNull();
    expect(card.social).toBeNull();
    expect(card.walkOn).toBeNull();
  });

  it('skips a half-finished row with no name instead of printing a blank card', () => {
    const cards = buildIntroCards(show({
      performers: [p({ id: 'p1', name: '  ' }), p({ id: 'p2', name: 'Ada Cole' })],
    }));
    expect(cards.map((c) => c.name)).toEqual(['Ada Cole']);
    expect(cards[0].order).toBe(1);
  });

  it('trims the name it prints', () => {
    const [card] = buildIntroCards(show({ performers: [p({ id: 'p1', name: '  Ada Cole ' })] }));
    expect(card.name).toBe('Ada Cole');
  });
});

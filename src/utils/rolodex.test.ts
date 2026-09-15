import { describe, it, expect } from 'vitest';
import {
  addPerformersToRolodex,
  comicToPerformer,
  performerToComic,
  rolodexKey,
} from './rolodex';
import type { Performer, PotentialComic } from '../types';

const performer = (over: Partial<Performer>): Performer => ({
  id: 'p', name: '', ...over,
});

const comic = (over: Partial<PotentialComic>): PotentialComic => ({
  id: 'c', name: '', ...over,
});

describe('rolodexKey', () => {
  it('treats spellings that differ only in case or spacing as one person', () => {
    expect(rolodexKey('Ada Cole')).toBe(rolodexKey('  ada   cole '));
  });

  it('keeps genuinely different names apart', () => {
    expect(rolodexKey('Ada Cole')).not.toBe(rolodexKey('Ada Colt'));
  });
});

describe('performerToComic', () => {
  it('carries the whole profile across, not just the name', () => {
    const result = performerToComic(performer({
      name: 'Ada Cole',
      socialMedia: '@adacole',
      email: 'ada@example.com',
      credits: 'Just For Laughs',
      walkOnMusicName: 'Nightcall',
      walkOnMusicArtist: 'Kavinsky',
      walkOnMusicTimestamp: '0:42',
      walkOnMusicLink: 'https://example.com/track',
    }));
    expect(result).toMatchObject({
      name: 'Ada Cole',
      socialMedia: '@adacole',
      email: 'ada@example.com',
      credits: 'Just For Laughs',
      walkOnMusicName: 'Nightcall',
      walkOnMusicArtist: 'Kavinsky',
      walkOnMusicTimestamp: '0:42',
      walkOnMusicLink: 'https://example.com/track',
    });
  });

  it('gives the entry its own id rather than reusing the performer’s', () => {
    const result = performerToComic(performer({ id: 'p1', name: 'Ada Cole' }));
    expect(result.id).not.toBe('p1');
  });

  it('files the trimmed name', () => {
    expect(performerToComic(performer({ name: '  Ada Cole  ' })).name).toBe('Ada Cole');
  });
});

describe('addPerformersToRolodex', () => {
  it('files someone who is not there yet', () => {
    const result = addPerformersToRolodex([], [performer({ name: 'Ada Cole' })]);
    expect(result?.map((c) => c.name)).toEqual(['Ada Cole']);
  });

  it('puts new entries at the top, in lineup order', () => {
    const result = addPerformersToRolodex(
      [comic({ id: 'c1', name: 'Jo Park' })],
      [performer({ id: 'p1', name: 'Ada Cole' }), performer({ id: 'p2', name: 'Miles Trent' })],
    );
    expect(result?.map((c) => c.name)).toEqual(['Ada Cole', 'Miles Trent', 'Jo Park']);
  });

  it('reports no change when everyone is already filed', () => {
    const existing = [comic({ id: 'c1', name: 'Ada Cole' })];
    expect(addPerformersToRolodex(existing, [performer({ name: 'Ada Cole' })])).toBeNull();
  });

  it('matches an existing entry through case and spacing', () => {
    const existing = [comic({ id: 'c1', name: 'Ada Cole' })];
    expect(addPerformersToRolodex(existing, [performer({ name: 'ada  COLE' })])).toBeNull();
  });

  it('leaves an existing entry alone rather than overwriting it with less', () => {
    const existing = [comic({ id: 'c1', name: 'Ada Cole', notes: 'Great closer', credits: 'JFL' })];
    const result = addPerformersToRolodex(existing, [performer({ name: 'Ada Cole' })]);
    expect(result).toBeNull();
    expect(existing[0].notes).toBe('Great closer');
  });

  it('files one entry when the same name appears twice in a lineup', () => {
    const result = addPerformersToRolodex([], [
      performer({ id: 'p1', name: 'Ada Cole' }),
      performer({ id: 'p2', name: 'ada cole' }),
    ]);
    expect(result).toHaveLength(1);
  });

  it('skips half-finished rows with no name', () => {
    expect(addPerformersToRolodex([], [performer({ name: '' }), performer({ name: '   ' })]))
      .toBeNull();
  });

  it('files the named performers even when a blank row sits among them', () => {
    const result = addPerformersToRolodex([], [
      performer({ id: 'p1', name: '' }),
      performer({ id: 'p2', name: 'Ada Cole' }),
    ]);
    expect(result?.map((c) => c.name)).toEqual(['Ada Cole']);
  });

  it('does not mutate the rolodex it was given', () => {
    const existing = [comic({ id: 'c1', name: 'Jo Park' })];
    addPerformersToRolodex(existing, [performer({ name: 'Ada Cole' })]);
    expect(existing).toHaveLength(1);
  });
});

/**
 * Booking someone off the Rolodex brings what is filed against them.
 *
 * This was written out by hand in two places and both had drifted: the
 * headshot was dropped by both, so a producer who had filed a face booked
 * them and got a blank circle on the Run Show board and nothing for the
 * flyer — with no sign anything had been lost.
 */
describe('booking a Rolodex entry onto a bill', () => {
  const filed = (): PotentialComic => ({
    id: 'c1',
    name: '  Nadia Okonjo  ',
    notes: 'Cannot do Thursdays',
    photo: 'media:headshot-abc',
    socialMedia: '@nadiaokonjo',
    email: 'nadia@example.com',
    credits: 'Two festivals and a late-night set',
    walkOnMusic: 'media:walkon-xyz',
    walkOnMusicName: 'Get Ur Freak On',
    walkOnMusicArtist: 'Missy Elliott',
    walkOnMusicTimestamp: '0:42',
    walkOnMusicLink: 'https://open.spotify.com/track/abc',
  });

  it('brings the headshot, which is the face on the board and the flyer', () => {
    expect(comicToPerformer(filed()).photo).toBe('media:headshot-abc');
  });

  it('brings every field the two types share', () => {
    // Structural rather than a list of names: a field added to both types in
    // future is covered by this the day it is added, which is exactly how the
    // headshot came to be missing.
    const comic = filed();
    const performer = comicToPerformer(comic);
    // `id` is new by design, `notes` stays behind, and `name` is trimmed on
    // the way — each asserted on its own below.
    const skip = new Set(['id', 'notes', 'name']);
    const carried = Object.keys(comic).filter((key) => !skip.has(key) && key in performer);
    expect(carried.length).toBeGreaterThan(7);
    for (const key of carried) {
      expect(
        performer[key as keyof typeof performer],
        `${key} should come with them`,
      ).toBe(comic[key as keyof PotentialComic]);
    }
  });

  it('gives them their own id, because a booking is a copy and not a reference', () => {
    const comic = filed();
    const one = comicToPerformer(comic);
    const two = comicToPerformer(comic);
    expect(one.id).not.toBe(comic.id);
    expect(one.id).not.toBe(two.id);
  });

  it('tidies the name, and leaves the producer’s private note behind', () => {
    const performer = comicToPerformer(filed());
    expect(performer.name).toBe('Nadia Okonjo');
    // "Pays late" belongs to the Rolodex entry, not to one night's lineup.
    expect(JSON.stringify(performer)).not.toContain('Thursdays');
  });

  it('carries nothing that was never filed, rather than inventing blanks', () => {
    const performer = comicToPerformer({ id: 'c2', name: 'Dev Marchetti' });
    expect(performer.name).toBe('Dev Marchetti');
    expect(performer.photo).toBeUndefined();
    expect(performer.email).toBeUndefined();
  });

  it('round-trips: filed, booked, and filed again keeps what it started with', () => {
    const back = performerToComic(comicToPerformer(filed()));
    expect(back.photo).toBe('media:headshot-abc');
    expect(back.email).toBe('nadia@example.com');
    expect(back.walkOnMusicArtist).toBe('Missy Elliott');
  });
});

import { describe, it, expect } from 'vitest';
import { rolodexKey, performerToComic, addPerformersToRolodex } from './rolodex';
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

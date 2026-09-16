import { describe, it, expect } from 'vitest';
import {
  addPerformersToRolodex,
  comicToPerformer,
  comicToArtist,
  getComicProfilePatch,
  reconcileRolodexProfiles,
  resolvePerformerComic,
  syncShowsWithRolodex,
  performerToComic,
  rolodexKey,
} from './rolodex';
import type { Performer, PotentialComic, Show } from '../types';

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
    // The show-slot id is new and the name is trimmed; every profile field follows.
    const skip = new Set(['id', 'name']);
    const carried = Object.keys(comic).filter((key) => !skip.has(key) && key in performer);
    expect(carried.length).toBeGreaterThan(7);
    for (const key of carried) {
      expect(
        performer[key as keyof typeof performer],
        `${key} should come with them`,
      ).toBe(comic[key as keyof PotentialComic]);
    }
  });

  it('gives each booking its own slot id and keeps the shared comic identity', () => {
    const comic = filed();
    const one = comicToPerformer(comic);
    const two = comicToPerformer(comic);
    expect(one.id).not.toBe(comic.id);
    expect(one.id).not.toBe(two.id);
    expect(one.comicId).toBe(comic.id);
    expect(two.comicId).toBe(comic.id);
  });

  it('tidies the name and brings the shared private producer notes', () => {
    const performer = comicToPerformer(filed());
    expect(performer.name).toBe('Nadia Okonjo');
    expect(performer.notes).toBe('Cannot do Thursdays');
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

const show = (id: string, performers: Performer[], over: Partial<Show> = {}): Show => ({
  id, performers, name: id, date: '2026-10-01', time: '20:00', location: '', venueName: '',
  status: 'upcoming', artists: [], schedule: [], hosts: [], djSongs: [], staff: [], expenses: [],
  createdAt: '', updatedAt: '', ...over,
});

describe('shared Rolodex identities', () => {
  it('migrates legacy shows together, keeping canonical values and gathering missing details', () => {
    const comics = [comic({ id: 'ada', name: 'Ada Cole', credits: 'Current intro' })];
    const shows = [
      show('first', [performer({ id: 'first-slot', name: ' ada  cole ', credits: 'Old intro', photo: 'media:headshot' })]),
      show('second', [performer({ id: 'second-slot', name: 'Ada Cole', email: 'ada@example.com', phone: '5551234567' })]),
    ];
    const result = reconcileRolodexProfiles(comics, shows);
    expect(result.comics[0]).toMatchObject({
      id: 'ada', credits: 'Current intro', photo: 'media:headshot', email: 'ada@example.com', phone: '5551234567',
    });
    for (const migrated of result.shows) {
      expect(migrated.performers[0]).toMatchObject({
        comicId: 'ada', name: 'Ada Cole', credits: 'Current intro', photo: 'media:headshot',
        email: 'ada@example.com', phone: '5551234567',
      });
    }
    expect(result.shows.map((s) => s.performers[0].id)).toEqual(['first-slot', 'second-slot']);
    expect(comics[0].photo).toBeUndefined();
    expect(shows[0].performers[0].comicId).toBeUndefined();
    const again = reconcileRolodexProfiles(result.comics, result.shows);
    expect(again.comics).toBe(result.comics);
    expect(again.shows).toBe(result.shows);
  });

  it('files an unfiled performer once and links their old show appearances', () => {
    const result = reconcileRolodexProfiles([], [
      show('one', [performer({ id: 'slot-one', name: 'Ada Cole', photo: 'media:face' })]),
      show('two', [performer({ id: 'slot-two', name: 'ADA COLE', socialMedia: '@ada' })]),
    ]);
    expect(result.comics).toHaveLength(1);
    expect(result.comics[0]).toMatchObject({ photo: 'media:face', socialMedia: '@ada' });
    expect(result.shows.map((s) => s.performers[0].comicId)).toEqual([result.comics[0].id, result.comics[0].id]);
  });

  it('does not merge ambiguous duplicate names or replace a missing explicit identity by name', () => {
    const comics = [
      comic({ id: 'ada-one', name: 'Ada Cole', photo: 'media:one' }),
      comic({ id: 'ada-two', name: 'ada  cole', photo: 'media:two' }),
    ];
    const ambiguous = performer({ id: 'legacy', name: 'Ada Cole', email: 'unknown@example.com' });
    const linked = performer({ id: 'known', comicId: 'ada-two', name: 'Old name' });
    const deleted = performer({ id: 'deleted', comicId: 'removed-id', name: 'Ada Cole', photo: 'media:deleted' });
    expect(resolvePerformerComic(ambiguous, comics)).toBeUndefined();
    expect(resolvePerformerComic(linked, comics)?.id).toBe('ada-two');
    expect(resolvePerformerComic(deleted, comics)).toBeUndefined();
    const result = reconcileRolodexProfiles(comics, [show('one', [ambiguous, linked, deleted])]);
    expect(result.comics).toBe(comics);
    expect(result.shows[0].performers[0]).toBe(ambiguous);
    expect(result.shows[0].performers[1]).toMatchObject({ comicId: 'ada-two', photo: 'media:two' });
    expect(result.shows[0].performers[2]).toBe(deleted);
  });

  it('propagates explicit clears and never resurrects them from linked old snapshots on reload', () => {
    const comics = [comic({ id: 'ada', name: 'Ada Cole', socialMedia: '', photo: 'media:current' })];
    const old = performer({
      id: 'slot', comicId: 'ada', name: 'Ada Cole', photo: 'media:old', socialMedia: '@old',
      walkOnMusic: 'media:old-audio', walkOnStartSec: 4, walkOnEndSec: 12,
    });
    const result = reconcileRolodexProfiles(comics, [show('one', [old])]);
    expect(result.comics).toBe(comics);
    expect(result.shows[0].performers[0]).toMatchObject({
      photo: 'media:current', socialMedia: '', walkOnMusic: undefined, walkOnStartSec: undefined, walkOnEndSec: undefined,
    });
    expect(reconcileRolodexProfiles(result.comics, result.shows).shows).toBe(result.shows);
  });

  it('a Rolodex entry that has lost its headshot does not take the booking’s with it', () => {
    // The settings save that carried the photo failed, raced another device,
    // or came back from an older copy. The show still has the face.
    const comics = [comic({ id: 'ada', name: 'Ada Cole', socialMedia: '@ada' })];
    const booked = performer({ id: 'slot', comicId: 'ada', name: 'Ada Cole', photo: 'media:face', socialMedia: '@stale' });
    const synced = syncShowsWithRolodex(comics, [show('one', [booked])]);
    expect(synced[0].performers[0]).toMatchObject({ photo: 'media:face', socialMedia: '@ada' });

    const result = reconcileRolodexProfiles(comics, [show('one', [booked])]);
    expect(result.comics[0].photo).toBe('media:face');
    expect(result.shows[0].performers[0]).toMatchObject({ comicId: 'ada', photo: 'media:face', socialMedia: '@ada' });
    expect(comics[0].photo).toBeUndefined();
    const again = reconcileRolodexProfiles(result.comics, result.shows);
    expect(again.comics).toBe(result.comics);
    expect(again.shows).toBe(result.shows);
  });

  it('a booking without a headshot leaves the Rolodex entry alone', () => {
    const comics = [comic({ id: 'ada', name: 'Ada Cole' })];
    const booked = performer({ id: 'slot', comicId: 'ada', name: 'Ada Cole' });
    const result = reconcileRolodexProfiles(comics, [show('one', [booked])]);
    expect(result.comics).toBe(comics);
    expect(result.shows[0].performers[0]).toBe(booked);
  });

  it('removing a headshot on purpose clears every booking and is not brought back', () => {
    const cleared = comic({ id: 'ada', name: 'Ada Cole' });
    const shows = [
      show('one', [performer({ id: 'slot-one', comicId: 'ada', name: 'Ada Cole', photo: 'media:face' })]),
      show('two', [], { artists: [{ id: 'slot-two', comicId: 'ada', name: 'Ada Cole', photo: 'media:face', artistType: 'Poetry' }] }),
    ];
    const clearedPhotos = new Set(['ada']);
    const synced = syncShowsWithRolodex([cleared], shows, { clearedPhotos });
    expect(synced[0].performers[0].photo).toBeUndefined();
    expect(synced[1].artists[0]).toMatchObject({ photo: undefined, artistType: 'Poetry' });

    const result = reconcileRolodexProfiles([cleared], shows, { clearedPhotos });
    expect(result.comics).toEqual([cleared]);
    expect(result.shows.map((s) => [...s.performers, ...s.artists][0].photo)).toEqual([undefined, undefined]);
  });

  it('renames profile and linked schedule name without changing slot identity, custom cues, or other show data', () => {
    const schedule = [
      { id: 'cue', time: '20:00', description: 'Set', performerId: 'slot', performer: 'Ada Cole' },
      { id: 'custom', time: '20:15', description: 'Duo', performerId: 'slot', performer: 'Ada with guests' },
    ];
    const original = show('one', [performer({ id: 'slot', comicId: 'ada', name: 'Ada Cole' })], {
      schedule, productionNotes: 'Keep the signed contract unchanged',
    });
    const result = syncShowsWithRolodex([comic({ id: 'ada', name: 'Ada Newname' })], [original]);
    expect(result[0].performers[0]).toMatchObject({ id: 'slot', comicId: 'ada', name: 'Ada Newname' });
    expect(result[0].schedule[0]).toMatchObject({ id: 'cue', performerId: 'slot', performer: 'Ada Newname' });
    expect(result[0].schedule[1]).toBe(schedule[1]);
    expect(result[0].productionNotes).toBe(original.productionNotes);
    expect(result[0].hosts).toBe(original.hosts);
    expect(original.schedule[0].performer).toBe('Ada Cole');
  });

  it('shares all personal fields, media, and trim points with linked artist bookings while preserving their role', () => {
    const current = comic({
      id: 'ada', name: 'Ada Cole', photo: 'media:headshot', videoLink: 'https://example.com/reel',
      walkOnMusic: 'media:audio', walkOnStartSec: 0, walkOnEndSec: 18, notes: 'Private profile note', phone: '5551234567',
    });
    const artist = { ...comicToArtist(current), artistType: 'Spoken word' };
    expect(artist.comicId).toBe('ada');
    expect(artist.walkOnStartSec).toBe(0);
    const original = show('one', [], { artists: [{ ...artist, photo: undefined, notes: 'Outdated' }] });
    const synced = syncShowsWithRolodex([current], [original])[0].artists[0];
    expect(synced).toMatchObject({
      id: artist.id, comicId: 'ada', artistType: 'Spoken word', photo: 'media:headshot',
      notes: 'Private profile note', phone: '5551234567', videoLink: 'https://example.com/reel', walkOnEndSec: 18,
    });
  });

  it('migrates uniquely matched legacy artists but does not file unrelated artists as comics', () => {
    const comics = [comic({ id: 'ada', name: 'Ada Cole' })];
    const unrelated = { id: 'artist-other', name: 'House Band', artistType: 'Music' };
    const result = reconcileRolodexProfiles(comics, [show('one', [], { artists: [
      { id: 'artist-ada', name: 'ada cole', artistType: 'Poetry', credits: 'Artist intro' }, unrelated,
    ] })]);
    expect(result.comics).toHaveLength(1);
    expect(result.comics[0].credits).toBe('Artist intro');
    expect(result.shows[0].artists[0]).toMatchObject({ id: 'artist-ada', comicId: 'ada', name: 'Ada Cole', artistType: 'Poetry' });
    expect(result.shows[0].artists[1]).toBe(unrelated);
  });

  it('writes only edits back to the canonical profile while preserving explicit clears', () => {
    const before = performer({ id: 'slot', comicId: 'ada', name: 'Ada Cole', photo: 'media:old', credits: 'Old intro' });
    const after = { ...before, credits: 'New intro', email: undefined };
    const canonical = comic({ id: 'ada', name: 'Ada Cole', photo: 'media:new', credits: 'Old intro', email: 'new@example.com' });
    const patch = getComicProfilePatch(before, after);
    expect(patch).toEqual({ credits: 'New intro' });
    expect({ ...canonical, ...patch }).toMatchObject({ photo: 'media:new', email: 'new@example.com', credits: 'New intro' });
    const clear = getComicProfilePatch(before, { ...before, photo: undefined });
    expect(clear).toHaveProperty('photo', undefined);
    expect(Object.hasOwn(clear, 'comicId')).toBe(false);
    expect(Object.hasOwn(clear, 'id')).toBe(false);
    expect(performerToComic(before).id).toBe('ada');
  });
});

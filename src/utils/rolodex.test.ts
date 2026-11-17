import { describe, it, expect } from 'vitest';
import {
  addPerformersToRolodex,
  claimHostEntry,
  reassignSlot,
  slotReassigned,
  comicToPerformer,
  comicToArtist,
  getComicProfilePatch,
  hostSocialEdits,
  reconcileRolodexProfiles,
  resolvePerformerComic,
  syncShowsWithRolodex,
  performerToComic,
  rolodexKey,
} from './rolodex';
import { retypeHost } from './showHosts';
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

describe('walk-on rows on the DJ lists of other shows', () => {
  // A new walk-on or a rename reached every booking, but only the show being
  // edited had its DJ row kept in step. The others handed the DJ the old song,
  // and after a rename their row was never found again.
  const booked = performer({ id: 'b-slot', comicId: 'ada', name: 'Ada Cole', walkOnMusicName: 'Song1.mp3' });
  const row = { id: 'row', title: 'Song1', artist: 'Ada Cole', notes: 'Walk-on: Ada Cole' };
  const house = { id: 'house', title: 'House music', artist: 'DJ' };

  it('retitles the row when the walk-on changes', () => {
    const [synced] = syncShowsWithRolodex(
      [comic({ id: 'ada', name: 'Ada Cole', walkOnMusicName: 'Song2.mp3' })],
      [show('b', [booked], { djSongs: [house, row] })],
    );
    expect(synced.djSongs).toEqual([house, { ...row, title: 'Song2' }]);
  });

  it('relabels the row when the name changes, so it is still theirs', () => {
    const [synced] = syncShowsWithRolodex(
      [comic({ id: 'ada', name: 'Ada Cole-Smith', walkOnMusicName: 'Song1.mp3' })],
      [show('b', [], { artists: [{ ...booked, artistType: 'Poetry' }], djSongs: [row] })],
    );
    expect(synced.djSongs).toEqual([{ ...row, artist: 'Ada Cole-Smith', notes: 'Walk-on: Ada Cole-Smith' }]);
  });

  it('leaves the DJ list as it was when nothing about the walk-on changed', () => {
    const original = show('b', [booked], { djSongs: [house, row] });
    const [synced] = syncShowsWithRolodex(
      [comic({ id: 'ada', name: 'Ada Cole', walkOnMusicName: 'Song1.mp3', credits: 'New intro' })],
      [original],
    );
    expect(synced.performers[0].credits).toBe('New intro');
    expect(synced.djSongs).toBe(original.djSongs);
  });
});

describe('typing a different name over a booked slot', () => {
  const sam = { id: 'sam', name: 'Sam Okafor', photo: 'media:sam', socialMedia: '@samokafor', credits: 'Sam credits' };

  it('is a different act, not a rename of the one on file', () => {
    expect(slotReassigned({ name: 'Sam Okafor' }, { name: 'Alex Rivera' })).toBe(true);
    // Fixing the spelling or the spacing is still Sam.
    expect(slotReassigned({ name: 'sam okafor' }, { name: 'Sam  Okafor ' })).toBe(false);
    expect(slotReassigned({ name: 'Sam Okafor' }, { name: '' })).toBe(false);
  });

  it('takes the old act\'s headshot and profile off the slot, and keeps what the edit typed', () => {
    const slot = performer({
      id: 'slot', comicId: 'sam', name: 'Alex Rivera',
      photo: 'media:sam', socialMedia: '@alexrivera', credits: 'Sam credits',
    });
    const rebooked = reassignSlot(slot, sam);
    // Sam's photo and credits came with the link and go with it; the handle
    // was typed for Alex in the same edit and is Alex's.
    expect(rebooked).toMatchObject({ id: 'slot', name: 'Alex Rivera', socialMedia: '@alexrivera' });
    expect(rebooked.comicId).toBeUndefined();
    expect(rebooked.photo).toBeUndefined();
    expect(rebooked.credits).toBeUndefined();
  });
});

describe('a surprise guest and the Rolodex', () => {
  const guest = performer({
    id: 'slot', comicId: 'miles', name: 'Miles Trent', socialMedia: '@miles', surpriseGuest: true,
  });

  it('files the person, not the surprise: the flag never reaches their entry', () => {
    const filed = performerToComic(guest);
    expect(filed).toMatchObject({ id: 'miles', name: 'Miles Trent', socialMedia: '@miles' });
    expect(Object.hasOwn(filed, 'surpriseGuest')).toBe(false);
    const added = addPerformersToRolodex([], [{ ...guest, comicId: undefined }]);
    expect(added).toHaveLength(1);
    expect(Object.hasOwn(added![0], 'surpriseGuest')).toBe(false);
  });

  it('books them off the Rolodex as a regular, whatever they were on another night', () => {
    const booked = comicToPerformer(comic({ id: 'miles', name: 'Miles Trent', socialMedia: '@miles' }));
    expect(booked.surpriseGuest).toBeUndefined();
  });

  it('does not write switching the flag back to their entry as a profile change', () => {
    const before = { ...guest, surpriseGuest: undefined };
    expect(getComicProfilePatch(before, guest)).toEqual({});
  });

  it('keeps the flag on the booking when the Rolodex refreshes it, and nowhere else', () => {
    const comics = [comic({ id: 'miles', name: 'Miles Trent', socialMedia: '@milestrent' })];
    const elsewhere = performer({ id: 'other-slot', comicId: 'miles', name: 'Miles Trent' });
    const synced = syncShowsWithRolodex(comics, [show('tonight', [guest]), show('next-week', [elsewhere])]);
    expect(synced[0].performers[0]).toMatchObject({ socialMedia: '@milestrent', surpriseGuest: true });
    expect(synced[1].performers[0].surpriseGuest).toBeUndefined();
    const reconciled = reconcileRolodexProfiles(comics, [show('tonight', [guest])]);
    expect(reconciled.shows[0].performers[0].surpriseGuest).toBe(true);
    expect(Object.hasOwn(reconciled.comics[0], 'surpriseGuest')).toBe(false);
  });

  it('keeps a guest slot a guest slot when a different act is typed over it', () => {
    const rebooked = reassignSlot({ ...guest, name: 'Rae Sun' }, guest);
    expect(rebooked).toMatchObject({ name: 'Rae Sun', surpriseGuest: true });
  });
});

describe('a host and the Rolodex', () => {
  const jo = comic({ id: 'c-jo', name: 'Jo Park', socialMedia: '@jopark' });
  const dev = comic({ id: 'c-dev', name: 'Dev Okonjo' });

  it('keeps a picked host’s handle in step with their entry, on every show they host', () => {
    const shows = [
      show('friday', [], { host: 'Jo Park', hostSocial: '@jopark', hostComicId: 'c-jo' }),
      show('saturday', [], { host: 'Dev Okonjo', hostComicId: 'c-dev', coHost: 'Jo Park', coHostSocial: '@jopark', coHostComicId: 'c-jo' }),
      show('sunday', [], { host: 'Jo Park', hostSocial: '@typed' }),
    ];
    const synced = syncShowsWithRolodex([{ ...jo, socialMedia: '@jo.park.comedy' }, { ...dev, socialMedia: '@devokonjo' }], shows);
    expect(synced[0]).toMatchObject({ host: 'Jo Park', hostSocial: '@jo.park.comedy' });
    expect(synced[1]).toMatchObject({ hostSocial: '@devokonjo', coHostSocial: '@jo.park.comedy' });
    // Typed by hand, linked to nobody: theirs to keep.
    expect(synced[2]).toBe(shows[2]);
  });

  it('clears the handle on the show when it is cleared on the entry', () => {
    const [synced] = syncShowsWithRolodex(
      [{ ...jo, socialMedia: undefined }],
      [show('friday', [], { host: 'Jo Park', hostSocial: '@jopark', hostComicId: 'c-jo' })],
    );
    expect(synced.hostSocial).toBeUndefined();
    expect(synced.hostComicId).toBe('c-jo');
  });

  it('follows a rename, and takes the host’s cues with it', () => {
    const before = show('friday', [], {
      host: 'Jo Park', hostSocial: '@jopark', hostComicId: 'c-jo',
      schedule: [
        { id: 's1', time: '0:00', description: 'Welcome', performer: 'Jo Park' },
        { id: 's2', time: '5:00', description: 'Jo Park’s favourite bit' },
        { id: 's3', time: '9:00', description: 'Set', performer: 'Jo Park', performerId: 'someone-else' },
      ],
    });
    const [synced] = syncShowsWithRolodex([{ ...jo, name: 'Jo Park-Lee' }], [before], { renamedFrom: [jo] });
    expect(synced).toMatchObject({ host: 'Jo Park-Lee', hostSocial: '@jopark', hostComicId: 'c-jo' });
    expect(synced.schedule.map((cue) => cue.performer)).toEqual(['Jo Park-Lee', undefined, 'Jo Park']);
    expect(synced.schedule[1]).toBe(before.schedule[1]);
    // The same rename made from a show page reaches the shows through reconcile.
    const reconciled = reconcileRolodexProfiles([{ ...jo, name: 'Jo Park-Lee' }], [before], { renamedFrom: [jo] });
    expect(reconciled.shows[0]).toMatchObject({ host: 'Jo Park-Lee', hostComicId: 'c-jo' });
  });

  it('keeps a host changed by a writer that only knows the name, rather than putting the entry’s back', () => {
    // An older build spreads the show and sets `host`: the link and the
    // handle it has never heard of ride along beside the new name.
    const linked = show('friday', [], {
      host: 'Jo Park', hostSocial: '@jopark', hostComicId: 'c-jo',
      schedule: [{ id: 's1', time: '0:00', description: 'Welcome', performer: 'Sam Reyes' }],
    });
    const edited = { ...linked, host: 'Sam Reyes' };
    for (const [synced] of [syncShowsWithRolodex([jo, dev], [edited]), reconcileRolodexProfiles([jo, dev], [edited]).shows]) {
      expect(synced.host).toBe('Sam Reyes');
      // Jo's handle would tag Sam as Jo.
      expect(synced.hostSocial).toBeUndefined();
      expect(synced.hostComicId).toBeUndefined();
      expect(synced.schedule).toBe(edited.schedule);
    }
    // Settled: the next pass has nothing to do, and Jo's entry is untouched.
    const result = reconcileRolodexProfiles([jo, dev], [edited]);
    expect(result.comics).toEqual([jo, dev]);
    expect(reconcileRolodexProfiles(result.comics, result.shows).shows).toBe(result.shows);
    // Even with the Rolodex's last state to hand: Jo was not renamed.
    expect(syncShowsWithRolodex([jo, dev], [edited], { renamedFrom: [jo, dev] })[0].host).toBe('Sam Reyes');
  });

  it('links a host an older writer changed to someone on file to that person', () => {
    const edited = show('friday', [], { host: 'Dev Okonjo', hostSocial: '@jopark', hostComicId: 'c-jo' });
    const withHandle = { ...dev, socialMedia: '@devokonjo' };
    const result = reconcileRolodexProfiles([jo, withHandle], [edited]);
    expect(result.shows[0]).toMatchObject({ host: 'Dev Okonjo', hostSocial: '@devokonjo', hostComicId: 'c-dev' });
    expect(result.comics).toEqual([jo, withHandle]);
  });

  it('leaves a host an older writer took off the show off it', () => {
    const cleared = show('friday', [], {
      host: undefined, hostSocial: '@jopark', hostComicId: 'c-jo',
      coHost: 'Dev Okonjo', coHostComicId: 'c-dev',
    });
    const [synced] = reconcileRolodexProfiles([jo, dev], [cleared]).shows;
    expect(synced.host).toBeUndefined();
    expect(synced.hostSocial).toBeUndefined();
    expect(synced.hostComicId).toBeUndefined();
    expect(synced).toMatchObject({ coHost: 'Dev Okonjo', coHostComicId: 'c-dev' });
  });

  it('leaves a spelling the Rolodex reads as the same name as it was typed', () => {
    // Still being typed: a trailing space must not be corrected under the cursor.
    const typing = show('friday', [], { host: 'jo park ', hostSocial: '@jopark', hostComicId: 'c-jo' });
    expect(syncShowsWithRolodex([jo], [typing])[0]).toBe(typing);
  });

  it('hands back the same shows when no host changed', () => {
    const shows = [show('friday', [], { host: 'Jo Park', hostSocial: '@jopark', hostComicId: 'c-jo' })];
    expect(syncShowsWithRolodex([jo, dev], shows)).toBe(shows);
  });

  it('leaves a host alone whose entry was removed from the Rolodex', () => {
    const orphan = show('friday', [], { host: 'Jo Park', hostSocial: '@jopark', hostComicId: 'c-gone' });
    expect(syncShowsWithRolodex([dev], [orphan])[0]).toBe(orphan);
  });

  it('links a host typed by name to the one person on file with that name, and gives them their handle', () => {
    // Saved before hosts had handles: the name alone.
    const legacy = show('friday', [], { host: 'jo park' });
    const result = reconcileRolodexProfiles([jo, dev], [legacy]);
    expect(result.shows[0]).toMatchObject({ host: 'jo park', hostSocial: '@jopark', hostComicId: 'c-jo' });
    expect(result.comics).toEqual([jo, dev]);
  });

  it('never files a handle typed beside a host on an entry while the show is reconciled', () => {
    // Reconciling runs on every keystroke, and "Dev Okonjo" may be a name
    // that is not finished: the host keeps the handle and the entry stays bare.
    const typed = show('friday', [], { host: 'Jo Park', coHost: 'Dev Okonjo', coHostSocial: '@devokonjo' });
    const result = reconcileRolodexProfiles([jo, dev], [typed]);
    expect(result.comics).toEqual([jo, dev]);
    expect(result.shows[0]).toMatchObject({
      hostSocial: '@jopark', hostComicId: 'c-jo', coHost: 'Dev Okonjo', coHostSocial: '@devokonjo',
    });
    expect(result.shows[0].coHostComicId).toBeUndefined();
  });

  it('keeps a typed handle on the host, and off the entries their name passes through', () => {
    const al = comic({ id: 'c-al', name: 'Al' });
    let comics = [al, jo];
    let current = show('friday', [], { hostSocial: '@alice' });
    // The handle first, then the name a key at a time, as the show page sends it.
    for (const name of ['A', 'Al', 'Ali', 'Alic', 'Alice']) {
      const edited = retypeHost(current, 'host', name);
      comics = hostSocialEdits(current, edited, comics);
      const result = reconcileRolodexProfiles(comics, [edited], { renamedFrom: comics });
      comics = result.comics;
      [current] = result.shows;
      expect(current).toMatchObject({ host: name, hostSocial: '@alice' });
      expect(current.hostComicId).toBeUndefined();
    }
    expect(comics).toEqual([al, jo]);
  });

  it('files a handle typed beside a host on their entry once the field is left, when the entry had none', () => {
    const typed = show('friday', [], { host: 'Jo Park', coHost: 'dev okonjo', coHostSocial: ' @devokonjo ' });
    const claimed = claimHostEntry(typed, 'coHost', [jo, dev]);
    expect(claimed).toMatchObject({ coHost: 'dev okonjo', coHostSocial: '@devokonjo', coHostComicId: 'c-dev' });
    const comics = hostSocialEdits(typed, claimed, [jo, dev]);
    expect(comics.find((c) => c.id === 'c-dev')?.socialMedia).toBe('@devokonjo');
    // From here the host follows the entry like any other picked from it.
    const result = reconcileRolodexProfiles(comics, [claimed], { renamedFrom: [jo, dev] });
    expect(result.shows[0]).toMatchObject({ coHostSocial: '@devokonjo', coHostComicId: 'c-dev' });
    expect(result.comics).toBe(comics);
  });

  it('claims no entry for a host with no handle, a handle of the entry’s own, or a name two people share', () => {
    const bare = show('friday', [], { host: 'Dev Okonjo' });
    expect(claimHostEntry(bare, 'host', [jo, dev])).toBe(bare);
    const other = show('friday', [], { host: 'Jo Park', hostSocial: '@adifferentjo' });
    expect(claimHostEntry(other, 'host', [jo, dev])).toBe(other);
    const twins = show('friday', [], { host: 'Dev Okonjo', hostSocial: '@devokonjo' });
    expect(claimHostEntry(twins, 'host', [dev, comic({ id: 'c-dev-2', name: 'Dev Okonjo' })])).toBe(twins);
    const picked = show('friday', [], { host: 'Dev Okonjo', hostSocial: '@devokonjo', hostComicId: 'c-dev' });
    expect(claimHostEntry(picked, 'host', [jo, dev])).toBe(picked);
    const empty = show('friday', [], {});
    expect(claimHostEntry(empty, 'coHost', [jo, dev])).toBe(empty);
  });

  it('does not swap a different handle typed beside a host for the entry’s', () => {
    const typed = show('friday', [], { host: 'Jo Park', hostSocial: '@adifferentjo' });
    const result = reconcileRolodexProfiles([jo], [typed]);
    expect(result.shows[0]).toBe(typed);
    expect(result.comics).toEqual([jo]);
  });

  it('links a host whose typed handle is the entry’s, however each was written', () => {
    const typed = show('friday', [], { host: 'Jo Park', hostSocial: 'https://instagram.com/JoPark' });
    expect(reconcileRolodexProfiles([jo], [typed]).shows[0]).toMatchObject({ hostComicId: 'c-jo', hostSocial: '@jopark' });
  });

  it('never files a host in the Rolodex, and links nobody when two entries share the name', () => {
    const stranger = show('friday', [], { host: 'Your host', hostSocial: '@yourhost' });
    const twins = show('saturday', [], { host: 'Jo Park' });
    const result = reconcileRolodexProfiles([jo, comic({ id: 'c-jo-2', name: 'Jo Park' })], [stranger, twins]);
    expect(result.comics.map((c) => c.id)).toEqual(['c-jo', 'c-jo-2']);
    expect(result.shows[0]).toBe(stranger);
    expect(result.shows[1]).toBe(twins);
  });

  it('writes a handle edited beside a picked host back to their entry', () => {
    const before = show('friday', [], { host: 'Jo Park', hostSocial: '@jopark', hostComicId: 'c-jo', coHost: 'Dev Okonjo', coHostComicId: 'c-dev' });
    const edited = hostSocialEdits(before, { ...before, hostSocial: ' @jo.park ', coHostSocial: '@devokonjo' }, [jo, dev]);
    expect(edited.map((c) => c.socialMedia)).toEqual(['@jo.park', '@devokonjo']);
    const cleared = hostSocialEdits(before, { ...before, hostSocial: undefined }, [jo, dev]);
    expect(cleared[0].socialMedia).toBeUndefined();
  });

  it('writes nothing back for a host just picked, typed over, or typed by hand', () => {
    const comics = [jo, dev];
    const before = show('friday', [], { host: 'Jo Park', hostSocial: '@jopark', hostComicId: 'c-jo' });
    // Picked someone else: their handle is their own entry's already.
    expect(hostSocialEdits(before, { ...before, host: 'Dev Okonjo', hostSocial: undefined, hostComicId: 'c-dev' }, comics)).toBe(comics);
    // Typed over: the new host is not Jo.
    expect(hostSocialEdits(before, { ...before, host: 'Sam Reyes', hostSocial: '@samreyes', hostComicId: undefined }, comics)).toBe(comics);
    const typed = show('saturday', [], { host: 'Sam Reyes' });
    expect(hostSocialEdits(typed, { ...typed, hostSocial: '@samreyes' }, comics)).toBe(comics);
    expect(hostSocialEdits(before, before, comics)).toBe(comics);
    // Picked from the list with a handle the entry does not have: a handle
    // is only filed for the name it was typed beside.
    const sam = show('sunday', [], { host: 'Sam Reyes', hostSocial: '@samreyes' });
    expect(hostSocialEdits(sam, { ...sam, host: 'Dev Okonjo', hostComicId: 'c-dev' }, comics)).toBe(comics);
    // And never over a handle the entry already has.
    const joTyped = show('monday', [], { host: 'Jo Park', hostSocial: '@adifferentjo' });
    expect(hostSocialEdits(joTyped, { ...joTyped, hostComicId: 'c-jo' }, comics)).toBe(comics);
  });
});

import { describe, expect, it } from 'vitest';
import type { PotentialComic, Show } from '../types';
import {
  checkNewComic,
  describeNewPersonProblem,
  knownPeople,
  needsText,
  newComicOk,
  newPeopleProblems,
  normalizeSocial,
  normalizeTapeUrl,
  ownerRefusal,
} from './newComics';
import { fullSettings, fullShow } from './testFixtures';
import type { EditPayload, SettingsFieldEdit, ShowEdit } from './types';

const TAPE = 'https://youtu.be/abc123';
const good = { id: 'n1', name: 'Jo Park', videoLink: TAPE, tapeMinutes: 5, socialMedia: '@jopark' };

describe('one new person', () => {
  it('passes with a name, a tape, its length and social media, and nothing else', () => {
    expect(checkNewComic(good)).toEqual({ missing: [], extra: [] });
    expect(newComicOk(checkNewComic({ ...good, tapeMinutes: 10 }))).toBe(true);
    expect(newComicOk(checkNewComic({ ...good, socialMedia: 'https://facebook.com/profile.php?id=7' }))).toBe(true);
  });

  it('names each missing piece', () => {
    expect(checkNewComic({ ...good, name: '   ' }).missing).toEqual(['name']);
    expect(checkNewComic({ id: 'n1', videoLink: TAPE, tapeMinutes: 5, socialMedia: '@jo' }).missing).toEqual(['name']);
    expect(checkNewComic({ ...good, videoLink: undefined }).missing).toEqual(['tape']);
    expect(checkNewComic({ ...good, videoLink: '' }).missing).toEqual(['tape']);
    expect(checkNewComic({ ...good, tapeMinutes: undefined }).missing).toEqual(['length']);
    expect(checkNewComic({ ...good, socialMedia: undefined }).missing).toEqual(['social']);
    expect(checkNewComic({ ...good, socialMedia: '  ' }).missing).toEqual(['social']);
    expect(checkNewComic({ id: 'n1', name: 'Jo Park' }).missing).toEqual(['tape', 'length', 'social']);
    expect(checkNewComic(null).missing).toEqual(['name', 'tape', 'length', 'social']);
  });

  it('refuses a tape link that is not an http or https address', () => {
    for (const bad of ['not a link', 'javascript:alert(1)', 'ftp://example.com/a.mp4', 'https://', 'https://user:pw@example.com/v', 'data:text/html,hi', ' https://youtu.be/a', 'https://localhost', 42]) {
      expect(checkNewComic({ ...good, videoLink: bad }).missing, String(bad)).toEqual(['tape']);
    }
    expect(checkNewComic({ ...good, videoLink: 'http://vimeo.com/1' }).missing).toEqual([]);
  });

  it('takes a tape of 5 or 10 minutes and no other length', () => {
    for (const bad of [7, 0, 15, '5', '10', 5.5, true, null]) {
      expect(checkNewComic({ ...good, tapeMinutes: bad }).missing, String(bad)).toEqual(['length']);
    }
  });

  it('refuses social media the app cannot read as a handle or a link', () => {
    for (const bad of ['jo park', 'see my page', '@', 7]) {
      expect(checkNewComic({ ...good, socialMedia: bad }).missing, String(bad)).toEqual(['social']);
    }
  });

  it('refuses every other profile field', () => {
    const extras: Partial<PotentialComic> = {
      email: 'jo@example.com', phone: '555', notes: 'Paid 50', credits: 'TV', photo: 'media:abcdefgh#1',
      walkOnMusic: 'media:abcdefgh#1', walkOnMusicName: 'Song', walkOnMusicArtist: 'Band', walkOnMusicTimestamp: '0:10',
      walkOnMusicLink: 'https://example.com/t', walkOnStartSec: 0, walkOnEndSec: 9,
    };
    for (const [key, value] of Object.entries(extras)) {
      expect(checkNewComic({ ...good, [key]: value }), key).toEqual({ missing: [], extra: [key] });
    }
    expect(checkNewComic({ ...good, pay: 100 }).extra).toEqual(['pay']);
    // A key that holds nothing says nothing, as once saved.
    expect(checkNewComic({ ...good, email: undefined, notes: '', phone: null }).extra).toEqual([]);
  });

  it('lets a booking say how they are booked, and a Rolodex entry not', () => {
    const booking = { ...good, comicId: 'n1', surpriseGuest: true, artistType: 'Musician' };
    expect(checkNewComic(booking, 'booking')).toEqual({ missing: [], extra: [] });
    expect(checkNewComic(booking, 'rolodex').extra).toEqual(['comicId', 'surpriseGuest', 'artistType']);
    expect(checkNewComic({ ...booking, email: 'a@b.co' }, 'booking').extra).toEqual(['email']);
  });
});

describe('what is typed, as it is stored', () => {
  it('reads a tape link, adding https:// to one typed without it', () => {
    expect(normalizeTapeUrl('  https://youtu.be/abc  ')).toBe('https://youtu.be/abc');
    expect(normalizeTapeUrl('youtube.com/watch?v=1')).toBe('https://youtube.com/watch?v=1');
    expect(normalizeTapeUrl('')).toBeNull();
    expect(normalizeTapeUrl('my tape')).toBeNull();
    expect(normalizeTapeUrl('javascript:alert(1)')).toBeNull();
  });

  it('reads social media with the app’s own helpers', () => {
    expect(normalizeSocial('jopark')).toBe('@jopark');
    expect(normalizeSocial('@jopark')).toBe('@jopark');
    expect(normalizeSocial('https://www.instagram.com/jopark/')).toBe('@jopark');
    expect(normalizeSocial('tiktok.com/@jo.park')).toBe('@jo.park');
    expect(normalizeSocial('https://facebook.com/profile.php?id=7')).toBe('https://facebook.com/profile.php?id=7');
    expect(normalizeSocial('jo park')).toBeNull();
    // Not a handle and not anybody's profile: punctuation, a bare scheme, a script, a site's front page, a post, a share link.
    for (const bad of ['.', '-', '_', '@', '@.', 'https://', 'http://', 'javascript:alert(1)', 'https://instagram.com/', 'instagram.com/', 'https://facebook.com', 'https://facebook.com/', 'https://instagram.com/p/abc', 'https://www.tiktok.com/t/ZT8abc']) {
      expect(normalizeSocial(bad), bad).toBeNull();
    }
    expect(normalizeSocial('_jo_')).toBe('@_jo_');
    expect(normalizeSocial('jo.park-1')).toBe('@jo.park-1');
    expect(normalizeSocial('https://youtube.com/channel/UC123')).toBe('https://youtube.com/channel/UC123');
    expect(normalizeSocial('')).toBeNull();
    expect(normalizeSocial(undefined)).toBeNull();
  });

  it('says what is missing in words', () => {
    expect(needsText(['tape'])).toBe('a tape link');
    expect(needsText(['tape', 'length', 'social'])).toBe('a tape link, the tape’s length (5 or 10 minutes) and their social media');
  });
});

// ── Whole requests ─────────────────────────────────────────────────────────

const settings = fullSettings();
const show = fullShow();
const known = knownPeople([show], settings);
const sam = settings.potentialComics[0];

function rolodexAdd(...added: Record<string, unknown>[]): SettingsFieldEdit {
  const before = settings.potentialComics.map((comic) => comic.id);
  return {
    field: 'potentialComics', kind: 'rows', idField: 'id',
    baseOrder: before,
    proposedOrder: [...added.map((row) => row.id as string), ...before],
    base: [],
    proposed: added.map((row) => [row.id as string, row]),
  };
}
function edit(shows: ShowEdit[], ...fields: SettingsFieldEdit[]): EditPayload {
  return { kind: 'edit', shows, settings: fields.length ? { target: 'settings', baseRevision: null, fields } : null };
}
function lineup(list: 'performers' | 'artists', ...added: Record<string, unknown>[]): ShowEdit {
  return {
    target: 'show', op: 'update', showId: show.id, baseRevision: null, keys: [list],
    base: { [list]: show[list] },
    proposed: { [list]: [...show[list], ...added] },
  } as unknown as ShowEdit;
}
const summary = (payload: EditPayload, people = known) =>
  newPeopleProblems(payload, people).map((p) => `${p.who}: ${p.unknownLink ? 'unknown link' : [...p.missing, ...p.extra].join(',')}`);

describe('who the owner already has', () => {
  it('knows the Rolodex, and who is on a show or in Recently deleted without an entry', () => {
    const drew: Show = { ...show, id: 'other', performers: [{ id: 'p9', name: ' Drew  Bare ' }], artists: [{ id: 'a9', name: 'The Band' }, { id: 'a8', name: 'Linked', comicId: 'gone' }] };
    const people = knownPeople([drew], { potentialComics: [sam], trash: [{ id: 't', type: 'show', deletedAt: '', data: { ...show, performers: [{ id: 'p8', name: 'Old Act' }] } }] });
    // Only entries the Rolodex has: a link left behind by a deleted entry is nobody's.
    expect([...people.comicIds]).toEqual([sam.id]);
    expect([...people.linkNames.get('gone') ?? []]).toEqual(['linked']);
    expect(people.unfiled.get('drew bare')).toEqual([{ id: 'p9', name: ' Drew  Bare ' }]);
    expect(people.rolodexNames.has('sam lee')).toBe(true);
    expect(people.performerNames.has('drew bare')).toBe(true);
    expect(people.performerNames.has('old act')).toBe(true);
    expect(people.artistNames.has('the band')).toBe(true);
    expect(people.artistNames.has('linked')).toBe(false);
  });
});

describe('a request that brings someone new', () => {
  it('passes a new Rolodex entry with the three things', () => {
    expect(summary(edit([], rolodexAdd(good)))).toEqual([]);
    expect(newPeopleProblems(edit([], rolodexAdd(good)))).toEqual([]);
  });

  it('refuses a new Rolodex entry missing any of them, or carrying more, with or without the owner’s data', () => {
    const noTape = { id: 'n1', name: 'Jo Park', socialMedia: '@jo' };
    const payload = edit([], rolodexAdd(noTape, { ...good, id: 'n2', name: 'Al', email: 'al@example.com' }, { ...good, id: 'n3', tapeMinutes: 7 }));
    expect(summary(payload)).toEqual(['Jo Park: tape,length', 'Al: email', 'Jo Park: length']);
    expect(newPeopleProblems(payload).map((p) => p.path)).toEqual([
      'settings.fields[0].proposed[0][1]', 'settings.fields[0].proposed[1][1]', 'settings.fields[0].proposed[2][1]',
    ]);
  });

  it('leaves an edit to someone already in the Rolodex alone', () => {
    const row = sam as unknown as Record<string, unknown>;
    const changed: SettingsFieldEdit = {
      field: 'potentialComics', kind: 'rows', idField: 'id', baseOrder: [sam.id], proposedOrder: [sam.id],
      base: [[sam.id, row]], proposed: [[sam.id, { ...row, email: 'new@example.com', videoLink: undefined, tapeMinutes: undefined }]],
    };
    expect(summary(edit([], changed))).toEqual([]);
  });

  // Decided, not overlooked: renaming an entry the owner has is an edit to it.
  // The owner's inbox shows the old name beside the new one.
  it('treats a new name for an entry the Rolodex has as an edit, not as someone new', () => {
    const row = sam as unknown as Record<string, unknown>;
    const renamed: SettingsFieldEdit = {
      field: 'potentialComics', kind: 'rows', idField: 'id', baseOrder: [sam.id], proposedOrder: [sam.id],
      base: [[sam.id, row]], proposed: [[sam.id, { ...row, name: 'Samuel Lee' }]],
    };
    expect(summary(edit([], renamed))).toEqual([]);
  });

  it('lets someone already in the Rolodex be booked, with their whole profile', () => {
    const booked = { ...sam, id: 'slot1', comicId: sam.id };
    expect(summary(edit([lineup('performers', booked)]))).toEqual([]);
    expect(summary(edit([lineup('artists', { ...booked, artistType: 'Musician' })]))).toEqual([]);
  });

  it('passes a new name on a bill with its new Rolodex entry, both with the three things', () => {
    const slot = { ...good, id: 'slot1', comicId: 'n1', surpriseGuest: true };
    expect(summary(edit([lineup('performers', slot)], rolodexAdd(good)))).toEqual([]);
  });

  it('refuses a booking of someone new that carries more than their entry may', () => {
    const slot = { ...good, id: 'slot1', comicId: 'n1', photo: 'media:abcdefgh#1' };
    expect(summary(edit([lineup('performers', slot)], rolodexAdd(good)))).toEqual(['Jo Park: photo']);
    // Told from the payload alone, too.
    expect(newPeopleProblems(edit([lineup('performers', slot)], rolodexAdd(good)))).toHaveLength(1);
  });

  it('refuses a new name on a bill with no Rolodex entry behind it', () => {
    expect(summary(edit([lineup('performers', { id: 'slot1', name: 'Walk In', email: 'w@example.com' })]))).toEqual(['Walk In: tape,length,social,email']);
    expect(summary(edit([lineup('artists', { id: 'slot1', name: 'New Band' })]))).toEqual(['New Band: tape,length,social']);
    expect(summary(edit([lineup('artists', { ...good, id: 'slot1', artistType: 'Band' })]))).toEqual([]);
  });

  it('refuses a booking that points at a Rolodex entry nobody has', () => {
    expect(summary(edit([lineup('performers', { ...sam, id: 'slot1', comicId: 'made-up' })]))).toEqual(['Sam Lee: unknown link']);
  });

  it('checks every name on a new show', () => {
    const created: Show = { ...show, id: 'new-show', performers: [{ id: 's1', name: 'Sam Lee', comicId: sam.id, email: 'sam@example.com' }, { id: 's2', name: 'Fresh Face' }], artists: [] };
    const payload = edit([{ target: 'show', op: 'create', showId: created.id, show: created }]);
    expect(summary(payload)).toEqual(['Fresh Face: tape,length,social']);
    expect(newPeopleProblems(payload, known)[0].path).toBe('shows[0].show.performers[1]');
    // A bare name cannot be told new from the payload alone: the server and both apps bring the owner's data.
    expect(newPeopleProblems(payload)).toEqual([]);
  });

  it('treats a different name typed over a slot as someone new', () => {
    const unlinked: Show = { ...show, artists: [{ id: 'a1', name: 'The Band', email: 'band@example.com' }] };
    const people = knownPeople([unlinked], settings);
    const retype = (name: string): ShowEdit => ({
      target: 'show', op: 'update', showId: show.id, baseRevision: null, keys: ['artists'],
      base: { artists: unlinked.artists }, proposed: { artists: [{ ...unlinked.artists[0], name }] },
    });
    expect(summary(edit([retype('the  band')]), people)).toEqual([]);
    expect(summary(edit([retype('Other Band')]), people)).toEqual(['Other Band: tape,length,social,email']);
  });

  it('leaves someone already on a bill alone: edited, moved, copied to a new show, or filed by the app', () => {
    const legacy: Show = { ...show, performers: [{ id: 'p1', name: 'Old Hand', email: 'old@example.com' }], artists: [{ id: 'a1', name: 'The Band', notes: 'Loud' }] };
    const people = knownPeople([legacy], settings);
    const copy: Show = { ...legacy, id: 'copy', performers: [{ ...legacy.performers[0], id: 'p2' }], artists: [{ ...legacy.artists[0], id: 'a2' }] };
    expect(summary(edit([{ target: 'show', op: 'create', showId: 'copy', show: copy }]), people)).toEqual([]);
    // The app files a performer who has no entry: its bookkeeping, not a new person.
    const filed = { id: 'f1', name: 'Old Hand', email: 'old@example.com' };
    const linked: ShowEdit = {
      target: 'show', op: 'update', showId: show.id, baseRevision: null, keys: ['performers'],
      base: { performers: legacy.performers }, proposed: { performers: [{ ...legacy.performers[0], comicId: 'f1' }] },
    };
    expect(summary(edit([linked], rolodexAdd(filed)), people)).toEqual([]);
    // Without that performer on a bill, the same entry is someone new.
    expect(summary(edit([], rolodexAdd(filed)))).toEqual(['Old Hand: tape,length,social,email']);
  });

  it('has nothing to say about shares, downloads or other edits', () => {
    expect(newPeopleProblems({ kind: 'share', action: { type: 'viewer-link', showId: 's' } } as unknown as EditPayload, known)).toEqual([]);
    expect(summary(edit([{ target: 'show', op: 'update', showId: show.id, baseRevision: null, keys: ['venueName'], base: { venueName: 'A' }, proposed: { venueName: 'B' } }]))).toEqual([]);
  });
});

// A request made by hand can say anything about what was there before. Who
// is new is read from the owner's data, never from the request's own base.
describe('a hand-made request that lies about who was already there', () => {
  const extras = { email: 'n@b.co', notes: 'no tape' };
  const update = (list: 'performers' | 'artists', base: unknown[], proposed: unknown[]): ShowEdit => ({
    target: 'show', op: 'update', showId: show.id, baseRevision: null, keys: [list], base: { [list]: base }, proposed: { [list]: proposed },
  } as unknown as ShowEdit);

  it('refuses a new name typed over an unlinked booking behind a made-up link on both sides', () => {
    const mine: Show = { ...show, performers: [{ id: 'p2', name: 'Walk On' }], artists: [{ id: 'a1', name: 'House Band' }] };
    const people = knownPeople([mine], settings);
    expect(summary(edit([update('artists', [{ id: 'a1', name: 'House Band', comicId: 'zzz' }], [{ id: 'a1', name: 'Brand New Band', comicId: 'zzz', ...extras }])]), people))
      .toEqual(['Brand New Band: unknown link']);
    expect(summary(edit([update('performers', [{ id: 'p2', name: 'Walk On', comicId: 'zzz' }], [{ id: 'p2', name: 'Brand New Comic', comicId: 'zzz', ...extras }])]), people))
      .toEqual(['Brand New Comic: unknown link']);
    // The honest version of the same rename, as before.
    expect(summary(edit([update('artists', mine.artists, [{ id: 'a1', name: 'Brand New Band', ...extras }])]), people))
      .toEqual(['Brand New Band: tape,length,social,email,notes']);
  });

  it('refuses a new name behind a link whose Rolodex entry is gone, and leaves the booking that has it alone', () => {
    const gone = { id: 'p1', name: 'Gone Person', comicId: 'gone', email: 'gone@example.com' };
    const mine: Show = { ...show, performers: [gone], artists: [] };
    const people = knownPeople([mine], settings);
    expect(summary(edit([update('performers', [gone], [gone, { id: 'p-s', name: 'Sneak In', comicId: 'gone', ...extras }])]), people)).toEqual(['Sneak In: unknown link']);
    expect(summary(edit([update('performers', [gone], [{ ...gone, name: 'Sneak In' }])]), people)).toEqual(['Sneak In: unknown link']);
    // The owner's own booking, edited, moved or copied to a new show, is still theirs.
    expect(summary(edit([update('performers', [gone], [{ ...gone, name: 'gone  person', notes: 'Back in May' }])]), people)).toEqual([]);
    const copy: Show = { ...mine, id: 'copy', performers: [{ ...gone, id: 'p9' }] };
    expect(summary(edit([{ target: 'show', op: 'create', showId: 'copy', show: copy }]), people)).toEqual([]);
  });

  it('leaves a booking from an entry the owner has alone: approving writes that entry over it, name and all', () => {
    expect(summary(edit([lineup('performers', { id: 'p-s', name: 'Sneak In', comicId: sam.id, ...extras })]))).toEqual([]);
  });

  it('holds a Rolodex entry the owner does not have to the rule, whatever the request says was there', () => {
    const sneak = { id: 'c-sneak', name: 'Sneak In', email: 'x@y.co' };
    const ids = settings.potentialComics.map((comic) => comic.id);
    const lying = (base: [string, unknown][]): SettingsFieldEdit => ({
      field: 'potentialComics', kind: 'rows', idField: 'id', baseOrder: ['c-sneak', ...ids], proposedOrder: ['c-sneak', ...ids], base, proposed: [['c-sneak', sneak]],
    });
    expect(summary(edit([], lying([])))).toEqual(['Sneak In: tape,length,social,email']);
    expect(summary(edit([], lying([['c-sneak', { id: 'c-sneak', name: 'Sneak In' }]])))).toEqual(['Sneak In: tape,length,social,email']);
  });

  it('holds a name the owner has on no bill to the rule, whatever the request says was there', () => {
    const before = { id: 'p-s', name: 'Sneak In' };
    expect(summary(edit([update('performers', [...show.performers, before], [...show.performers, { ...before, email: 'x@y.co' }])])))
      .toEqual(['Sneak In: tape,length,social,email']);
  });

  it('lets the app file someone on a bill only as that booking has them', () => {
    const mine: Show = { ...show, performers: [{ id: 'p2', name: 'Walk On', phone: '555 0100' }] };
    const people = knownPeople([mine], settings);
    expect(summary(edit([], rolodexAdd({ id: 'c-w', name: 'walk on', phone: '555 0100' })), people)).toEqual([]);
    expect(summary(edit([], rolodexAdd({ id: 'c-w', name: 'walk on' })), people)).toEqual([]);
    expect(summary(edit([], rolodexAdd({ id: 'c-w', name: 'walk on', email: 'a@b.co', notes: 'n' })), people)).toEqual(['walk on: tape,length,social,email,notes']);
    expect(summary(edit([], rolodexAdd({ id: 'c-w', name: 'walk on', phone: '555 0199' })), people)).toEqual(['walk on: tape,length,social,phone']);
  });
});

describe('in words', () => {
  it('tells the co-producer who needs what', () => {
    const [missing] = newPeopleProblems(edit([], rolodexAdd({ id: 'n1', name: 'Jo Park', socialMedia: '@jo' })));
    expect(describeNewPersonProblem(missing)).toBe('Jo Park needs a tape link and the tape’s length (5 or 10 minutes).');
    const [extra] = newPeopleProblems(edit([], rolodexAdd({ ...good, email: 'a@b.co', photo: 'media:abcdefgh#1' })));
    expect(describeNewPersonProblem(extra)).toBe('Jo Park is new, so only a name, a tape and social media can be sent. Take off their email and headshot.');
    const [both] = newPeopleProblems(edit([], rolodexAdd({ id: 'n1', name: '', videoLink: TAPE, tapeMinutes: 5, socialMedia: '@jo', notes: 'x' })));
    expect(describeNewPersonProblem(both)).toBe('Someone new needs a name. Also take off their notes.');
  });

  it('tells the owner why a request cannot be approved', () => {
    expect(ownerRefusal(newPeopleProblems(edit([], rolodexAdd({ id: 'n1', name: 'Jo Park' }))))).toContain('This adds Jo Park without what a new person needs');
    expect(ownerRefusal([{ path: '', who: 'Sam Lee', missing: [], extra: [], unknownLink: true }])).toBe('This books Sam Lee from a Rolodex entry you no longer have. It can’t be approved. Ask them to send it again.');
    expect(describeNewPersonProblem({ path: '', who: 'Sam Lee', missing: [], extra: [], unknownLink: true })).toBe('Sam Lee is booked from a Rolodex entry that isn’t there. Take them off and add them again.');
  });
});

import { describe, expect, it } from 'vitest';
import type { AppSettings, Show } from '../types';
import { normalizeComicSettings } from '../utils/sharedComicSettings';
import { buildEditPayload, sendBlocks, stagedMediaIds, type ReviewTruth } from './capture';
import { knownPeople } from './newComics';
import { validatePayload } from './schema';
import { clone, FIXTURE_SECRETS, fullSettings, fullShow } from './testFixtures';
import type { SettingsRowsEdit, SettingsValueEdit, ShowCreate, ShowDelete, ShowUpdate } from './types';

const PSEUDO = {
  view: 'redacted-0123456789abcdef0123456789abcdef',
  trashView: 'redacted-fedcba9876543210fedcba9876543210',
  sign: 'redacted-11111111111111111111111111111111',
  profile: 'redacted-22222222222222222222222222222222',
};

/** The fixtures as the server serves them to a co-producer: link secrets swapped for pseudonyms. */
function servedShow(over: Partial<Show> = {}): Show {
  const show = clone(fullShow({ viewToken: PSEUDO.view, ...over })) as Show;
  delete show.viewerKey;
  return show;
}

function servedSettings(): AppSettings {
  const settings = clone(fullSettings()) as AppSettings;
  settings.trash[0].data.viewToken = PSEUDO.trashView;
  delete settings.trash[0].data.viewerKey;
  settings.signatureRequests[0] = { ...settings.signatureRequests[0], token: PSEUDO.sign, key: '' };
  settings.profileRequests![0] = { ...settings.profileRequests![0], token: PSEUDO.profile, key: '' };
  return settings;
}

function truth(shows: Show[] = [servedShow()], settings: AppSettings = servedSettings()): ReviewTruth {
  return { shows, settings, showRevisions: Object.fromEntries(shows.map((s) => [s.id, `rev-${s.id}`])), settingsRevision: 'rev-settings' };
}

function working(t: ReviewTruth) {
  return { shows: clone(t.shows), settings: clone(t.settings) };
}

const ORIGINS = { appOrigins: ['https://icanrunashow.com', 'https://showrunner-theta.vercel.app'] };

describe('buildEditPayload', () => {
  it('is null when nothing changed, copies included', () => {
    const t = truth();
    expect(buildEditPayload(t, { shows: t.shows, settings: t.settings })).toBeNull();
    expect(buildEditPayload(t, working(t))).toBeNull();
  });

  it('is null for bookkeeping only: timestamps, stored profit, a viewer key, link-row upkeep', () => {
    const t = truth();
    t.settings.signatureRequests[0] = { ...t.settings.signatureRequests[0], contactId: undefined, profileFiled: undefined };
    const w = working(t);
    w.shows[0] = { ...w.shows[0], updatedAt: '2030-01-01T00:00:00.000Z', viewerKey: 'a-device-key', recap: { ...w.shows[0].recap!, profitLoss: 999 } };
    w.settings = normalizeComicSettings(w.settings, w.settings);
    expect(w.settings.signatureRequests[0].contactId).toBe('c1');
    expect(buildEditPayload(t, w)).toBeNull();
  });

  it('creates a show without any viewer link', () => {
    const t = truth();
    const w = working(t);
    const added = { ...servedShow({ id: 'new-show', name: 'New Night' }), viewerKey: 'device-key' };
    w.shows.unshift(added);
    const payload = buildEditPayload(t, w)!;
    expect(payload.shows).toHaveLength(1);
    const create = payload.shows[0] as ShowCreate;
    expect(create).toMatchObject({ target: 'show', op: 'create', showId: 'new-show' });
    expect(create.show.name).toBe('New Night');
    expect('viewToken' in create.show).toBe(false);
    expect('viewerKey' in create.show).toBe(false);
    expect(validatePayload(payload, ORIGINS).problems).toEqual([]);
  });

  it('updates only the keys that differ, an unset value as absent', () => {
    const t = truth();
    const w = working(t);
    w.shows[0] = { ...w.shows[0], venueName: 'The Attic', updatedAt: 'later' };
    delete w.shows[0].ticketLink;
    const payload = buildEditPayload(t, w)!;
    const update = payload.shows[0] as ShowUpdate;
    expect(update).toMatchObject({ op: 'update', showId: t.shows[0].id, baseRevision: `rev-${t.shows[0].id}` });
    expect([...update.keys].sort()).toEqual(['ticketLink', 'venueName']);
    expect(update.base).toEqual({ venueName: t.shows[0].venueName, ticketLink: t.shows[0].ticketLink });
    expect(update.proposed).toEqual({ venueName: 'The Attic' });
    expect(payload.settings).toBeNull();
    expect(validatePayload(payload, ORIGINS).problems).toEqual([]);
  });

  it('carries a whole list when a row in it changes', () => {
    const t = truth();
    const w = working(t);
    w.shows[0] = { ...w.shows[0], todos: [...w.shows[0].todos!, { id: 't-new', text: 'Print setlist', completed: false }] };
    const update = buildEditPayload(t, w)!.shows[0] as ShowUpdate;
    expect(update.keys).toEqual(['todos']);
    expect(update.proposed.todos).toHaveLength(t.shows[0].todos!.length + 1);
  });

  it('deletes with the show as it was', () => {
    const t = truth();
    const w = working(t);
    w.shows = [];
    w.settings.deletedShowIds = [t.shows[0].id, ...(w.settings.deletedShowIds ?? [])];
    w.settings.trash = [{ id: 'trash-new', type: 'show', data: t.shows[0], deletedAt: 'now' }, ...w.settings.trash];
    const payload = buildEditPayload(t, w)!;
    const del = payload.shows[0] as ShowDelete;
    expect(del).toMatchObject({ op: 'delete', showId: t.shows[0].id, baseRevision: `rev-${t.shows[0].id}` });
    expect(del.base).toEqual(t.shows[0]);
    // The trash entry and the deleted record are the owner's app's to make.
    expect(payload.settings).toBeNull();
    expect(validatePayload(payload, ORIGINS).problems).toEqual([]);
  });

  it('encodes settings values and rows as [id, row] pairs with whole orders', () => {
    const t = truth();
    const w = working(t);
    w.settings.brandName = 'New Brand';
    w.settings.potentialComics = [
      { id: 'c-new', name: 'Jo', videoLink: 'https://youtu.be/jo', tapeMinutes: 5, socialMedia: '@jo' },
      { ...w.settings.potentialComics[0], notes: 'Closes strong.' },
    ];
    w.settings.emailList = [];
    const payload = buildEditPayload(t, w)!;
    const fields = payload.settings!.fields;
    expect(payload.settings!.baseRevision).toBe('rev-settings');
    const brand = fields.find((f) => f.field === 'brandName') as SettingsValueEdit;
    expect(brand).toEqual({ field: 'brandName', kind: 'value', base: 'Laugh Co', proposed: 'New Brand' });
    const comics = fields.find((f) => f.field === 'potentialComics') as SettingsRowsEdit;
    expect(comics).toMatchObject({ kind: 'rows', idField: 'id', baseOrder: ['c1'], proposedOrder: ['c-new', 'c1'] });
    expect(comics.base.map(([id]) => id)).toEqual(['c1']);
    expect(comics.proposed.map(([id]) => id)).toEqual(['c-new', 'c1']);
    const emails = fields.find((f) => f.field === 'emailList') as SettingsRowsEdit;
    expect(emails).toMatchObject({ idField: 'email', baseOrder: ['fan@example.com'], proposedOrder: [], proposed: [] });
    expect(emails.base.map(([id]) => id)).toEqual(['fan@example.com']);
    expect(validatePayload(payload, ORIGINS).problems).toEqual([]);
  });

  it('carries a reorder alone', () => {
    const t = truth();
    t.settings.producers = [{ id: 'a', name: 'A', role: 'x' }, { id: 'b', name: 'B', role: 'y' }];
    const w = working(t);
    w.settings.producers = [w.settings.producers[1], w.settings.producers[0]];
    const rows = buildEditPayload(t, w)!.settings!.fields[0] as SettingsRowsEdit;
    expect(rows).toMatchObject({ field: 'producers', baseOrder: ['a', 'b'], proposedOrder: ['b', 'a'], base: [], proposed: [] });
  });

  it('keeps only removals from trash and link rows', () => {
    const t = truth();
    const w = working(t);
    w.settings.trash = [{ id: 'trash-new', type: 'show', data: servedShow({ id: 'gone' }), deletedAt: 'now' }];
    w.settings.signatureRequests = [{ ...w.settings.signatureRequests[0], signerEmail: 'changed@example.com' }];
    w.settings.profileRequests = [];
    const fields = buildEditPayload(t, w)!.settings!.fields;
    const trash = fields.find((f) => f.field === 'trash') as SettingsRowsEdit;
    expect(trash).toMatchObject({ baseOrder: ['tr1'], proposedOrder: [], proposed: [] });
    expect(trash.base.map(([id]) => id)).toEqual(['tr1']);
    expect(fields.some((f) => f.field === 'signatureRequests')).toBe(false);
    const profiles = fields.find((f) => f.field === 'profileRequests') as SettingsRowsEdit;
    expect(profiles).toMatchObject({ idField: 'token', baseOrder: [PSEUDO.profile], proposedOrder: [] });
  });

  it('never carries deletedShowIds or onboarded', () => {
    const t = truth();
    const w = working(t);
    w.settings.deletedShowIds = ['x', 'y'];
    w.settings.onboarded = false;
    expect(buildEditPayload(t, w)).toBeNull();
  });

  it('keeps a restored show’s pseudonymous link, and drops one on any other new show', () => {
    const t = truth();
    const w = working(t);
    const restored = t.settings.trash[0].data;
    w.settings.trash = [];
    w.shows = [clone(restored), ...w.shows, servedShow({ id: 'copy', viewToken: PSEUDO.trashView })];
    const payload = buildEditPayload(t, w)!;
    const creates = payload.shows.filter((e): e is ShowCreate => e.op === 'create');
    expect(creates.find((c) => c.showId === restored.id)!.show.viewToken).toBe(PSEUDO.trashView);
    expect('viewToken' in creates.find((c) => c.showId === 'copy')!.show).toBe(false);
    expect(validatePayload(payload, ORIGINS).problems).toEqual([]);
  });

  it('never carries a secret', () => {
    const t = truth();
    const w = working(t);
    w.shows[0] = { ...w.shows[0], name: 'Renamed', viewerKey: FIXTURE_SECRETS.viewerKey };
    w.shows.push({ ...servedShow({ id: 'n2' }), viewerKey: FIXTURE_SECRETS.trashViewerKey, viewToken: FIXTURE_SECRETS.viewToken });
    const text = JSON.stringify(buildEditPayload(t, w));
    for (const secret of Object.values(FIXTURE_SECRETS)) expect(text).not.toContain(secret);
  });

  it('names the staged files a payload brings in', () => {
    const t = truth();
    const w = working(t);
    const fresh = 'media:99999999-aaaa-bbbb-cccc-000000000001#1';
    const other = 'media:99999999-aaaa-bbbb-cccc-000000000002#1';
    w.shows[0] = { ...w.shows[0], flyer: fresh };
    w.settings.potentialComics = [{ ...w.settings.potentialComics[0], photo: other }];
    const payload = buildEditPayload(t, w)!;
    const staged = new Set(['99999999-aaaa-bbbb-cccc-000000000001', 'not-in-payload']);
    expect(stagedMediaIds(payload, staged)).toEqual(['99999999-aaaa-bbbb-cccc-000000000001']);
  });

  // Someone new comes with a name, a tape and social media (newComics.ts).
  it('says why an edit that brings someone new cannot be sent yet, and nothing when it can', () => {
    const t = truth();
    const w = working(t);
    w.settings.potentialComics = [{ id: 'c-new', name: 'Jo Park', socialMedia: '@jo' }, ...w.settings.potentialComics];
    w.shows[0] = { ...w.shows[0], artists: [...w.shows[0].artists, { id: 'a-new', name: 'New Band', email: 'band@example.com' }] };
    expect(sendBlocks(buildEditPayload(t, w)!, t)).toEqual([
      'Jo Park needs a tape link and the tape’s length (5 or 10 minutes).',
      'New Band needs a tape link, the tape’s length (5 or 10 minutes) and their social media. Also take off their email.',
    ]);
    const tape = { videoLink: 'https://youtu.be/tape', tapeMinutes: 5 as const, socialMedia: '@handle' };
    w.settings.potentialComics[0] = { id: 'c-new', name: 'Jo Park', ...tape };
    w.shows[0] = { ...w.shows[0], artists: [...t.shows[0].artists, { id: 'a-new', name: 'New Band', ...tape }] };
    const payload = buildEditPayload(t, w)!;
    expect(sendBlocks(payload, t)).toEqual([]);
    expect(validatePayload(payload, { ...ORIGINS, people: knownPeople(t.shows, t.settings) }).problems).toEqual([]);
    // Booking someone already in the Rolodex, and editing them, holds nothing.
    const again = working(t);
    const sam = again.settings.potentialComics[0];
    again.settings.potentialComics[0] = { ...sam, notes: 'Closes strong.' };
    again.shows[0] = { ...again.shows[0], performers: [...again.shows[0].performers, { ...sam, id: 'p-again', comicId: sam.id }] };
    expect(sendBlocks(buildEditPayload(t, again)!, t)).toEqual([]);
  });
});

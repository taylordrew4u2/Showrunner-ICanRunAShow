import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { applySchema } from '../../api/_lib/db';
import type { AssistantGrant } from '../../api/_lib/assistantCore';
import { ASSISTANT_TOOLS, callAssistantTool } from '../../api/_lib/assistantTools';
import { cipherHash } from '../../api/_lib/showWrites';
import { DEFAULT_SETTINGS, type AppSettings, type Show } from '../types';
import { duplicateShow } from './duplicateShow';
import { decryptWithKey, encryptWithKey } from './encryption';
import { recapMoney } from './recapMoney';
import { MAX_TRASH_ITEMS } from './trash';

const ALL = 'shows:read shows:write shows:delete rolodex:read rolodex:write contracts:read links:send';
const key = 'a'.repeat(64);
const grant: AssistantGrant = { userId: 'producer', key, legacyKey: 'b'.repeat(64), scope: ALL };
const origin = 'https://example.test';
let db: Client;
let dir: string;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'assistant-shows-'));
  db = createClient({ url: `file:${join(dir, 'test.db')}` });
  await applySchema(db);
});
afterEach(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });

type Result = { show: Record<string, unknown> & { id: string }; revision: string; notes?: string[] } & Record<string, unknown>;
const call = (name: string, args: unknown, scope = ALL) => callAssistantTool({ db, grant: { ...grant, scope }, origin }, name, args) as Promise<Result>;

function fixture(id = 'friday'): Show {
  return {
    id, name: 'Friday Comedy', date: '2026-12-04', time: '20:00', venueName: 'The Cellar', location: 'Chicago', status: 'upcoming',
    performers: [
      { id: 'p-sam', comicId: 'c-sam', name: 'Sam Okafor', email: 'sam@example.com', photo: 'media:sam-photo#1', walkOnMusicName: 'Sam Song.mp3', walkOnMusic: 'media:sam-song#1' },
      { id: 'p-ada', name: 'Ada Cole' },
      { id: 'p-guest', name: 'Mystery Act', surpriseGuest: true },
      { id: 'p-lee', name: 'Lee Park' },
    ],
    artists: [{ id: 'a-robin', name: 'Robin', artistType: 'Singer' }],
    schedule: [
      { id: 'cue-1', time: '20:00', description: 'Doors', music: 'media:doors#1' },
      { id: 'cue-2', time: '20:10', description: 'Sam Okafor opens', performer: 'Sam Okafor', performerId: 'p-sam' },
    ],
    hosts: [], staff: [], expenses: [],
    djSongs: [{ id: 'dj-sam', title: 'Sam Song', artist: 'Sam Okafor', notes: 'Walk-on: Sam Okafor' }],
    vendors: [{ id: 'v-bar', name: 'Bar Co', category: 'Bar', cost: 150, booked: true }],
    recap: { attendance: 80, ticketSales: 900, merchSales: 100, otherCosts: 200, profitLoss: 1 },
    productionNotes: 'Keep the opener short', viewToken: 'secret-view-token', viewerKey: 'secret-viewer-key',
    createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z',
  };
}

const settingsFixture = (patch: Partial<AppSettings> = {}): AppSettings => ({
  ...DEFAULT_SETTINGS, brandName: 'Night Owl Comedy', onboarded: true,
  potentialComics: [
    { id: 'c-sam', name: 'Sam Okafor', email: 'sam@example.com', photo: 'media:sam-photo#1', walkOnMusicName: 'Sam Song.mp3', walkOnMusic: 'media:sam-song#1' },
    { id: 'c-jo', name: 'Jo Banks', socialMedia: '@jobanks', credits: 'As seen on TV', walkOnMusicName: 'Jo Theme.mp3' },
  ],
  ...patch,
});

async function seedShow(show: Show = fixture()) {
  const cipher = encryptWithKey(show, key);
  await db.execute({ sql: 'INSERT INTO user_shows (id, user_id, encrypted_data) VALUES (?, ?, ?)', args: [show.id, grant.userId, cipher] });
  return cipherHash(cipher);
}
async function seedSettings(settings: AppSettings = settingsFixture()) {
  await db.execute({ sql: 'INSERT INTO user_settings (user_id, encrypted_data) VALUES (?, ?)', args: [grant.userId, encryptWithKey(settings, key)] });
}

/** What the browser would decrypt. */
async function stored(id = 'friday'): Promise<Show> {
  const row = (await db.execute({ sql: 'SELECT encrypted_data FROM user_shows WHERE id = ?', args: [id] })).rows[0];
  return decryptWithKey<Show>(String(row[0]), key);
}
async function storedSettings(): Promise<AppSettings> {
  return decryptWithKey<AppSettings>(String((await db.execute('SELECT encrypted_data FROM user_settings')).rows[0][0]), key);
}
async function revisionOf(id = 'friday') {
  return cipherHash(String((await db.execute({ sql: 'SELECT encrypted_data FROM user_shows WHERE id = ?', args: [id] })).rows[0][0]));
}

describe('get_show', () => {
  it('returns the whole show with surprise-guest marks and recap money, but never media or keys', async () => {
    const revision = await seedShow();
    const result = await call('get_show', { id: 'friday' });
    expect(result.revision).toBe(revision);
    expect(result.show).toMatchObject({
      productionNotes: 'Keep the opener short', hasViewerLink: true,
      performers: [
        { id: 'p-sam', comicId: 'c-sam', name: 'Sam Okafor', email: 'sam@example.com', hasPhoto: true, hasWalkOnAudio: true, surpriseGuest: false },
        { id: 'p-ada', surpriseGuest: false }, { id: 'p-guest', name: 'Mystery Act', surpriseGuest: true }, { id: 'p-lee' },
      ],
      artists: [{ id: 'a-robin', artistType: 'Singer' }],
      schedule: [{ id: 'cue-1', hasMusic: true }, { id: 'cue-2', performerId: 'p-sam' }],
      vendors: [{ id: 'v-bar', cost: 150, booked: true }],
      recap: { attendance: 80, money: recapMoney(fixture().recap, fixture().vendors) },
    });
    expect((result.show.recap as { money: { profitLoss: number } }).money.profitLoss).toBe(650);
    const text = JSON.stringify(result);
    for (const secret of ['media:', 'secret-view-token', 'secret-viewer-key', key]) expect(text).not.toContain(secret);
  });
});

describe('lineup', () => {
  it('books someone from the Rolodex with their profile, as the app would show them', async () => {
    await seedSettings();
    const revision = await seedShow();
    const result = await call('add_performer', { show_id: 'friday', expected_revision: revision, comic_id: 'c-jo' });
    const show = await stored();
    const jo = show.performers.find(p => p.id === result.bookingId)!;
    expect(jo).toMatchObject({ comicId: 'c-jo', name: 'Jo Banks', socialMedia: '@jobanks', credits: 'As seen on TV' });
    // ShowDetail.handleUpdate: the walk-on goes on the DJ list.
    expect(show.djSongs).toContainEqual(expect.objectContaining({ title: 'Jo Theme', artist: 'Jo Banks', notes: 'Walk-on: Jo Banks' }));
    expect(result.revision).toBe(await revisionOf());
  });

  it('files a new name in the Rolodex and books a surprise guest without telling the Rolodex', async () => {
    await seedSettings();
    const revision = await seedShow();
    const result = await call('add_performer', { show_id: 'friday', expected_revision: revision, name: ' Kit Lane ', email: 'kit@example.com', surprise_guest: true });
    const show = await stored();
    const kit = show.performers.find(p => p.id === result.bookingId)!;
    const filed = (await storedSettings()).potentialComics.find(c => c.name === 'Kit Lane')!;
    expect(kit).toMatchObject({ name: 'Kit Lane', email: 'kit@example.com', surpriseGuest: true, comicId: filed.id });
    expect(filed).toEqual({ id: filed.id, name: 'Kit Lane', email: 'kit@example.com' });
  });

  it('leaves filing a new name to the app when the connection may not write the Rolodex', async () => {
    await seedSettings();
    const revision = await seedShow();
    await call('add_performer', { show_id: 'friday', expected_revision: revision, name: 'Kit Lane' }, 'shows:read shows:write');
    expect((await stored()).performers.map(p => p.name)).toContain('Kit Lane');
    expect((await storedSettings()).potentialComics.map(c => c.name)).not.toContain('Kit Lane');
  });

  it('turns the surprise-guest mark on and off on the booking only', async () => {
    await seedSettings();
    let revision = await seedShow();
    revision = (await call('set_surprise_guest', { show_id: 'friday', expected_revision: revision, performer_id: 'p-sam', surprise_guest: true })).revision;
    expect((await stored()).performers.find(p => p.id === 'p-sam')?.surpriseGuest).toBe(true);
    expect(JSON.stringify(await storedSettings())).not.toContain('surpriseGuest');
    await call('set_surprise_guest', { show_id: 'friday', expected_revision: revision, performer_id: 'p-sam', surprise_guest: false });
    expect((await stored()).performers.find(p => p.id === 'p-sam')).not.toHaveProperty('surpriseGuest');
    await expect(call('set_surprise_guest', { show_id: 'friday', expected_revision: await revisionOf(), performer_id: 'a-robin', surprise_guest: true })).rejects.toThrow('Only performers');
  });

  it('moves performers among their own tab, stepping over surprise guests', async () => {
    const revision = await seedShow();
    await call('move_performer', { show_id: 'friday', expected_revision: revision, performer_id: 'p-lee', direction: 'up' });
    expect((await stored()).performers.map(p => p.id)).toEqual(['p-sam', 'p-lee', 'p-guest', 'p-ada']);
  });

  it('carries a booked person’s profile edit to their Rolodex entry and other bookings', async () => {
    await seedSettings();
    const revision = await seedShow();
    await seedShow({ ...fixture('saturday'), name: 'Saturday Comedy' });
    const result = await call('update_performer', { show_id: 'friday', expected_revision: revision, performer_id: 'p-sam', patch: { email: 'new@example.com', credits: 'Late Night' } });
    expect((await stored()).performers[0]).toMatchObject({ email: 'new@example.com', credits: 'Late Night', photo: 'media:sam-photo#1' });
    expect((await storedSettings()).potentialComics.find(c => c.id === 'c-sam')).toMatchObject({ email: 'new@example.com', credits: 'Late Night' });
    expect((await stored('saturday')).performers[0]).toMatchObject({ email: 'new@example.com', credits: 'Late Night' });
    // Credits are on the audience's viewer link, which only the app republishes.
    expect(result.notes).toEqual([
      'This show’s viewer link shows the lineup as it was until the producer next opens the show in the app, which updates it.',
      'Updated 1 more show where this person is booked to match.',
    ]);
  });

  it('says a viewer link still names a new surprise guest until the app republishes it', async () => {
    let revision = await seedShow();
    const hidden = await call('set_surprise_guest', { show_id: 'friday', expected_revision: revision, performer_id: 'p-ada', surprise_guest: true });
    expect(hidden.notes).toEqual(['This show’s viewer link still lists Ada Cole until the producer next opens the show in the app, which updates it. Tell them to open it now to keep the surprise.']);
    revision = hidden.revision;
    // Nothing on the bill changes: nothing to say.
    expect((await call('move_performer', { show_id: 'friday', expected_revision: revision, performer_id: 'p-guest', direction: 'up' })).notes).toBeUndefined();
    await db.execute({ sql: 'DELETE FROM user_shows' });
    const noLink = await seedShow({ ...fixture(), viewToken: undefined, viewerKey: undefined });
    expect((await call('set_surprise_guest', { show_id: 'friday', expected_revision: noLink, performer_id: 'p-ada', surprise_guest: true })).notes).toBeUndefined();
  });

  it('fills a booking in from the Rolodex only for a connection that may read it', async () => {
    await seedSettings(settingsFixture({ potentialComics: [{ id: 'c-kit', name: 'Kit Lane', email: 'kit@private.example', notes: 'Owes me money' }, { id: 'c-jo', name: 'Jo Banks' }] }));
    const revision = await seedShow();
    const result = await call('add_performer', { show_id: 'friday', expected_revision: revision, name: 'kit lane' }, 'shows:read shows:write');
    const text = JSON.stringify(result);
    for (const secret of ['kit@private.example', 'Owes me money', 'c-kit']) expect(text).not.toContain(secret);
    expect((await stored()).performers.find(p => p.id === result.bookingId)).toEqual({ id: result.bookingId, name: 'kit lane' });
    // Nor does a cue's text find someone in it.
    const cue = await call('add_cue', { show_id: 'friday', expected_revision: result.revision, description: 'Jo Banks closes' }, 'shows:read shows:write');
    expect((await stored()).schedule.find(c => c.id === cue.cueId)?.performer).toBeUndefined();
  });

  it('refuses a Rolodex profile edit without rolodex:write, leaving everything as it was', async () => {
    await seedSettings();
    const revision = await seedShow();
    await expect(call('update_performer', { show_id: 'friday', expected_revision: revision, performer_id: 'p-sam', patch: { email: 'x@example.com' } }, 'shows:read shows:write')).rejects.toThrow('rolodex:write');
    expect(await revisionOf()).toBe(revision);
  });

  it('asks whether a new name over a booked act is the same person, as the app does', async () => {
    await seedSettings();
    const revision = await seedShow();
    const rename = { show_id: 'friday', expected_revision: revision, performer_id: 'p-sam', patch: { name: 'Alex Rivera' } };
    await expect(call('update_performer', rename)).rejects.toThrow('same_person');
    await call('update_performer', { ...rename, same_person: false });
    const slot = (await stored()).performers[0];
    const comics = (await storedSettings()).potentialComics;
    // A different act: the old entry keeps its name and headshot, and the
    // spot is booked fresh without them.
    expect(comics.find(c => c.id === 'c-sam')).toMatchObject({ name: 'Sam Okafor', photo: 'media:sam-photo#1' });
    expect(slot).toMatchObject({ name: 'Alex Rivera' });
    expect(slot.photo).toBeUndefined();
    expect(slot.comicId).toBe(comics.find(c => c.name === 'Alex Rivera')?.id);
  });

  it('removes a booking and the walk-on row it put on the DJ list', async () => {
    await seedSettings();
    const revision = await seedShow();
    await call('remove_performer', { show_id: 'friday', expected_revision: revision, performer_id: 'p-sam', confirm: true });
    const show = await stored();
    expect(show.performers.map(p => p.id)).toEqual(['p-ada', 'p-guest', 'p-lee']);
    expect(show.djSongs).toEqual([]);
    expect((await storedSettings()).potentialComics.map(c => c.id)).toContain('c-sam');
  });
});

describe('running order, recap, staff and vendors', () => {
  it('adds, edits, moves and removes cues the way the cue editor does', async () => {
    let revision = await seedShow();
    const added = await call('add_cue', { show_id: 'friday', expected_revision: revision, time: '20:20', description: 'Ada Cole — 10 min', durationMin: 10, position: 1 });
    revision = added.revision;
    let show = await stored();
    expect(show.schedule.map(c => c.id)).toEqual(['cue-1', added.cueId, 'cue-2']);
    // A description naming someone the app knows fills in who is on stage.
    expect(show.schedule[1]).toMatchObject({ time: '20:20', description: 'Ada Cole — 10 min', performer: 'Ada Cole', durationMin: 10 });
    revision = (await call('update_cue', { show_id: 'friday', expected_revision: revision, cue_id: added.cueId as string, patch: { performer_id: 'p-lee', durationMin: null } })).revision;
    show = await stored();
    // OnStagePicker: picking someone on the bill puts their name on the cue.
    expect(show.schedule[1]).toMatchObject({ performerId: 'p-lee', performer: 'Lee Park' });
    expect(show.schedule[1].durationMin).toBeUndefined();
    // A name typed in, as OnStagePicker takes one, lets go of the link.
    revision = (await call('update_cue', { show_id: 'friday', expected_revision: revision, cue_id: 'cue-2', patch: { performer: 'Mystery Act' } })).revision;
    expect((await stored()).schedule.find(c => c.id === 'cue-2')).toEqual({ id: 'cue-2', time: '20:10', description: 'Sam Okafor opens', performer: 'Mystery Act' });
    revision = (await call('move_cue', { show_id: 'friday', expected_revision: revision, cue_id: 'cue-2', direction: 'up', steps: 5 })).revision;
    expect((await stored()).schedule.map(c => c.id)).toEqual(['cue-2', 'cue-1', added.cueId]);
    await call('remove_cue', { show_id: 'friday', expected_revision: revision, cue_id: 'cue-1', confirm: true });
    show = await stored();
    expect(show.schedule.map(c => c.id)).toEqual(['cue-2', added.cueId]);
  });

  it('records the recap and keeps its stored profit true to the figures', async () => {
    const revision = await seedShow();
    const result = await call('update_recap', { show_id: 'friday', expected_revision: revision, patch: { ticketSales: 1000, merchSales: null, improvementNotes: 'Start on time' } });
    const show = await stored();
    expect(show.recap).toEqual({ attendance: 80, ticketSales: 1000, otherCosts: 200, improvementNotes: 'Start on time', profitLoss: 650 });
    expect((result.show.recap as { money: unknown }).money).toEqual(recapMoney(show.recap, show.vendors));
  });

  it('manages staff and vendors, and a vendor’s cost reaches the recap', async () => {
    let revision = await seedShow();
    const staff = await call('add_staff', { show_id: 'friday', expected_revision: revision, role: 'Sound', personName: 'Dee', phone: '555-0101' });
    revision = (await call('update_staff', { show_id: 'friday', expected_revision: staff.revision, staff_id: staff.staffId as string, patch: { phone: '' } })).revision;
    expect((await stored()).staff).toEqual([{ id: staff.staffId, role: 'Sound', personName: 'Dee' }]);
    const vendor = await call('add_vendor', { show_id: 'friday', expected_revision: revision, name: 'Pizza Place', cost: 50 });
    let show = await stored();
    expect(show.vendors).toContainEqual({ id: vendor.vendorId, name: 'Pizza Place', category: 'Catering', booked: false, cost: 50 });
    expect(show.recap?.profitLoss).toBe(600);
    revision = (await call('update_vendor', { show_id: 'friday', expected_revision: vendor.revision, vendor_id: 'v-bar', patch: { cost: null, booked: false } })).revision;
    revision = (await call('remove_vendor', { show_id: 'friday', expected_revision: revision, vendor_id: vendor.vendorId as string, confirm: true })).revision;
    await call('remove_staff', { show_id: 'friday', expected_revision: revision, staff_id: staff.staffId as string, confirm: true });
    show = await stored();
    expect(show.vendors).toEqual([{ id: 'v-bar', name: 'Bar Co', category: 'Bar', booked: false }]);
    expect(show.staff).toEqual([]);
    expect(show.recap?.profitLoss).toBe(800);
  });

  it('duplicates a show by the app’s own rules', async () => {
    const revision = await seedShow();
    const result = await call('duplicate_show', { id: 'friday', expected_revision: revision, date: '2026-12-11' });
    const copy = await stored(result.show.id);
    const expected = duplicateShow(fixture(), { date: '2026-12-11' });
    expect(copy).toEqual({ ...expected, id: copy.id, createdAt: copy.createdAt, updatedAt: copy.updatedAt });
    expect(copy).toMatchObject({ name: 'Friday Comedy (copy)', performers: [], artists: [], status: 'upcoming' });
    expect(copy.viewToken).toBeUndefined();
    expect(await revisionOf()).toBe(revision);
  });

  it('refuses every kind of edit made over a stale revision and leaves the newer show alone', async () => {
    await seedSettings();
    const stale = await seedShow();
    await call('update_show', { id: 'friday', expected_revision: stale, patch: { name: 'Newer' } });
    const current = await revisionOf();
    const attempts: [string, Record<string, unknown>][] = [
      ['add_performer', { show_id: 'friday', name: 'Kit' }],
      ['update_performer', { show_id: 'friday', performer_id: 'p-ada', patch: { notes: 'x' } }],
      ['remove_performer', { show_id: 'friday', performer_id: 'p-ada', confirm: true }],
      ['move_performer', { show_id: 'friday', performer_id: 'p-ada', direction: 'up' }],
      ['set_surprise_guest', { show_id: 'friday', performer_id: 'p-ada', surprise_guest: true }],
      ['add_cue', { show_id: 'friday', description: 'Break' }],
      ['update_cue', { show_id: 'friday', cue_id: 'cue-1', patch: { time: '19:00' } }],
      ['remove_cue', { show_id: 'friday', cue_id: 'cue-1', confirm: true }],
      ['move_cue', { show_id: 'friday', cue_id: 'cue-2', direction: 'up' }],
      ['update_recap', { show_id: 'friday', patch: { attendance: 1 } }],
      ['add_staff', { show_id: 'friday', role: 'Door', personName: 'Pat' }],
      ['add_vendor', { show_id: 'friday', name: 'Rentals Inc' }],
      ['update_vendor', { show_id: 'friday', vendor_id: 'v-bar', patch: { notes: 'x' } }],
      ['remove_vendor', { show_id: 'friday', vendor_id: 'v-bar', confirm: true }],
      ['duplicate_show', { id: 'friday' }],
      ['delete_show', { id: 'friday', confirm: true }],
    ];
    for (const [name, args] of attempts) {
      await expect(call(name, { ...args, expected_revision: stale }), name).rejects.toThrow('changed since it was read');
    }
    expect(await revisionOf()).toBe(current);
    expect((await db.execute('SELECT COUNT(*) FROM user_shows')).rows[0][0]).toBe(1);
  });

  it('checks every argument itself rather than trusting the tool schema', async () => {
    const revision = await seedShow();
    const bad: [string, Record<string, unknown>][] = [
      ['add_cue', { show_id: 'friday', expected_revision: revision, description: '' }],
      // Required by the schema, and by the app's forms, so required here too.
      ['add_cue', { show_id: 'friday', expected_revision: revision, time: '21:00' }],
      ['add_staff', { show_id: 'friday', expected_revision: revision, role: 'Sound' }],
      ['add_staff', { show_id: 'friday', expected_revision: revision, personName: 'Dee' }],
      ['add_vendor', { show_id: 'friday', expected_revision: revision, category: 'Bar' }],
      ['add_cue', { show_id: 'friday', expected_revision: revision, description: 'x', durationMin: -1 }],
      ['update_recap', { show_id: 'friday', expected_revision: revision, patch: { ticketSales: -5 } }],
      ['add_vendor', { show_id: 'friday', expected_revision: revision, name: 'x', category: 'Fireworks' }],
      ['add_vendor', { show_id: 'friday', expected_revision: revision, name: 'x', website: 'javascript:alert(1)' }],
      ['add_performer', { show_id: 'friday', expected_revision: revision, name: 'x', extra: true }],
      ['move_cue', { show_id: 'friday', expected_revision: revision, cue_id: 'cue-1', direction: 'sideways' }],
      ['update_cue', { show_id: 'friday', expected_revision: revision, cue_id: 'cue-1', patch: { performer_id: 'nobody' } }],
    ];
    for (const [name, args] of bad) await expect(call(name, args), name).rejects.toThrow();
    expect(await revisionOf()).toBe(revision);
  });
});

describe('removing anything from a show', () => {
  const removals: [string, Record<string, unknown>][] = [
    ['remove_performer', { performer_id: 'p-ada' }],
    ['remove_cue', { cue_id: 'cue-1' }],
    ['remove_staff', { staff_id: 's-dee' }],
    ['remove_vendor', { vendor_id: 'v-bar' }],
  ];

  it.each(removals)('%s is refused until the producer has said yes, as delete_show is', async (name, target) => {
    await seedSettings();
    const revision = await seedShow({ ...fixture(), staff: [{ id: 's-dee', role: 'Sound', personName: 'Dee' }] });
    const removal = { show_id: 'friday', expected_revision: revision, ...target };
    for (const confirm of [undefined, false, 'true', 1, null]) {
      await expect(call(name, confirm === undefined ? removal : { ...removal, confirm }), String(confirm)).rejects.toThrow('Ask the producer first, then call again with confirm: true.');
    }
    expect(await revisionOf()).toBe(revision);
    const removed = await call(name, { ...removal, confirm: true });
    expect(removed.revision).toBe(await revisionOf());
    expect(removed.revision).not.toBe(revision);
  });

  it.each(removals)('%s tells the assistant to ask first, takes confirm and is marked destructive', name => {
    const { definition } = ASSISTANT_TOOLS.find(tool => tool.definition.name === name)!;
    expect(definition.annotations.destructiveHint).toBe(true);
    expect(definition.description).toContain('Ask the producer first');
    expect(definition.inputSchema.required).toContain('confirm');
    expect((definition.inputSchema.properties as Record<string, unknown>).confirm).toMatchObject({ type: 'boolean', const: true });
  });
});

describe('delete_show', () => {
  it('moves the show to Recently deleted, where the app can restore it', async () => {
    await seedSettings();
    const revision = await seedShow();
    await expect(call('delete_show', { id: 'friday', expected_revision: revision })).rejects.toThrow('confirm');
    await expect(call('delete_show', { id: 'friday', expected_revision: revision, confirm: true }, 'shows:read shows:write')).rejects.toThrow('shows:delete');
    const result = await call('delete_show', { id: 'friday', expected_revision: revision, confirm: true });
    expect((await db.execute('SELECT id FROM user_shows')).rows).toHaveLength(0);
    // Every save keeps the version it replaced.
    expect((await db.execute('SELECT COUNT(*) FROM user_shows_backup')).rows[0][0]).toBeGreaterThan(0);
    const settings = await storedSettings();
    expect(settings.deletedShowIds).toEqual(['friday']);
    expect(settings.trash).toHaveLength(1);
    const item = settings.trash[0];
    expect(item).toMatchObject({ id: result.trashId, type: 'show' });
    expect(item.data).toEqual(fixture());

    // App.handleRestoreShow: the trashed copy goes back on the list and the
    // deletion is taken off the record.
    await seedShow(item.data);
    expect(await stored()).toEqual(fixture());
  });

  it('refuses rather than pushing the oldest show out of a full trash', async () => {
    const full = Array.from({ length: MAX_TRASH_ITEMS }, (_, i) => ({ id: `t${i}`, type: 'show' as const, data: fixture(`old-${i}`), deletedAt: '2026-01-01T00:00:00Z' }));
    await seedSettings(settingsFixture({ trash: full }));
    const revision = await seedShow();
    await expect(call('delete_show', { id: 'friday', expected_revision: revision, confirm: true })).rejects.toThrow('Recently deleted is full');
    expect(await revisionOf()).toBe(revision);
    expect((await storedSettings()).trash).toHaveLength(MAX_TRASH_ITEMS);
  });
});

describe('search and fetch', () => {
  it('finds shows by who is on them, and the Rolodex only when it may be read', async () => {
    await seedSettings();
    await seedShow();
    await seedShow({ ...fixture('other'), name: 'Open Mic', performers: [], schedule: [], djSongs: [] });
    const found = await call('search', { query: 'sam okafor' }) as unknown as { results: { id: string; title: string; url: string }[] };
    // A name that is the whole query ranks above a record that merely mentions it.
    expect(found.results).toEqual([
      { id: 'comic:c-sam', title: 'Sam Okafor (Rolodex)', url: origin },
      { id: 'show:friday', title: 'Friday Comedy — 2026-12-04', url: origin },
    ]);
    expect((await call('search', { query: 'open mic' }) as unknown as { results: { id: string }[] }).results.map(r => r.id)).toEqual(['show:other']);
    const showsOnly = await call('search', { query: 'sam okafor' }, 'shows:read') as unknown as { results: { id: string }[] };
    expect(showsOnly.results.map(r => r.id)).toEqual(['show:friday']);
  });

  it('fetches a show as a document with its revision, without media or keys', async () => {
    const revision = await seedShow();
    const doc = await call('fetch', { id: 'show:friday' }) as unknown as { id: string; title: string; text: string; url: string; metadata: Record<string, unknown> };
    expect(doc).toMatchObject({ id: 'show:friday', title: 'Friday Comedy — 2026-12-04', url: origin, metadata: { kind: 'show', show_id: 'friday', revision } });
    expect(doc.text).toContain('Mystery Act [surprise guest');
    expect(doc.text).toContain('20:10 Sam Okafor opens — Sam Okafor');
    expect(doc.text).toContain('profit 650');
    for (const secret of ['media:', 'secret-view-token', 'secret-viewer-key']) expect(doc.text).not.toContain(secret);
  });

  it('fetches a Rolodex entry only with rolodex:read', async () => {
    await seedSettings();
    await seedShow();
    const doc = await call('fetch', { id: 'comic:c-sam' }) as unknown as { text: string; metadata: Record<string, unknown> };
    expect(doc.text).toContain('Friday Comedy (2026-12-04)');
    expect(doc.metadata).toEqual({ kind: 'comic', comic_id: 'c-sam', bookings: 1 });
    await expect(call('fetch', { id: 'comic:c-sam' }, 'shows:read')).rejects.toThrow('rolodex:read');
  });
});

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient, type Client } from '@libsql/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import website from '../../api/website-lineups';
import shows from '../../api/shows';
import { applySchema } from '../../api/_lib/db';
import { applyShowChanges, cipherHash } from '../../api/_lib/showWrites';
import type { Show } from '../types';
import { encryptWithKey } from './encryption';
import { publicWebsiteShow } from './websiteLineups';

const connection = vi.hoisted(() => ({ db: null as Client | null }));
vi.mock('../../api/_lib/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/_lib/db')>()),
  ensureSchema: async () => {},
  getDb: () => connection.db,
}));
vi.mock('../../api/_lib/auth', () => ({
  authorize: async (req: Request) => req.headers.get('x-user-id'),
}));

const OWNER = 'producer';
const IDS = ['friday', 'later'];
const KEY = 'a'.repeat(64);
const READ = 'website-read-reconciliation-'.padEnd(64, 'r');
const SETUP = 'website-setup-reconciliation-'.padEnd(64, 's');
let db: Client;
let dir: string;

function fixture(id = IDS[0]): Show {
  return {
    id, name: `Comedy ${id}`, date: '2026-12-04', time: '20:00',
    venueName: 'The Cellar', location: 'Chicago',
    ticketLink: 'https://tickets.example.test/night', status: 'upcoming',
    performers: [
      { id: 'zoe', name: 'Zoe Public', credits: 'Public credit', email: 'private@example.test', phone: '555-0100', notes: 'Private booking note', photo: 'media:private-headshot#1' },
      { id: 'secret', name: 'Secret Guest Identity', credits: 'Secret guest credit', surpriseGuest: true },
      { id: 'ada', name: 'Ada Public' },
    ],
    host: 'Jo Host', hostSocial: '@johost', hostComicId: 'private-host-comic-id',
    coHost: 'Secret Guest Identity', coHostSocial: '@secretguest',
    artists: [], schedule: [], hosts: [], djSongs: [], staff: [], expenses: [],
    productionNotes: 'Confidential production note', viewToken: 'private-view-token', viewerKey: 'private-audio-key',
    createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z',
  };
}

async function source(show: Show, owner = OWNER) {
  const encryptedData = encryptWithKey(show, KEY);
  await db.execute({
    sql: 'INSERT INTO user_shows (id, user_id, encrypted_data) VALUES (?, ?, ?)',
    args: [show.id, owner, encryptedData],
  });
  return { encryptedData, revision: await cipherHash(encryptedData) };
}

function bearer(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

function owner(user = OWNER): Record<string, string> {
  return { 'x-user-id': user, 'x-auth': `normal-credential-${user}` };
}

function request(method: string, headers: Record<string, string>, body?: unknown) {
  return website(new Request('https://example.test/api/website-lineups', {
    method,
    headers: { ...headers, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }));
}

async function projectionEntry(show = fixture()) {
  const row = (await db.execute({
    sql: 'SELECT encrypted_data FROM user_shows WHERE id = ?', args: [show.id],
  })).rows[0];
  return { ...publicWebsiteShow(show), revision: await cipherHash(String(row[0])) };
}

async function initialize() {
  const entries = [];
  for (const id of IDS) {
    const show = fixture(id);
    const { revision } = await source(show);
    entries.push({ ...publicWebsiteShow(show), revision });
  }
  expect((await request('POST', bearer(SETUP), { shows: entries })).status).toBe(201);
  return entries;
}

async function feed() {
  const response = await request('GET', bearer(READ));
  expect(response.status).toBe(200);
  return response.json();
}

async function projectionRows() {
  return (await db.execute('SELECT * FROM website_lineups ORDER BY show_id')).rows;
}

async function sourceState() {
  return {
    shows: (await db.execute('SELECT * FROM user_shows ORDER BY id')).rows,
    snapshots: (await db.execute('SELECT * FROM user_shows_backup ORDER BY id, backed_up_at')).rows,
    settings: (await db.execute('SELECT * FROM user_settings ORDER BY user_id')).rows,
    settingsSnapshots: (await db.execute('SELECT * FROM user_settings_backup ORDER BY user_id, backed_up_at')).rows,
  };
}

async function scopedShows(headers = owner(), search = '?websiteLineups=1') {
  return shows(new Request(`https://example.test/api/shows${search}`, { headers }));
}

beforeEach(async () => {
  vi.stubEnv('WEBSITE_LINEUPS_SHOW_IDS', JSON.stringify(IDS));
  vi.stubEnv('WEBSITE_LINEUPS_READ_TOKEN', READ);
  vi.stubEnv('WEBSITE_LINEUPS_SETUP_TOKEN', SETUP);
  dir = mkdtempSync(join(tmpdir(), 'website-reconcile-'));
  db = createClient({ url: `file:${join(dir, 'test.db')}` });
  connection.db = db;
  await applySchema(db);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

describe('owner-authenticated website projection reconciliation', () => {
  it('requires normal producer authentication; neither feed bearer can authorize a PUT', async () => {
    await initialize();
    const body = { shows: [await projectionEntry()] };
    const before = await projectionRows();
    for (const headers of [{}, bearer(READ), bearer(SETUP), bearer('wrong')]) {
      expect((await request('PUT', headers, body)).status).toBe(401);
    }
    expect(await projectionRows()).toEqual(before);
    expect((await request('PUT', owner('unrelated-owner'), body)).status).toBe(403);
  });

  it('repairs a legacy-invalidated bill from current decrypted data without changing source records', async () => {
    await initialize();
    const beforeCipher = String((await db.execute("SELECT encrypted_data FROM user_shows WHERE id = 'friday'")).rows[0][0]);
    const current = fixture();
    current.performers[0].surpriseGuest = true;
    current.performers = [current.performers[2], current.performers[0], current.performers[1]];
    const encryptedData = encryptWithKey(current, KEY);
    expect((await applyShowChanges(db, OWNER, [{
      id: current.id, expectedHash: await cipherHash(beforeCipher), encryptedData,
    }])).status).toBe(200);
    expect((await feed()).shows[0]).toEqual({ id: current.id, available: false });
    const sourceBefore = await sourceState();
    const laterBefore = (await projectionRows()).find(row => row.show_id === 'later');

    const response = await request('PUT', owner(), { shows: [await projectionEntry(current)] });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, updatedIds: ['friday'], unchangedIds: [] });
    expect(await sourceState()).toEqual(sourceBefore);
    expect((await projectionRows()).find(row => row.show_id === 'later')).toEqual(laterBefore);

    const repaired = (await feed()).shows[0];
    expect(repaired.available).toBe(true);
    expect(repaired.lineup.map((person: { name: string }) => person.name)).toEqual(['Ada Public']);
    expect(repaired.hosts).toEqual([{ name: 'Jo Host', handle: '@johost', link: 'https://instagram.com/johost' }]);
    const text = JSON.stringify(repaired);
    for (const secret of ['Zoe Public', 'Secret Guest Identity', 'Secret guest credit', 'secretguest', 'private@example.test', '555-0100', 'Private booking note', 'Confidential production note', 'media:', 'private-view-token', 'private-audio-key', 'private-host-comic-id']) {
      expect(text).not.toContain(secret);
    }
    // Repair uses owner authentication, not a reusable bootstrap credential.
    vi.stubEnv('WEBSITE_LINEUPS_SETUP_TOKEN', '');
    expect((await request('PUT', owner(), { shows: [await projectionEntry(current)] })).status).toBe(200);
  });

  it('keeps an identical projection and its exact update timestamp unchanged', async () => {
    await initialize();
    const sentinel = '2001-01-01T00:00:00.000Z';
    await db.execute({ sql: 'UPDATE website_lineups SET updated_at = ? WHERE show_id = ?', args: [sentinel, 'friday'] });
    const before = await projectionRows();
    const sourceBefore = await sourceState();
    const response = await request('PUT', owner(), { shows: [await projectionEntry()] });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, updatedIds: [], unchangedIds: ['friday'] });
    expect(await projectionRows()).toEqual(before);
    expect(await sourceState()).toEqual(sourceBefore);
  });

  it('rejects empty, duplicate, unapproved and extra/private fields before publishing', async () => {
    await initialize();
    const entry = await projectionEntry();
    const before = await projectionRows();
    const badInputs: unknown[] = [
      {}, { shows: [] }, { shows: [entry, entry] },
      { shows: [{ ...entry, id: 'unrelated' }] },
      { shows: [entry], producerKey: 'must-not-be-accepted' },
      { shows: [{ ...entry, productionNotes: 'private' }] },
      { shows: [{ ...entry, lineup: [{ name: 'Ada Public', email: 'private@example.test' }] }] },
      { shows: [{ ...entry, hosts: [{ name: 'Jo Host', phone: '555-0100' }] }] },
    ];
    for (const body of badInputs) expect((await request('PUT', owner(), body)).status).toBe(400);
    expect(await projectionRows()).toEqual(before);
  });

  it('checks every live source revision before applying any part of a batch', async () => {
    await initialize();
    const first = await projectionEntry();
    const second = await projectionEntry(fixture('later'));
    const before = await projectionRows();
    const sourceBefore = await sourceState();
    const response = await request('PUT', owner(), {
      shows: [{ ...first, lineup: [] }, { ...second, revision: '0'.repeat(64), lineup: [] }],
    });
    expect(response.status).toBe(409);
    expect(await projectionRows()).toEqual(before);
    expect(await sourceState()).toEqual(sourceBefore);
  });

  it('refuses a mixed-owner batch atomically even when ciphertext revisions match', async () => {
    await initialize();
    const first = await projectionEntry();
    const second = await projectionEntry(fixture('later'));
    await db.execute({ sql: 'UPDATE user_shows SET user_id = ? WHERE id = ?', args: ['another-owner', 'later'] });
    const before = await projectionRows();
    const response = await request('PUT', owner(), { shows: [{ ...first, lineup: [] }, second] });
    expect(response.status).toBe(403);
    expect(await projectionRows()).toEqual(before);
  });

  it('does not turn owner reconciliation into another bootstrap', async () => {
    const entries = await initialize();
    const response = await request('PUT', owner(), { shows: [entries[0]] });
    expect(response.status).toBe(200);
    expect((await request('POST', bearer(SETUP), { shows: entries })).status).toBe(409);
    expect((await request('POST', owner(), { shows: entries })).status).toBe(401);
  });

  it('refuses repair before the configured owner has initialized publication', async () => {
    await source(fixture());
    const response = await request('PUT', owner(), { shows: [await projectionEntry()] });
    expect(response.status).toBe(409);
    expect(await projectionRows()).toEqual([]);
  });

  it('does not create publication membership merely because an ID was added to configuration', async () => {
    await initialize();
    await source(fixture('newly-configured'));
    vi.stubEnv('WEBSITE_LINEUPS_SHOW_IDS', JSON.stringify([...IDS, 'newly-configured']));
    const before = await projectionRows();
    const response = await request('PUT', owner(), { shows: [await projectionEntry(fixture('newly-configured'))] });
    expect(response.status).toBe(400);
    expect(await projectionRows()).toEqual(before);
    const scoped = await scopedShows();
    expect(scoped.status).toBe(200);
    const result = await scoped.json();
    expect(result.websiteLineupShowIds).toEqual(IDS);
    expect(result.shows.map((show: { id: string }) => show.id)).toEqual(IDS);
  });
});

describe('scoped encrypted source reads for website repair', () => {
  it('returns only the initialized owner’s approved encrypted records, leaving normal loads intact', async () => {
    await initialize();
    await source(fixture('unrelated'));
    await source(fixture('other-owner'), 'neighbour');
    const sourceBefore = await sourceState();
    const response = await scopedShows();
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.websiteLineupShowIds).toEqual(IDS);
    expect(result.shows.map((show: { id: string }) => show.id)).toEqual(IDS);
    for (const row of result.shows) {
      expect(Object.keys(row).sort()).toEqual(['encryptedData', 'id']);
      const sourceRow = sourceBefore.shows.find(source => source.id === row.id)!;
      expect(row.encryptedData).toBe(sourceRow.encrypted_data);
    }
    expect(JSON.stringify(result)).not.toContain('Secret Guest Identity');
    expect(JSON.stringify(result)).not.toContain('unrelated');
    expect(await sourceState()).toEqual(sourceBefore);

    const normal = await scopedShows(owner(), '');
    expect(normal.status).toBe(200);
    const normalResult = await normal.json();
    expect(normalResult.shows.map((show: { id: string }) => show.id).sort()).toEqual(['friday', 'later', 'unrelated']);
    expect(normalResult.websiteLineupShowIds).toEqual(IDS);
  });

  it('returns no scope or source records to a different owner', async () => {
    await initialize();
    await source(fixture('other-owner'), 'neighbour');
    const response = await scopedShows(owner('neighbour'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ shows: [], websiteLineupShowIds: [] });
  });

  it('returns an empty scope when configuration is disabled or setup is incomplete', async () => {
    await source(fixture());
    const uninitialized = await scopedShows();
    expect(uninitialized.status).toBe(200);
    expect(await uninitialized.json()).toEqual({ shows: [], websiteLineupShowIds: [] });
    vi.stubEnv('WEBSITE_LINEUPS_SHOW_IDS', '');
    const disabled = await scopedShows();
    expect(disabled.status).toBe(200);
    expect(await disabled.json()).toEqual({ shows: [], websiteLineupShowIds: [] });
  });

  it('does not let the website read/setup bearers fetch encrypted producer source data', async () => {
    await initialize();
    for (const headers of [{}, bearer(READ), bearer(SETUP)]) {
      expect((await scopedShows(headers)).status).toBe(401);
    }
  });
});

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient, type Client } from '@libsql/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import handler from '../../api/website-lineups';
import { applySchema } from '../../api/_lib/db';
import { saveShows, type AssistantContext } from '../../api/_lib/assistantCore';
import { applyShowChanges, cipherHash } from '../../api/_lib/showWrites';
import { websiteShowIdsForOwner } from '../../api/_lib/websiteLineups';
import type { Show } from '../types';
import { encryptWithKey } from './encryption';
import { parseWebsiteShow, publicWebsiteShow } from './websiteLineups';

const connection = vi.hoisted(() => ({ db: null as Client | null }));
vi.mock('../../api/_lib/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/_lib/db')>()),
  ensureSchema: async () => {},
  getDb: () => connection.db,
}));

const READ = 'website-read-'.padEnd(64, 'r');
const SETUP = 'website-setup-'.padEnd(64, 's');
const USER = 'producer';
const KEY = 'a'.repeat(64);
const IDS = ['friday', 'later'];
let dir: string;
let db: Client;

function fixture(id = 'friday'): Show {
  return {
    id, name: `Comedy ${id}`, date: '2026-12-04', time: '20:00',
    venueName: 'The Cellar', location: 'Chicago',
    ticketLink: 'https://tickets.example.test/night', status: 'upcoming',
    performers: [
      { id: 'z', name: 'Zoe Public', credits: 'Public credit', email: 'private@example.test', phone: '555-0100', notes: 'Private booking note', photo: 'media:headshot#1' },
      { id: 'secret', name: 'Secret Guest Identity', credits: 'Secret guest credit', surpriseGuest: true },
      { id: 'a', name: 'Ada Public' },
    ],
    artists: [], schedule: [], hosts: [], djSongs: [], staff: [], expenses: [],
    host: 'Secret Guest Identity', productionNotes: 'Confidential production note',
    viewToken: 'private-view-token', viewerKey: 'private-audio-key',
    createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z',
  };
}

const context = (): AssistantContext => ({
  db, grant: { userId: USER, key: KEY, scope: 'shows:read shows:write' },
  origin: 'https://example.test',
});

async function source(show = fixture(), owner = USER) {
  const encryptedData = encryptWithKey(show, KEY);
  await db.execute({
    sql: 'INSERT INTO user_shows (id, user_id, encrypted_data) VALUES (?, ?, ?)',
    args: [show.id, owner, encryptedData],
  });
  return { encryptedData, revision: await cipherHash(encryptedData) };
}

async function request(method = 'GET', token: string | null = READ, body?: unknown) {
  return handler(new Request('https://example.test/api/website-lineups', {
    method,
    headers: {
      ...(token === null ? {} : { authorization: `Bearer ${token}` }),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }));
}

async function feed() {
  const response = await request();
  expect(response.status).toBe(200);
  return response.json();
}

async function seed(entries?: unknown[]) {
  const shows = entries ?? await Promise.all(IDS.map(async (id) => {
    const show = fixture(id);
    const { revision } = await source(show);
    return { ...publicWebsiteShow(show), revision };
  }));
  return request('POST', SETUP, { shows });
}

beforeEach(async () => {
  vi.stubEnv('WEBSITE_LINEUPS_SHOW_IDS', JSON.stringify(IDS));
  vi.stubEnv('WEBSITE_LINEUPS_READ_TOKEN', READ);
  vi.stubEnv('WEBSITE_LINEUPS_SETUP_TOKEN', SETUP);
  dir = mkdtempSync(join(tmpdir(), 'showrunner-website-'));
  db = createClient({ url: `file:${join(dir, 'test.db')}` });
  connection.db = db;
  await applySchema(db);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

describe('public website lineup boundary', () => {
  it('keeps billed order and only public performer fields, excluding secret guests entirely', () => {
    const published = publicWebsiteShow(fixture());
    expect(published.lineup.map(person => person.name)).toEqual(['Zoe Public', 'Ada Public']);
    expect(published.lineup[0]).toMatchObject({ name: 'Zoe Public', credits: 'Public credit' });
    const json = JSON.stringify(published);
    for (const secret of ['Secret Guest Identity', 'Secret guest credit', 'private@example.test', '555-0100', 'Private booking note', 'Confidential production note', 'media:', 'private-view-token', 'private-audio-key']) {
      expect(json).not.toContain(secret);
    }
    expect(published).not.toHaveProperty('host');
    expect(published.lineup[0]).not.toHaveProperty('email');
  });

  it('rejects extra/private fields rather than accepting a raw producer show', () => {
    const published = publicWebsiteShow(fixture());
    expect(() => parseWebsiteShow({ ...published, productionNotes: 'private' })).toThrow();
    expect(() => parseWebsiteShow({ ...published, host: 'Secret Guest Identity' })).toThrow();
    expect(() => parseWebsiteShow({ ...published, lineup: [{ name: 'Zoe Public', email: 'private@example.test' }] })).toThrow();
    expect(() => parseWebsiteShow({ ...published, lineup: [{ name: 'Secret Guest Identity', surpriseGuest: true }] })).toThrow();
  });
});

describe('scoped website feed and single-use setup', () => {
  it('does not expose or accept the feed when not configured', async () => {
    vi.stubEnv('WEBSITE_LINEUPS_SHOW_IDS', '');
    expect((await request()).status).toBe(404);
    expect((await request('POST', SETUP, { shows: [] })).status).toBe(404);
    expect((await applyShowChanges(db, USER, [{ id: 'ordinary', expectedHash: null, encryptedData: 'opaque' }])).status).toBe(200);
  });

  it('separates read and setup credentials and denies unauthenticated access', async () => {
    for (const token of [null, 'wrong', SETUP]) expect((await request('GET', token)).status).toBe(401);
    for (const token of [null, 'wrong', READ]) expect((await request('POST', token, { shows: [] })).status).toBe(401);
  });

  it('returns only explicitly approved IDs before and after publishing', async () => {
    await source(fixture('unrelated'));
    expect((await feed()).shows).toEqual(IDS.map(id => ({ id, available: false })));
    expect((await seed()).ok).toBe(true);
    const response = await request();
    expect(response.headers.get('cache-control')).toContain('no-store');
    const result = await response.json();
    expect(result.version).toBe(1);
    expect(typeof result.updatedAt).toBe('string');
    expect(result.shows.map((show: { id: string }) => show.id)).toEqual(IDS);
    expect(result.shows.every((show: { available: boolean }) => show.available)).toBe(true);
    expect(JSON.stringify(result)).not.toContain('unrelated');
    expect(JSON.stringify(result)).not.toContain('Secret Guest Identity');
    expect(JSON.stringify(result)).not.toContain('revision');
  });

  it('tells browser sessions only which of their own shows were explicitly selected', async () => {
    await source(fixture('friday'));
    await source(fixture('later'), 'another-producer');
    await source(fixture('unrelated'));
    expect(await websiteShowIdsForOwner(db, USER)).toEqual(['friday']);
    expect(await websiteShowIdsForOwner(db, 'another-producer')).toEqual(['later']);
    expect(await websiteShowIdsForOwner(db, 'unknown')).toEqual([]);
  });

  it('requires exactly the approved IDs, once each', async () => {
    const published = publicWebsiteShow(fixture());
    const { revision } = await source();
    for (const entries of [
      [{ ...published, revision }],
      [{ ...published, revision }, { ...published, revision }],
      [{ ...published, revision }, { ...published, id: 'unrelated', revision }],
    ]) expect((await seed(entries)).status).toBe(400);
    expect((await feed()).shows).toEqual(IDS.map(id => ({ id, available: false })));
  });

  it('rejects stale seed data atomically and does not consume setup on failure', async () => {
    const entries = await Promise.all(IDS.map(async (id) => {
      const show = fixture(id);
      const { revision } = await source(show);
      return { ...publicWebsiteShow(show), revision };
    }));
    const stale = [{ ...entries[0], revision: '0'.repeat(64) }, entries[1]];
    expect((await seed(stale)).status).toBe(409);
    expect((await feed()).shows).toEqual(IDS.map(id => ({ id, available: false })));
    expect((await seed(entries)).ok).toBe(true);
  });

  it('rejects records belonging to different owners without partially publishing', async () => {
    const entries = await Promise.all(IDS.map(async (id, index) => {
      const show = fixture(id);
      const { revision } = await source(show, index === 0 ? USER : 'another-producer');
      return { ...publicWebsiteShow(show), revision };
    }));
    const response = await seed(entries);
    expect(response.ok).toBe(false);
    expect((await feed()).shows).toEqual(IDS.map(id => ({ id, available: false })));
  });

  it('consumes bootstrap once and cannot reseed by changing the setup token', async () => {
    expect((await seed()).ok).toBe(true);
    const entries = IDS.map(id => ({ ...publicWebsiteShow(fixture(id)), revision: '0'.repeat(64) }));
    expect((await seed(entries)).status).toBe(409);
    const replacement = 'replacement-setup-'.padEnd(64, 't');
    vi.stubEnv('WEBSITE_LINEUPS_SETUP_TOKEN', replacement);
    expect((await request('POST', replacement, { shows: entries })).status).toBe(409);
  });

  it('allows only one complete bootstrap when two setup requests race', async () => {
    const entries = await Promise.all(IDS.map(async (id) => {
      const show = fixture(id);
      const { revision } = await source(show);
      return { ...publicWebsiteShow(show), revision };
    }));
    const responses = await Promise.all([seed(entries), seed(entries)]);
    expect(responses.filter(response => response.ok)).toHaveLength(1);
    expect((await feed()).shows.every((show: { available: boolean }) => show.available)).toBe(true);
  });
});

describe('publication follows committed source writes', () => {
  it('updates selected browser writes and preserves lineup order', async () => {
    expect((await seed()).ok).toBe(true);
    const before = String((await db.execute("SELECT encrypted_data FROM user_shows WHERE id = 'friday'")).rows[0][0]);
    const show = fixture();
    show.performers = [show.performers[2], show.performers[0], show.performers[1]];
    const result = await applyShowChanges(db, USER, [{
      id: show.id, expectedHash: await cipherHash(before), encryptedData: encryptWithKey(show, KEY),
      websiteLineup: publicWebsiteShow(show),
    }]);
    expect(result.status).toBe(200);
    expect((await feed()).shows[0].lineup.map((person: { name: string }) => person.name)).toEqual(['Ada Public', 'Zoe Public']);
  });

  it('updates MCP writes from decrypted shows, including newly hidden surprise guests', async () => {
    expect((await seed()).ok).toBe(true);
    const before = String((await db.execute("SELECT encrypted_data FROM user_shows WHERE id = 'friday'")).rows[0][0]);
    const show = fixture();
    show.performers[0].surpriseGuest = true;
    await saveShows(context(), [{ id: show.id, expectedHash: await cipherHash(before), show }]);
    const result = await feed();
    expect(result.shows[0].lineup.map((person: { name: string }) => person.name)).toEqual(['Ada Public']);
    expect(JSON.stringify(result.shows[0])).not.toContain('Zoe Public');
    expect(JSON.stringify(result)).not.toContain('Secret Guest Identity');
  });

  it('does not change publication or ciphertext when any source CAS conflicts', async () => {
    expect((await seed()).ok).toBe(true);
    const original = await feed();
    const cipherBefore = String((await db.execute("SELECT encrypted_data FROM user_shows WHERE id = 'friday'")).rows[0][0]);
    const changed = fixture();
    changed.performers = [];
    const result = await applyShowChanges(db, USER, [
      { id: 'friday', expectedHash: await cipherHash(cipherBefore), encryptedData: 'must-roll-back', websiteLineup: publicWebsiteShow(changed) },
      { id: 'later', expectedHash: '0'.repeat(64), encryptedData: 'stale', websiteLineup: publicWebsiteShow(fixture('later')) },
    ]);
    expect(result.status).toBe(409);
    expect(await feed()).toEqual(original);
    expect(String((await db.execute("SELECT encrypted_data FROM user_shows WHERE id = 'friday'")).rows[0][0])).toBe(cipherBefore);
  });

  it('invalidates an older client ciphertext change instead of retaining possibly secret names', async () => {
    expect((await seed()).ok).toBe(true);
    const before = String((await db.execute("SELECT encrypted_data FROM user_shows WHERE id = 'friday'")).rows[0][0]);
    expect((await applyShowChanges(db, USER, [{ id: 'friday', expectedHash: await cipherHash(before), encryptedData: 'legacy-client-update' }])).status).toBe(200);
    const result = await feed();
    expect(result.shows[0]).toEqual({ id: 'friday', available: false });
    expect(result.shows[1].available).toBe(true);
    expect(JSON.stringify(result.shows[0])).not.toContain('Zoe Public');
  });

  it('does not invalidate a successful same-ciphertext replay by a legacy client', async () => {
    expect((await seed()).ok).toBe(true);
    const before = String((await db.execute("SELECT encrypted_data FROM user_shows WHERE id = 'friday'")).rows[0][0]);
    expect((await applyShowChanges(db, USER, [{ id: 'friday', expectedHash: null, encryptedData: before }])).status).toBe(200);
    expect((await feed()).shows[0].available).toBe(true);
  });

  it('invalidates deleted source shows', async () => {
    expect((await seed()).ok).toBe(true);
    const before = String((await db.execute("SELECT encrypted_data FROM user_shows WHERE id = 'friday'")).rows[0][0]);
    expect((await applyShowChanges(db, USER, [{ id: 'friday', expectedHash: await cipherHash(before), encryptedData: null }])).status).toBe(200);
    expect((await feed()).shows[0]).toEqual({ id: 'friday', available: false });
  });

  it('never publishes an unapproved show even when its write includes public data', async () => {
    expect((await seed()).ok).toBe(true);
    const outside = fixture('unrelated');
    expect((await applyShowChanges(db, USER, [{ id: outside.id, expectedHash: null, encryptedData: encryptWithKey(outside, KEY), websiteLineup: publicWebsiteShow(outside) }])).status).toBe(200);
    expect((await feed()).shows.map((show: { id: string }) => show.id)).toEqual(IDS);
  });
});

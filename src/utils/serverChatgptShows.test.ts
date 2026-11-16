import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { applySchema } from '../../api/_lib/db';
import { handleShowTool, SHOW_TOOLS, type ChatgptShowGrant } from '../../api/_lib/chatgptShows';
import { cipherHash } from '../../api/_lib/showWrites';
import { decryptWithKeys, encryptWithKey } from './encryption';
import { DEFAULT_SECTIONS, hiddenFromSelected } from './showBlocks';
import type { Show } from '../types';

let db: Client;
let dir: string;
const grant: ChatgptShowGrant = { userId: 'producer-a', key: 'a'.repeat(64), legacyKey: 'b'.repeat(64), scope: 'shows:read shows:write' };

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'chatgpt-shows-'));
  db = createClient({ url: `file:${join(dir, 'test.db')}` });
  await applySchema(db);
});
afterEach(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });

function fixture(id = 'existing-show'): Show {
  return {
    id, name: 'Friday Comedy', date: '2026-11-20', time: '20:00', venueName: 'The Cellar', location: 'Chicago', status: 'upcoming',
    performers: [{ id: 'p1', name: 'Sam', email: 'private@example.com', phone: '555-0000', notes: 'private note', photo: 'media:photo' }],
    artists: [{ id: 'a1', name: 'Robin', artistType: 'Singer', email: 'artist@example.com' }],
    schedule: [{ id: 'cue', time: '20:00', description: 'Opening set', performer: 'Sam', durationMin: 10, music: 'media:audio' }],
    hosts: [], djSongs: [], staff: [], vendors: [], expenses: [], productionNotes: 'private planning',
    viewToken: 'private-view-token', viewerKey: 'private-viewer-key',
    createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z',
  };
}

async function seed(show: Show = fixture(), userId = grant.userId, key = grant.key) {
  const cipher = encryptWithKey(show, key);
  await db.execute({ sql: 'INSERT INTO user_shows (id, user_id, encrypted_data) VALUES (?, ?, ?)', args: [show.id, userId, cipher] });
  return cipher;
}

const call = (name: string, args: unknown, connection = grant) => handleShowTool(db, connection, name, args);

it('reads a show in full while withholding media and share secrets', async () => {
  const cipher = await seed();
  const result = await call('get_show', { id: 'existing-show' }) as { show: Record<string, unknown>; revision: string };
  expect(result.show).toMatchObject({
    id: 'existing-show', name: 'Friday Comedy', productionNotes: 'private planning', hasViewerLink: true,
    performers: [{ id: 'p1', name: 'Sam', email: 'private@example.com', phone: '555-0000', notes: 'private note', hasPhoto: true, surpriseGuest: false }],
    artists: [{ id: 'a1', name: 'Robin', artistType: 'Singer', email: 'artist@example.com' }],
    schedule: [{ id: 'cue', time: '20:00', description: 'Opening set', performer: 'Sam', durationMin: 10, hasMusic: true }],
  });
  const serialized = JSON.stringify(result);
  for (const secret of ['media:photo', 'media:audio', 'private-view-token', 'private-viewer-key', grant.key, grant.legacyKey!]) {
    expect(serialized).not.toContain(secret);
  }
  expect(result.revision).toBe(await cipherHash(cipher));
});

it('creates a fully initialized encrypted show that the app can read', async () => {
  // Trimmed, as the show form trims what is typed into it.
  const result = await call('create_show', { name: ' New Night ', date: '2027-01-08', time: '19:30', venueName: 'Room Two  ' }) as { show: { id: string }; revision: string };
  const stored = (await db.execute({ sql: 'SELECT encrypted_data FROM user_shows WHERE id = ?', args: [result.show.id] })).rows[0][0];
  expect(String(stored)).not.toContain('New Night');
  const show = decryptWithKeys<Show>(String(stored), [grant.key]);
  expect(show).toMatchObject({ id: result.show.id, name: 'New Night', date: '2027-01-08', time: '19:30', venueName: 'Room Two', location: '', status: 'upcoming', performers: [], artists: [], schedule: [], hosts: [], djSongs: [], staff: [], vendors: [], expenses: [] });
  // As the New Show form leaves a show: the lineup and running order on, the
  // other sections one tap away, and no Scenes list until it is asked for.
  expect(show.hiddenSections).toEqual(hiddenFromSelected(DEFAULT_SECTIONS));
  expect(show.scenes).toBeUndefined();
  expect(result.revision).toBe(await cipherHash(String(stored)));
});

it('updates only the requested metadata and preserves private fields and an earlier encrypted copy', async () => {
  const original = fixture();
  const cipher = await seed(original);
  await call('update_show', { id: original.id, expected_revision: await cipherHash(cipher), patch: { name: 'Saturday Comedy', status: 'completed' } });
  const stored = String((await db.execute('SELECT encrypted_data FROM user_shows')).rows[0][0]);
  const updated = decryptWithKeys<Show>(stored, [grant.key]);
  expect(updated).toEqual({ ...original, name: 'Saturday Comedy', status: 'completed', updatedAt: updated.updatedAt });
  expect((await db.execute('SELECT encrypted_data FROM user_shows_backup')).rows.map(row => row[0])).toContain(cipher);
});

it('refuses a stale revision instead of replacing a change from another device', async () => {
  const cipher = await seed();
  const revision = await cipherHash(cipher);
  await call('update_show', { id: 'existing-show', expected_revision: revision, patch: { name: 'Newer edit' } });
  await expect(call('update_show', { id: 'existing-show', expected_revision: revision, patch: { name: 'Stale edit' } })).rejects.toThrow('Show changed');
  const result = await call('get_show', { id: 'existing-show' }) as { show: { name: string } };
  expect(result.show.name).toBe('Newer edit');
});

it('does not list, read or update a different account’s shows', async () => {
  await seed(fixture('other-show'), 'producer-b');
  expect(await call('list_shows', {})).toEqual({ shows: [], next_cursor: null });
  await expect(call('get_show', { id: 'other-show' })).rejects.toThrow('Show not found');
  await expect(call('update_show', { id: 'other-show', expected_revision: 'a'.repeat(64), patch: { name: 'Changed' } })).rejects.toThrow('Show not found');
});

it('pages account-scoped metadata without returning private nested details', async () => {
  await seed(fixture('a'));
  await seed({ ...fixture('b'), status: 'completed' });
  const first = await call('list_shows', { limit: 1 }) as { shows: { id: string }[]; next_cursor: string };
  expect(first.shows.map(show => show.id)).toEqual(['a']);
  expect(first.next_cursor).toBe('1');
  const second = await call('list_shows', { limit: 1, cursor: first.next_cursor, status: 'completed' }) as { shows: { id: string }[]; next_cursor: null };
  expect(second.shows.map(show => show.id)).toEqual(['b']);
  expect(second.next_cursor).toBeNull();
  expect(JSON.stringify(first)).not.toContain('private@example.com');
});

it('reads a legacy-key show and encrypts updates under the current key', async () => {
  const cipher = await seed(fixture(), grant.userId, grant.legacyKey);
  await call('update_show', { id: 'existing-show', expected_revision: await cipherHash(cipher), patch: { time: '21:00' } });
  const stored = String((await db.execute('SELECT encrypted_data FROM user_shows')).rows[0][0]);
  expect(decryptWithKeys<Show>(stored, [grant.key]).time).toBe('21:00');
});

it('requires explicit read and write permissions', async () => {
  await seed();
  await expect(call('list_shows', {}, { ...grant, scope: '' })).rejects.toThrow('shows:read');
  await expect(call('create_show', { name: 'Blocked' }, { ...grant, scope: 'shows:read' })).rejects.toThrow('shows:write');
  expect((await db.execute('SELECT id FROM user_shows')).rows).toHaveLength(1);
});

it.each([
  { name: '' }, { name: '   ' }, { name: 'x'.repeat(201) },
  { name: 'Wrong date', date: '2026-02-30' }, { name: 'Wrong date', date: '2026-13-01' },
  { name: 'Wrong time', time: '24:00' }, { name: 'Wrong time', time: '8pm' },
  { name: 'Wrong status', status: 'deleted' }, { name: 'Wrong URL', ticketLink: 'javascript:alert(1)' },
  { name: 'Unexpected field', productionNotes: 'secret' }, { name: 'Unexpected field', id: 'existing-show' },
])('rejects invalid and unsupported show metadata: %j', async input => {
  await expect(call('create_show', input)).rejects.toThrow();
  expect((await db.execute('SELECT id FROM user_shows')).rows).toHaveLength(0);
});

it('validates cursor, patch and expected revision rather than trusting tool schemas', async () => {
  await seed();
  for (const args of [{ limit: 101 }, { limit: 1.5 }, { cursor: '-1' }, { cursor: 'not-a-cursor' }, { extra: true }]) {
    await expect(call('list_shows', args)).rejects.toThrow();
  }
  await expect(call('update_show', { id: 'existing-show', patch: { name: 'Changed' } })).rejects.toThrow('expected_revision');
  await expect(call('update_show', { id: 'existing-show', expected_revision: 'a'.repeat(64), patch: {} })).rejects.toThrow('At least one');
});

it('advertises only the four scoped show tools and labels writes for client confirmation', () => {
  expect(SHOW_TOOLS.map(tool => tool.name)).toEqual(['list_shows', 'get_show', 'create_show', 'update_show']);
  expect(SHOW_TOOLS.find(tool => tool.name === 'update_show')?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
});

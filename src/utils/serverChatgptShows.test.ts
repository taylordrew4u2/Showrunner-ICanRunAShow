import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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

describe('two hosts and their handles', () => {
  const update = async (patch: Record<string, string>) => {
    const { revision } = await call('get_show', { id: 'existing-show' }) as { revision: string };
    return (await call('update_show', { id: 'existing-show', expected_revision: revision, patch })) as { show: Record<string, unknown> };
  };
  const stored = async () => decryptWithKeys<Show>(String((await db.execute('SELECT encrypted_data FROM user_shows')).rows[0][0]), [grant.key]);

  it('reads the first host where it always was, with the second and both handles beside it', async () => {
    await seed({ ...fixture(), host: 'Jo Park', hostSocial: '@jopark', hostComicId: 'c-jo', coHost: 'Dev Okonjo', coHostSocial: '@devokonjo' });
    const { show } = await call('get_show', { id: 'existing-show' }) as { show: Record<string, unknown> };
    expect(show).toMatchObject({ host: 'Jo Park', hostSocial: '@jopark', coHost: 'Dev Okonjo', coHostSocial: '@devokonjo' });
  });

  it('reads a show saved with one host and no handle as that host alone', async () => {
    await seed({ ...fixture(), host: 'Jo Park' });
    const { show } = await call('get_show', { id: 'existing-show' }) as { show: Record<string, unknown> };
    expect(show).toMatchObject({ host: 'Jo Park', hostSocial: '', coHost: '', coHostSocial: '' });
  });

  it('sets two hosts with their handles in one change', async () => {
    await seed();
    const { show } = await update({ host: 'Jo Park', hostSocial: ' @jopark ', coHost: 'Dev Okonjo', coHostSocial: 'https://instagram.com/devokonjo' });
    expect(show).toMatchObject({ host: 'Jo Park', hostSocial: '@jopark', coHost: 'Dev Okonjo', coHostSocial: 'https://instagram.com/devokonjo' });
    expect(await stored()).toMatchObject({ host: 'Jo Park', hostSocial: '@jopark', coHost: 'Dev Okonjo', coHostSocial: 'https://instagram.com/devokonjo' });
  });

  it('still takes the old one-host patch, and leaves a second host alone', async () => {
    await seed({ ...fixture(), host: 'Jo Park', coHost: 'Dev Okonjo', coHostSocial: '@devokonjo' });
    const { show } = await update({ host: 'Sam Reyes' });
    expect(show).toMatchObject({ host: 'Sam Reyes', coHost: 'Dev Okonjo', coHostSocial: '@devokonjo' });
  });

  it('drops the Rolodex link and its handle when a different host is named, and keeps them for the same one', async () => {
    await seed({ ...fixture(), host: 'Jo Park', hostSocial: '@jopark', hostComicId: 'c-jo' });
    await update({ host: 'Jo Park' });
    expect(await stored()).toMatchObject({ host: 'Jo Park', hostSocial: '@jopark', hostComicId: 'c-jo' });
    await update({ host: 'Sam Reyes' });
    const show = await stored();
    expect(show.host).toBe('Sam Reyes');
    expect(show.hostSocial).toBeUndefined();
    expect(show.hostComicId).toBeUndefined();
  });

  it('makes a changed handle the host’s own rather than one the Rolodex would put back', async () => {
    await seed({ ...fixture(), host: 'Jo Park', hostSocial: '@jopark', hostComicId: 'c-jo' });
    await update({ hostSocial: '@jo.park.comedy' });
    const show = await stored();
    expect(show).toMatchObject({ host: 'Jo Park', hostSocial: '@jo.park.comedy' });
    expect(show.hostComicId).toBeUndefined();
  });

  it('clears a host with an empty name, handle and all, and the one left is the host', async () => {
    await seed({ ...fixture(), host: 'Jo Park', hostSocial: '@jopark', coHost: 'Dev Okonjo', coHostSocial: '@devokonjo', coHostComicId: 'c-dev' });
    const { show } = await update({ host: '' });
    expect(show).toMatchObject({ host: 'Dev Okonjo', hostSocial: '@devokonjo', coHost: '', coHostSocial: '' });
    expect(await stored()).toMatchObject({ host: 'Dev Okonjo', hostSocial: '@devokonjo', hostComicId: 'c-dev' });
    const cleared = await update({ host: '' });
    expect(cleared.show).toMatchObject({ host: '', hostSocial: '', coHost: '', coHostSocial: '' });
  });

  it('refuses a handle for a host who is not there, and anything that is not text', async () => {
    await seed();
    const { revision } = await call('get_show', { id: 'existing-show' }) as { revision: string };
    const attempt = (patch: unknown) => call('update_show', { id: 'existing-show', expected_revision: revision, patch });
    await expect(attempt({ coHostSocial: '@devokonjo' })).rejects.toThrow('Set coHost before coHostSocial');
    await expect(attempt({ hostSocial: '@jopark' })).rejects.toThrow('Set host before hostSocial');
    await expect(attempt({ coHost: 7 })).rejects.toThrow('Invalid coHost');
    await expect(attempt({ hostSocial: 'x'.repeat(201) })).rejects.toThrow('Invalid hostSocial');
    await expect(attempt({ thirdHost: 'Nobody' })).rejects.toThrow();
    // A new show has no host yet: the form that makes one has no field for it.
    await expect(call('create_show', { name: 'New night', coHost: 'Dev Okonjo' })).rejects.toThrow();
  });

  it('describes both hosts and their handles to the assistant that edits them', () => {
    const tool = SHOW_TOOLS.find(candidate => candidate.name === 'update_show')!;
    const patch = (tool.inputSchema as { properties: { patch: { properties: Record<string, unknown> } } }).properties.patch.properties;
    expect(Object.keys(patch)).toEqual(expect.arrayContaining(['host', 'hostSocial', 'coHost', 'coHostSocial']));
    expect(tool.description).toContain('up to two');
  });
});

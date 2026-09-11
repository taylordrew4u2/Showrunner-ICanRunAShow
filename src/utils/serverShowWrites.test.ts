import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { applyShowChanges, cipherHash } from '../../api/_lib/showWrites';

let db: Client;
let dir: string;
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'show-save-test-'));
  db = createClient({ url: `file:${join(dir, 'test.db')}` });
  await db.executeMultiple(`
    CREATE TABLE user_shows (id TEXT PRIMARY KEY, user_id TEXT, encrypted_data TEXT, updated_at TEXT);
    CREATE TABLE user_shows_backup (id TEXT, user_id TEXT, encrypted_data TEXT,
      backed_up_at TEXT DEFAULT (datetime('now')), PRIMARY KEY(id, backed_up_at));
  `);
});
afterEach(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });

const put = (id: string, value: string, hash: string | null = null) =>
  applyShowChanges(db, 'u', [{ id, encryptedData: value, expectedHash: hash }]);
const rows = async () => (await db.execute('SELECT id, encrypted_data FROM user_shows ORDER BY id')).rows;

it('keeps shows created by two tabs that both loaded an empty account', async () => {
  expect((await put('a', 'first')).status).toBe(200);
  expect((await put('b', 'second')).status).toBe(200);
  expect((await rows()).map(r => r.id)).toEqual(['a', 'b']);
});

it('rejects a stale edit without applying any part of the batch', async () => {
  await put('a', 'initial');
  await put('a', 'newer', await cipherHash('initial'));
  const result = await applyShowChanges(db, 'u', [
    { id: 'b', encryptedData: 'should not land', expectedHash: null },
    { id: 'a', encryptedData: 'stale', expectedHash: await cipherHash('initial') },
  ]);
  expect(result.status).toBe(409);
  expect((await rows()).map(r => [r.id, r.encrypted_data])).toEqual([['a', 'newer']]);
});

it('accepts a retry after the first response was lost', async () => {
  await put('a', 'first');
  expect((await put('a', 'first')).status).toBe(200);
  expect(await rows()).toHaveLength(1);
});

it('deletes only the named unchanged show and keeps its earlier version', async () => {
  await put('a', 'first');
  await put('b', 'second');
  const result = await applyShowChanges(db, 'u', [{ id: 'a', encryptedData: null, expectedHash: await cipherHash('first') }]);
  expect(result.status).toBe(200);
  expect((await rows()).map(r => r.id)).toEqual(['b']);
  expect((await db.execute("SELECT * FROM user_shows_backup WHERE id = 'a'")).rows.length).toBeGreaterThan(0);
});

it('does not delete a show edited elsewhere since it was loaded', async () => {
  await put('a', 'newer');
  const result = await applyShowChanges(db, 'u', [{ id: 'a', encryptedData: null, expectedHash: await cipherHash('old') }]);
  expect(result.status).toBe(409);
  expect(await rows()).toHaveLength(1);
});

it('cannot overwrite another account’s row', async () => {
  await put('a', 'private');
  const result = await applyShowChanges(db, 'other', [{ id: 'a', encryptedData: 'changed', expectedHash: await cipherHash('private') }]);
  expect(result.status).toBe(409);
});

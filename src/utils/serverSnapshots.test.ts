import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { applySettingsWrite } from '../../api/_lib/settingsWrites';
import { cipherHash } from '../../api/_lib/showWrites';
import { KEEP_RECENT, parkSettingsSnapshot } from '../../api/_lib/snapshots';

let db: Client;
let dir: string;
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'snapshot-test-'));
  db = createClient({ url: `file:${join(dir, 'test.db')}` });
  await db.executeMultiple(`
    CREATE TABLE user_settings (user_id TEXT PRIMARY KEY, encrypted_data TEXT, updated_at TEXT);
    CREATE TABLE user_settings_backup (user_id TEXT, encrypted_data TEXT,
      backed_up_at TEXT DEFAULT (datetime('now')), parked INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(user_id, backed_up_at));
  `);
});
afterEach(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });

const backups = async () =>
  (await db.execute('SELECT encrypted_data, parked FROM user_settings_backup ORDER BY backed_up_at')).rows
    .map((r) => [String(r[0]), Number(r[1])]);

it('keeps a parked copy of unsaved edits through a whole afternoon of later saves', async () => {
  // Monday night's edits could not save; Tuesday the laptop saved first, so
  // when the phone opened its copy was parked aside rather than applied.
  await applySettingsWrite(db, 'u', 'laptop-1', null);
  expect(await parkSettingsSnapshot(db, 'u', 'phone-unsaved')).toBe(true);

  // Then a dozen-and-a-bit ordinary edits, each of which snapshots and prunes.
  let previous = 'laptop-1';
  for (let n = 2; n <= KEEP_RECENT + 3; n++) {
    const next = `laptop-${n}`;
    expect((await applySettingsWrite(db, 'u', next, await cipherHash(previous))).status).toBe(200);
    previous = next;
  }

  const kept = await backups();
  // The parked row is still there, and still marked as what it is.
  expect(kept).toContainEqual(['phone-unsaved', 1]);
  // And it took no slot from the ordinary history: the latest twelve saves
  // are all still there too. Each save snapshots the blob it replaces, so the
  // newest snapshot is the one before the last write.
  const ordinary = kept.filter(([, parked]) => parked === 0).map(([data]) => data);
  const newest = KEEP_RECENT + 2;
  expect(ordinary.slice(-KEEP_RECENT)).toEqual(
    Array.from({ length: KEEP_RECENT }, (_, i) => `laptop-${newest - KEEP_RECENT + 1 + i}`),
  );
});

it('says which earlier version is a device’s unsaved copy', async () => {
  await applySettingsWrite(db, 'u', 'saved', null);
  await applySettingsWrite(db, 'u', 'saved-again', await cipherHash('saved'));
  await parkSettingsSnapshot(db, 'u', 'held');
  const kept = await backups();
  expect(kept).toHaveLength(2);
  expect(kept).toContainEqual(['saved', 0]);
  expect(kept).toContainEqual(['held', 1]);
});

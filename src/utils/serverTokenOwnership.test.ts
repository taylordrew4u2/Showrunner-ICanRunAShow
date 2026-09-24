import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { liveTokenOwnership, signTokenOwnership, upsertSignRequest } from '../../api/_lib/tokenOwnership';
import { rateLimit, rateLimitPeek } from '../../api/_lib/ratelimit';

let db: Client;
let dir: string;
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'token-owner-test-'));
  db = createClient({ url: `file:${join(dir, 'test.db')}` });
  await db.executeMultiple(`
    CREATE TABLE sign_request (token TEXT PRIMARY KEY, user_id TEXT, payload TEXT NOT NULL,
      signature TEXT, signed_at TEXT);
    CREATE TABLE live_view (token TEXT PRIMARY KEY, user_id TEXT, payload TEXT NOT NULL);
    CREATE TABLE rate_limit (bucket TEXT PRIMARY KEY, count INTEGER NOT NULL DEFAULT 0,
      window_start TEXT NOT NULL DEFAULT (datetime('now')));
  `);
});
afterEach(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });

describe('who may write under a signing link', () => {
  it('belongs to the producer who sent it, and to nobody who was merely sent it', async () => {
    expect(await upsertSignRequest(db, 'tok', 'producer', 'payload-1')).toBe(true);
    expect(await signTokenOwnership(db, 'tok', 'producer')).toBe('mine');
    // The performer who received the link and has an account of their own.
    expect(await signTokenOwnership(db, 'tok', 'performer')).toBe('other');
    expect(await upsertSignRequest(db, 'tok', 'performer', 'replaced')).toBe(false);
    const row = await db.execute('SELECT user_id, payload FROM sign_request');
    expect(row.rows[0].user_id).toBe('producer');
    expect(row.rows[0].payload).toBe('payload-1');
  });

  it('is open before anyone has written under the token, and re-sending keeps the signature', async () => {
    expect(await signTokenOwnership(db, 'fresh', 'producer')).toBe('free');
    await upsertSignRequest(db, 'fresh', 'producer', 'v1');
    await db.execute({ sql: `UPDATE sign_request SET signature = 'sig', signed_at = 'now' WHERE token = 'fresh'` });
    expect(await upsertSignRequest(db, 'fresh', 'producer', 'v2')).toBe(true);
    const row = await db.execute('SELECT payload, signature FROM sign_request');
    expect(row.rows[0].payload).toBe('v2');
    expect(row.rows[0].signature).toBe('sig');
  });

  it('lets the next producer write claim a request made before owners were recorded', async () => {
    await db.execute({ sql: `INSERT INTO sign_request (token, payload) VALUES ('old', 'legacy')` });
    expect(await signTokenOwnership(db, 'old', 'producer')).toBe('free');
    expect(await upsertSignRequest(db, 'old', 'producer', 'resent')).toBe(true);
    expect(await signTokenOwnership(db, 'old', 'someone-else')).toBe('other');
  });
});

describe('who may write under a viewer link', () => {
  it('follows whoever published the live state, once anyone has', async () => {
    expect(await liveTokenOwnership(db, 'view', 'producer')).toBe('free');
    await db.execute({ sql: `INSERT INTO live_view (token, user_id, payload) VALUES ('view', 'producer', '{}')` });
    expect(await liveTokenOwnership(db, 'view', 'producer')).toBe('mine');
    // Someone in the audience who signed up for a free account.
    expect(await liveTokenOwnership(db, 'view', 'audience')).toBe('other');
  });
});

describe('a limit that counts only failures', () => {
  it('has room until the failures are spent, and a look does not spend any', async () => {
    for (let i = 0; i < 5; i++) expect((await rateLimitPeek(db, 'b', 3, 300)).allowed).toBe(true);
    await rateLimit(db, 'b', 3, 300);
    await rateLimit(db, 'b', 3, 300);
    expect((await rateLimitPeek(db, 'b', 3, 300)).allowed).toBe(true);
    await rateLimit(db, 'b', 3, 300);
    expect((await rateLimitPeek(db, 'b', 3, 300)).allowed).toBe(false);
  });

  it('forgets failures once the window has passed', async () => {
    await rateLimit(db, 'b', 1, 300);
    expect((await rateLimitPeek(db, 'b', 1, 300)).allowed).toBe(false);
    await db.execute({ sql: `UPDATE rate_limit SET window_start = datetime('now', '-301 seconds') WHERE bucket = 'b'` });
    expect((await rateLimitPeek(db, 'b', 1, 300)).allowed).toBe(true);
  });
});

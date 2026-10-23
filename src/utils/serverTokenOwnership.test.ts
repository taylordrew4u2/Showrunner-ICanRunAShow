import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { applySchema } from '../../api/_lib/db';
import { liveTokenOwnership, signTokenOwnership, upsertSignRequest } from '../../api/_lib/tokenOwnership';
import { rateLimit, rateLimitPeek } from '../../api/_lib/ratelimit';

let db: Client;
let dir: string;
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'token-owner-test-'));
  db = createClient({ url: `file:${join(dir, 'test.db')}` });
  // The real schema: who owns a token now reads the chunk tables as well.
  await applySchema(db);
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

  it('is the uploader’s once its document is there, before any request names it', async () => {
    // Every build uploads the document first. Chunks from before chunks named
    // anyone leave the token free, as it always was.
    await db.execute({ sql: `INSERT INTO sign_doc (token, seq, total, data) VALUES ('doc', 0, 2, 'old')` });
    expect(await signTokenOwnership(db, 'doc', 'performer')).toBe('free');
    await db.execute({ sql: `INSERT INTO sign_doc (token, seq, total, data, user_id, bytes) VALUES ('doc', 1, 2, 'new', 'producer', 3)` });
    expect(await signTokenOwnership(db, 'doc', 'producer')).toBe('mine');
    expect(await signTokenOwnership(db, 'doc', 'performer')).toBe('other');
    expect(await upsertSignRequest(db, 'doc', 'performer', 'taken')).toBe(false);
    expect(await upsertSignRequest(db, 'doc', 'producer', 'terms')).toBe(true);
    const row = await db.execute('SELECT user_id, payload FROM sign_request');
    expect(Array.from(row.rows[0])).toEqual(['producer', 'terms']);
  });

  it('is not claimed by the next account to write under a request made before owners were recorded', async () => {
    // The producer never writes under an existing token again, so the next
    // writer is whoever was sent the link.
    await db.execute({ sql: `INSERT INTO sign_request (token, payload) VALUES ('old', 'legacy')` });
    expect(await signTokenOwnership(db, 'old', 'performer')).toBe('legacy');
    expect(await upsertSignRequest(db, 'old', 'performer', 'replaced')).toBe(false);
    const row = await db.execute('SELECT user_id, payload FROM sign_request');
    expect(Array.from(row.rows[0])).toEqual([null, 'legacy']);
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

  it('follows whoever sent audio under it, until the live state names someone', async () => {
    await db.execute({ sql: `INSERT INTO live_media (token, id, seq, total, data, user_id, bytes) VALUES ('board', 'walk-on-1', 0, 1, 'x', 'producer', 1)` });
    expect(await liveTokenOwnership(db, 'board', 'producer')).toBe('mine');
    expect(await liveTokenOwnership(db, 'board', 'audience')).toBe('other');
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

  it('sweeps out buckets whose window ended long ago, now and then', async () => {
    // A login under a made-up account name makes a new bucket every time, and
    // nothing else ever removes one.
    await db.execute(`INSERT INTO rate_limit (bucket, count, window_start) VALUES ('stale', 1, datetime('now', '-2 days'))`);
    await db.execute(`INSERT INTO rate_limit (bucket, count, window_start) VALUES ('recent', 1, datetime('now', '-1 hour'))`);
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    await rateLimit(db, 'b', 3, 300);
    expect((await db.execute('SELECT bucket FROM rate_limit ORDER BY bucket')).rows.map((r) => r[0])).toEqual(['b', 'recent', 'stale']);
    random.mockReturnValue(0);
    await rateLimit(db, 'b', 3, 300);
    expect((await db.execute('SELECT bucket FROM rate_limit ORDER BY bucket')).rows.map((r) => r[0])).toEqual(['b', 'recent']);
    random.mockRestore();
  });

  it('forgets failures once the window has passed', async () => {
    await rateLimit(db, 'b', 1, 300);
    expect((await rateLimitPeek(db, 'b', 1, 300)).allowed).toBe(false);
    await db.execute({ sql: `UPDATE rate_limit SET window_start = datetime('now', '-301 seconds') WHERE bucket = 'b'` });
    expect((await rateLimitPeek(db, 'b', 1, 300)).allowed).toBe(true);
  });
});

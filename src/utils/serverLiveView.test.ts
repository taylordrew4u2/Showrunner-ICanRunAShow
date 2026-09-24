import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient, type Client } from '@libsql/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import handler, { STALE_PUBLISH_WINDOW_MS } from '../../api/live';

const connection = vi.hoisted(() => ({ db: null as Client | null }));
vi.mock('../../api/_lib/db', () => ({
  ensureSchema: async () => {},
  getDb: () => connection.db,
  ServerNotConfiguredError: class extends Error {},
}));
vi.mock('../../api/_lib/auth', () => ({
  authorize: async (req: Request) => req.headers.get('x-user-id'),
}));

let dir: string;
const token = 'room-screen';
const publish = (lastUpdateMs: number, user = 'producer', name = `at ${lastUpdateMs}`) =>
  handler(new Request('https://example.test/api/live', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-user-id': user },
    body: JSON.stringify({ token, payload: { showName: name, status: 'running', lastUpdateMs } }),
  }));
const shown = async () => {
  const res = await handler(new Request(`https://example.test/api/live?token=${token}`));
  return (await res.json()).payload as { showName: string; lastUpdateMs: number };
};

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'showrunner-live-'));
  connection.db = createClient({ url: `file:${join(dir, 'test.db')}` });
  await connection.db.execute(`CREATE TABLE live_view (
    token TEXT PRIMARY KEY, user_id TEXT, payload TEXT NOT NULL, updated_at TEXT
  )`);
});
afterEach(() => {
  connection.db?.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('publishing the live view', () => {
  it('keeps the newer state when a slower publish from the same board lands late', async () => {
    // The board wrote "A on stage" at t=0 and "nobody" at t=1; the first
    // request stalled on venue wifi and reached the server second.
    expect((await publish(1_000, 'producer', 'nobody')).status).toBe(200);
    const late = await publish(0, 'producer', 'A on stage');
    expect(late.status).toBe(200);
    expect(await late.json()).toEqual({ ok: true, stale: true });
    expect((await shown()).showName).toBe('nobody');
  });

  it('follows a board whose clock is behind the one that published before', async () => {
    // The producer moved from a phone to a laptop whose clock is five minutes
    // slow. A late request is seconds late, never minutes: this is a new
    // device, and the room must follow it rather than freeze.
    await publish(600_000);
    const fromLaptop = 600_000 - STALE_PUBLISH_WINDOW_MS - 1;
    expect(await (await publish(fromLaptop)).json()).toEqual({ ok: true });
    expect((await shown()).lastUpdateMs).toBe(fromLaptop);
  });

  it('accepts a row written before payloads carried a time', async () => {
    await connection.db!.execute({
      sql: `INSERT INTO live_view (token, user_id, payload) VALUES (?, ?, ?)`,
      args: [token, 'producer', JSON.stringify({ showName: 'old', status: 'idle' })],
    });
    expect(await (await publish(5)).json()).toEqual({ ok: true });
    expect((await shown()).lastUpdateMs).toBe(5);
  });

  it('still refuses to let anyone but the producer write under the token', async () => {
    await publish(1_000);
    expect((await publish(2_000, 'someone-in-the-room')).status).toBe(403);
    expect((await publish(500, 'someone-in-the-room')).status).toBe(403);
    expect((await shown()).lastUpdateMs).toBe(1_000);
  });
});

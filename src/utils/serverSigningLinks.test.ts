import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient, type Client } from '@libsql/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import sign from '../../api/sign';
import signDoc from '../../api/sign-doc';
import profilePhoto from '../../api/profile-photo';
import { applySchema } from '../../api/_lib/db';

const connection = vi.hoisted(() => ({ db: null as Client | null }));
vi.mock('../../api/_lib/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/_lib/db')>()),
  ensureSchema: async () => {},
  getDb: () => connection.db,
}));
vi.mock('../../api/_lib/auth', () => ({
  authorize: async (req: Request) => req.headers.get('x-user-id'),
}));

let dir: string;
const token = 'contract-link-token-0001';

/** One request to a route, as `user` when given and anonymously when not. */
function call(route: (req: Request) => Promise<Response>, method: string, path: string, body?: unknown, user?: string) {
  return route(new Request(`https://example.test${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(user ? { 'x-user-id': user } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
}

const count = async (table: string) =>
  Number((await connection.db!.execute({ sql: `SELECT COUNT(*) FROM ${table} WHERE token = ?`, args: [token] })).rows[0][0]);

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'showrunner-signing-'));
  connection.db = createClient({ url: `file:${join(dir, 'test.db')}` });
  await applySchema(connection.db);
});
afterEach(() => {
  connection.db?.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('withdrawing a link', () => {
  it('clears everything stored under it, including chunks sent to the photo route', async () => {
    expect((await call(sign, 'PUT', '/api/sign', { token, payload: 'request' }, 'producer')).status).toBe(200);
    // Whoever holds an unanswered contract link may write here; nothing on
    // the contract side ever reads it back.
    const chunk = { token, seq: 0, total: 1, data: 'x'.repeat(1000) };
    expect((await call(profilePhoto, 'PUT', '/api/profile-photo', chunk)).status).toBe(200);

    expect((await call(sign, 'DELETE', `/api/sign?token=${token}`, undefined, 'producer')).status).toBe(200);
    expect(await count('sign_request')).toBe(0);
    expect(await count('profile_photo')).toBe(0);
  });
});

describe('a link made before owners were recorded', () => {
  // Rows from 2026-08-31 to 2026-09-24 name no account. The producer never
  // writes under an existing token again — every send makes a fresh one — so
  // the next account to write there is the performer or someone they
  // forwarded the link to.
  beforeEach(async () => {
    await connection.db!.execute({ sql: `INSERT INTO sign_request (token, payload) VALUES (?, 'original-terms')`, args: [token] });
    await connection.db!.execute({ sql: `INSERT INTO sign_doc (token, seq, total, data) VALUES (?, 0, 1, 'original-pdf')`, args: [token] });
  });

  it('cannot have its terms or its document swapped by whoever holds it', async () => {
    const swapDoc = { token, seq: 0, total: 1, data: 'swapped-pdf' };
    expect((await call(signDoc, 'PUT', '/api/sign-doc', swapDoc, 'link-holder')).status).toBe(403);
    expect((await call(sign, 'PUT', '/api/sign', { token, payload: 'swapped-terms' }, 'link-holder')).status).toBe(403);

    const request = await connection.db!.execute({ sql: `SELECT user_id, payload FROM sign_request WHERE token = ?`, args: [token] });
    expect(Array.from(request.rows[0])).toEqual([null, 'original-terms']);
    const doc = await connection.db!.execute({ sql: `SELECT data FROM sign_doc WHERE token = ?`, args: [token] });
    expect(doc.rows[0][0]).toBe('original-pdf');
  });

  it('cannot be claimed, so its producer can still withdraw it', async () => {
    await call(sign, 'PUT', '/api/sign', { token, payload: 'swapped-terms' }, 'link-holder');
    expect((await call(sign, 'DELETE', `/api/sign?token=${token}`, undefined, 'producer')).status).toBe(200);
    expect(await count('sign_request')).toBe(0);
    expect(await count('sign_doc')).toBe(0);
  });
});

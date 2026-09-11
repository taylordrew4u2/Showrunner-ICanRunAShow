import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient, type Client } from '@libsql/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import handler from '../../api/sign';
import { decryptWithKey, encryptWithKey } from './encryption';

const connection = vi.hoisted(() => ({ db: null as Client | null }));
vi.mock('../../api/_lib/db', () => ({
  ensureSchema: async () => {},
  getDb: () => connection.db,
  ServerNotConfiguredError: class extends Error {},
}));
vi.mock('../../api/_lib/auth', () => ({ authorize: async () => 'test-producer' }));

let dir: string;
const token = 'existing-link-from-before-headshots';
const key = 'test-only-encryption-key';
const post = (signature: string) => handler(new Request('https://example.test/api/sign', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ token, signature }),
}));

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'showrunner-sign-'));
  connection.db = createClient({ url: `file:${join(dir, 'test.db')}` });
  await connection.db.execute(`CREATE TABLE sign_request (
    token TEXT PRIMARY KEY, payload TEXT NOT NULL, signature TEXT, signed_at TEXT
  )`);
  await connection.db.execute({
    sql: 'INSERT INTO sign_request (token, payload) VALUES (?, ?)',
    args: [token, encryptWithKey({ contractName: 'Test agreement', createdAt: '2026-09-06' }, key)],
  });
});
afterEach(() => {
  connection.db?.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('submitting an existing signing link', () => {
  it('accepts and returns an encrypted headshot larger than the former 32 KB cap', async () => {
    const record = {
      typedName: 'Test performer',
      headshot: 'data:image/jpeg;base64,' + 'A'.repeat(300_000),
      signedAt: '2026-09-11T12:00:00Z',
      documentHash: 'test-document-hash',
    };
    const signature = encryptWithKey(record, key);
    expect(signature.length).toBeGreaterThan(32 * 1024);
    expect((await post(signature)).status).toBe(200);
    const read = await handler(new Request(`https://example.test/api/sign?token=${token}`));
    const saved = await read.json();
    expect(decryptWithKey(saved.signature, key)).toEqual(record);
    expect(saved.signedAt).toBeTruthy();
    // A second submission cannot replace the recorded agreement.
    expect((await post(encryptWithKey({ typedName: 'Someone else' }, key))).status).toBe(409);
    const row = await connection.db!.execute('SELECT signature FROM sign_request');
    expect(row.rows[0][0]).toBe(signature);
  });

  it('continues accepting signatures without a photo', async () => {
    expect((await post(encryptWithKey({ typedName: 'Test performer' }, key))).status).toBe(200);
  });

  it('rejects oversized submissions without consuming the existing link', async () => {
    const response = await post('A'.repeat(3 * 1024 * 1024));
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: 'payload_too_large' });
    const row = await connection.db!.execute('SELECT signature, signed_at FROM sign_request');
    expect(Array.from(row.rows[0])).toEqual([null, null]);
    expect((await post(encryptWithKey({ typedName: 'Test performer' }, key))).status).toBe(200);
  });
});

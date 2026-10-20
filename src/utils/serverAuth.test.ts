import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient, type Client } from '@libsql/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import auth from '../../api/auth';
import shows from '../../api/shows';
import { authorize } from '../../api/_lib/auth';
import { hashCredential } from '../../api/_lib/credentials';
import { applySchema } from '../../api/_lib/db';
import { deriveAuthKey, deriveUserId, hashPassword } from './encryption';

// The real schema and migrations, run against a file database. Only the
// connection is swapped in.
const connection = vi.hoisted(() => ({ db: null as Client | null }));
vi.mock('../../api/_lib/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/_lib/db')>()),
  ensureSchema: async () => {},
  getDb: () => connection.db,
}));

const PASSWORD = 'correct horse battery staple';
const USER = deriveUserId('producer');
const v1 = (password = PASSWORD) => hashPassword(password);
const v2 = (password = PASSWORD) => deriveAuthKey(password, USER);

let dir: string;
const db = () => connection.db!;
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'showrunner-auth-'));
  connection.db = createClient({ url: `file:${join(dir, 'test.db')}` });
  // The users table as production has it before this change, so every account
  // below reaches client_hash_version through the same migration.
  await db().execute(`CREATE TABLE users (
    id TEXT PRIMARY KEY, password_hash TEXT NOT NULL, auth_salt TEXT,
    auth_version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
});
afterEach(() => {
  connection.db?.close();
  rmSync(dir, { recursive: true, force: true });
});

type Answer = { status: number; body: { ok?: boolean; legacy?: boolean; error?: string } };
async function send(body: Record<string, unknown>): Promise<Answer> {
  const res = await auth(new Request('https://example.test/api/auth', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }));
  return { status: res.status, body: await res.json() };
}
const signUp = (sent: Record<string, unknown>) => send({ action: 'signup', userId: USER, ...sent });
const signIn = (sent: Record<string, unknown>) => send({ action: 'login', userId: USER, ...sent });
/** Whether a request carrying this x-auth gets in, as every producer route asks. */
const opens = async (credential: string) =>
  (await authorize(new Request('https://example.test/api/shows', {
    headers: { 'x-user-id': USER, 'x-auth': credential },
  }))) === USER;
const row = async () =>
  (await db().execute({
    sql: 'SELECT password_hash, auth_salt, auth_version, client_hash_version FROM users WHERE id = ?',
    args: [USER],
  })).rows[0];

/** An account as the server stored it before this change: a slow hash of the old SHA-256. */
async function accountFromBefore() {
  const { salt, hash } = await hashCredential(v1());
  await db().execute({
    sql: 'INSERT INTO users (id, password_hash, auth_salt, auth_version) VALUES (?, ?, ?, 2)',
    args: [USER, hash, salt],
  });
  await applySchema(db());
}

/** Older still: the old SHA-256 stored as sent, before the server hashed anything. */
async function accountFromBeforeServerHashing() {
  await db().execute({ sql: 'INSERT INTO users (id, password_hash) VALUES (?, ?)', args: [USER, v1()] });
  await applySchema(db());
}

describe('an account made before the per-account credential', () => {
  it('reads as v1, keeps opening with the old hash, and moves over at its next sign-in', async () => {
    await accountFromBefore();
    const before = await row();
    expect(before.client_hash_version).toBe(1);
    // A session saved by an earlier build still works until the account moves.
    expect(await opens(v1())).toBe(true);

    // A current build tries the new credential alone first. The server cannot
    // check it against a v1 verifier, so it asks for the old hash rather than
    // calling the password wrong, and changes nothing.
    expect(await signIn({ authKey: await v2() })).toEqual({ status: 200, body: { ok: false, legacy: true } });
    expect(await row()).toEqual(before);

    expect(await signIn({ authKey: await v2(), passwordHash: v1() })).toEqual({ status: 200, body: { ok: true } });
    const after = await row();
    expect(after.client_hash_version).toBe(2);
    expect(after.auth_version).toBe(2);
    expect(after.password_hash).not.toBe(before.password_hash);

    // From here on only the new credential opens it, on every route.
    expect(await opens(await v2())).toBe(true);
    expect(await opens(v1())).toBe(false);
    expect((await signIn({ authKey: await v2() })).body).toEqual({ ok: true });
    expect((await signIn({ passwordHash: v1() })).status).toBe(426);
    // Not even beside a wrong authKey: the old hash no longer proves anything.
    expect((await signIn({ authKey: await v2('not the password'), passwordHash: v1() })).body).toEqual({ ok: false });
  });

  it('moves over from before the server hashed credentials, too', async () => {
    await accountFromBeforeServerHashing();
    expect((await row()).client_hash_version).toBe(1);
    expect((await signIn({ authKey: await v2(), passwordHash: v1() })).body).toEqual({ ok: true });
    const after = await row();
    expect(after.client_hash_version).toBe(2);
    expect(after.auth_version).toBe(2);
    expect(after.auth_salt).not.toBeNull();
    expect(after.password_hash).not.toBe(v1());
    expect(await opens(await v2())).toBe(true);
    expect(await opens(v1())).toBe(false);
  });

  // The server cannot tell whether an authKey came from the same password as
  // the old hash. So the old hash has to be right before anything moves: the
  // right authKey alone, or beside a wrong old hash, claims nothing.
  it('stays where it is when the old hash is wrong, whatever authKey comes with it', async () => {
    await accountFromBefore();
    const before = await row();
    expect((await signIn({ authKey: await v2(), passwordHash: v1('not the password') })).body).toEqual({ ok: false });
    expect((await signIn({ authKey: await v2('not the password'), passwordHash: v1('not the password') })).body).toEqual({ ok: false });
    expect(await row()).toEqual(before);
    expect(await opens(v1())).toBe(true);
  });

  // A build cached from before the change, signing in after the account has
  // moved, has nothing the account takes. Refused every time, but without
  // spending the ten tries the producer's current devices need, and as an
  // error rather than a "no": that build calls a "no" a wrong password.
  it('refuses a build from before once the account has moved, without counting it as a guess', async () => {
    await accountFromBefore();
    await signIn({ authKey: await v2(), passwordHash: v1() });
    for (let i = 0; i < 12; i++) {
      expect(await signIn({ passwordHash: v1() })).toEqual({ status: 426, body: { error: 'update_required' } });
    }
    expect(await signIn({ authKey: await v2() })).toEqual({ status: 200, body: { ok: true } });
  });

  it('still lets a build from before sign in, without moving the account', async () => {
    await accountFromBeforeServerHashing();
    expect((await signIn({ passwordHash: v1() })).body).toEqual({ ok: true });
    // The server's own hashing still upgrades, but the row still wraps the
    // old hash and says so; marked v2, nothing could ever open it again.
    const after = await row();
    expect(after.auth_version).toBe(2);
    expect(after.client_hash_version).toBe(1);
    expect(await opens(v1())).toBe(true);
    expect((await signIn({ authKey: await v2(), passwordHash: v1() })).body).toEqual({ ok: true });
    expect((await row()).client_hash_version).toBe(2);
  });
});

describe('a new account', () => {
  beforeEach(() => applySchema(db()));

  it('stores the per-account credential, and the old hash never opens it', async () => {
    expect(await signUp({ authKey: await v2() })).toEqual({ status: 200, body: { ok: true } });
    expect((await row()).client_hash_version).toBe(2);
    expect(await opens(await v2())).toBe(true);
    expect(await opens(v1())).toBe(false);
    expect((await signIn({ authKey: await v2() })).body).toEqual({ ok: true });
    expect((await signIn({ passwordHash: v1() })).status).toBe(426);
    expect((await signIn({ authKey: await v2(), passwordHash: v1() })).body).toEqual({ ok: true });
  });

  it('refuses a wrong password, and an account that was never made, without asking for the old hash', async () => {
    await signUp({ authKey: await v2() });
    expect((await signIn({ authKey: await v2('not the password') })).body).toEqual({ ok: false });
    expect(await opens(await v2('not the password'))).toBe(false);
    expect((await send({ action: 'login', userId: deriveUserId('nobody'), authKey: await v2() })).body).toEqual({ ok: false });
  });

  // A build cached from before this change can still make an account. Filed
  // as v2 it would hold the old hash under the new label, and the first
  // sign-in from a current build could never match it.
  it('made by a build from before is filed as v1, and moves over like any other', async () => {
    expect((await signUp({ passwordHash: v1() })).status).toBe(200);
    expect((await row()).client_hash_version).toBe(1);
    expect((await signIn({ authKey: await v2() })).body).toEqual({ ok: false, legacy: true });
    expect((await signIn({ authKey: await v2(), passwordHash: v1() })).body).toEqual({ ok: true });
    expect((await row()).client_hash_version).toBe(2);
    expect(await opens(await v2())).toBe(true);
  });

  // The app signs out on a 401, so a 401 has to mean the credential is wrong.
  // Turned away unread after someone else's failures from the same address,
  // a valid session gets an answer it waits out instead.
  it('is answered 429, not 401, once the failures from its address are used up', async () => {
    await signUp({ authKey: await v2() });
    for (let i = 0; i < 20; i++) expect(await opens('a guess')).toBe(false);
    const res = await shows(new Request('https://example.test/api/shows', {
      headers: { 'x-user-id': USER, 'x-auth': await v2() },
    }));
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: 'too_many_requests' });
  });

  it('is refused without a credential to store', async () => {
    expect((await signUp({})).status).toBe(400);
    expect((await signUp({ authKey: 42 })).status).toBe(400);
    expect((await signIn({})).status).toBe(400);
    expect((await db().execute('SELECT COUNT(*) AS n FROM users')).rows[0].n).toBe(0);
  });
});

describe('a request that is not from the app', () => {
  const buckets = async () => {
    await applySchema(db());
    return Number((await db().execute('SELECT COUNT(*) FROM rate_limit')).rows[0][0]);
  };

  it('counts a failed sign-in to an account that does not exist against that name', async () => {
    await applySchema(db());
    expect((await send({ action: 'login', userId: 'b'.repeat(32), authKey: 'a'.repeat(64) })).body).toEqual({ ok: false });
    expect(await buckets()).toBe(1);
  });

  it('refuses a name or credential longer than any the app derives, before writing it anywhere', async () => {
    await applySchema(db());
    // The app's account ids are 32 hex characters. A made-up one of 100,000
    // used to become a rate-limit row of that size, kept for good.
    expect((await send({ action: 'login', userId: 'b'.repeat(100_000), authKey: 'a'.repeat(64) })).status).toBe(400);
    expect((await send({ action: 'login', userId: 'b'.repeat(32), authKey: 'c'.repeat(100_000) })).status).toBe(400);
    expect((await send({ action: 'login', userId: 'b'.repeat(32), authKey: 'a'.repeat(64), passwordHash: 'c'.repeat(100_000) })).status).toBe(400);
    expect((await send({ action: 'login', userId: { not: 'a string' }, authKey: 'a'.repeat(64) })).status).toBe(400);
    expect((await send({ action: 'login', userId: 'b'.repeat(32), passwordHash: 42 })).status).toBe(400);
    expect(await buckets()).toBe(0);
  });
});

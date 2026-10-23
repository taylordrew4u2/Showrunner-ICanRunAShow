import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient, type Client } from '@libsql/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import account from '../../api/account';
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
// What Stripe holds, and what the route asked of it.
let stripeSubs: { id: string; customer: string; status: string }[];
let openCheckouts: { id: string; customer: string }[];
let stripeCalls: { method: string; url: string }[];
let stripeRefusesCancel: boolean;

const remove = (user?: string, body?: unknown) =>
  account(new Request('https://example.test/api/account', {
    method: 'DELETE',
    headers: { 'content-type': 'application/json', ...(user ? { 'x-user-id': user } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  }));

const run = (sql: string, ...args: (string | number | null)[]) => connection.db!.execute({ sql, args });

// Tokens that do not spell out whose they are, so only `user_id` ties the
// chunks under them to an account.
let unnamed = 0;

/** One row in every table, as an account that has used everything would have. */
async function seed(user: string, status = 'canceled') {
  const sign = `${user}-sign-token-0001`;
  const view = `${user}-view-token`;
  await run(`INSERT INTO users (id, password_hash) VALUES (?, 'hash')`, user);
  await run(`INSERT INTO user_shows (id, user_id, encrypted_data) VALUES (?, ?, 'cipher')`, `${user}-show`, user);
  await run(`INSERT INTO user_shows_backup (id, user_id, encrypted_data) VALUES (?, ?, 'cipher')`, `${user}-show`, user);
  await run(`INSERT INTO user_settings (user_id, encrypted_data) VALUES (?, 'cipher')`, user);
  await run(`INSERT INTO user_settings_backup (user_id, encrypted_data) VALUES (?, 'cipher')`, user);
  await run(`INSERT INTO user_media (user_id, id, seq, total, data) VALUES (?, ?, 0, 1, 'cipher')`, user, `${user}-track`);
  await run(`INSERT INTO live_view (token, user_id, payload) VALUES (?, ?, '{}')`, view, user);
  await run(`INSERT INTO live_media (token, id, seq, total, data, user_id, bytes) VALUES (?, 'walk-on-1', 0, 1, 'cipher', ?, 6)`, view, user);
  await run(`INSERT INTO sign_request (token, user_id, payload) VALUES (?, ?, 'cipher')`, sign, user);
  await run(`INSERT INTO sign_doc (token, seq, total, data, user_id, bytes) VALUES (?, 0, 1, 'cipher', ?, 6)`, sign, user);
  await run(`INSERT INTO profile_photo (token, seq, total, data, user_id, bytes) VALUES (?, 0, 1, 'cipher', ?, 6)`, sign, user);
  // A contract whose send stopped before its request was made, and audio sent
  // under a viewer link whose live state never landed: no link row names
  // either, and both count against the account until they go.
  unnamed += 1;
  await run(`INSERT INTO sign_doc (token, seq, total, data, user_id, bytes) VALUES (?, 0, 1, 'cipher', ?, 6)`, `unsent-contract-${unnamed}`, user);
  await run(`INSERT INTO live_media (token, id, seq, total, data, user_id, bytes) VALUES (?, 'walk-on-1', 0, 1, 'cipher', ?, 6)`, `unpublished-view-${unnamed}`, user);
  await run(`INSERT INTO subscription (user_id, customer_id, subscription_id, status) VALUES (?, ?, ?, ?)`, user, `cus_${user}`, `sub_${user}`, status);
  await run(`INSERT INTO rate_limit (bucket, count) VALUES (?, 1)`, `auth:${user}:203.0.113.7`);
  await run(`INSERT INTO rate_limit (bucket, count) VALUES (?, 1)`, `authz:${user}:203.0.113.7`);
  stripeSubs.push({ id: `sub_${user}`, customer: `cus_${user}`, status });
}

async function tables(): Promise<string[]> {
  const result = await run(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`);
  return result.rows.map((row) => String(row[0]));
}

const everything = async (table: string) => JSON.stringify((await run(`SELECT * FROM ${table}`)).rows);
const accountExists = async (user: string) => (await run(`SELECT 1 FROM users WHERE id = ?`, user)).rows.length > 0;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'showrunner-account-'));
  connection.db = createClient({ url: `file:${join(dir, 'test.db')}` });
  await applySchema(connection.db);
  vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_x');
  stripeSubs = [];
  openCheckouts = [];
  stripeCalls = [];
  stripeRefusesCancel = false;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    stripeCalls.push({ method, url });
    const checkouts = /\/checkout\/sessions\?customer=([^&]+)&status=open/.exec(url);
    if (checkouts) return Response.json({ data: openCheckouts.filter((c) => c.customer === decodeURIComponent(checkouts[1])) });
    const expire = /\/checkout\/sessions\/([^/?]+)\/expire$/.exec(url);
    if (method === 'POST' && expire) {
      openCheckouts = openCheckouts.filter((c) => c.id !== expire[1]);
      return Response.json({ id: expire[1], status: 'expired' });
    }
    const one = /\/subscriptions\/([^/?]+)$/.exec(url);
    if (method === 'DELETE' && one) {
      if (stripeRefusesCancel) return Response.json({ error: { message: 'Stripe is having a moment' } }, { status: 500 });
      return Response.json({ id: one[1], status: 'canceled' });
    }
    const list = /\/subscriptions\?customer=([^&]+)/.exec(url);
    if (list) return Response.json({ data: stripeSubs.filter((s) => s.customer === decodeURIComponent(list[1])) });
    const found = one && stripeSubs.find((s) => s.id === one[1]);
    if (found) return Response.json(found);
    return Response.json({ error: { code: 'resource_missing', message: 'No such object' } }, { status: 404 });
  }));
  await run(`INSERT INTO rate_limit (bucket, count) VALUES ('signup:203.0.113.7', 1)`);
});
afterEach(() => {
  connection.db?.close();
  rmSync(dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('deleting an account', () => {
  it('removes every row it owns, in every table, and leaves everyone else’s', async () => {
    await seed('producer');
    await seed('neighbour');
    // A table added later has to be seeded here, which means somebody has
    // decided what deleting an account does to it.
    for (const table of await tables()) expect(await everything(table), table).not.toBe('[]');

    expect((await remove('producer')).status).toBe(200);
    for (const table of await tables()) {
      const rows = await everything(table);
      expect(rows, table).not.toContain('producer');
      expect(rows, table).toContain('neighbour');
    }
    expect(stripeCalls.filter((c) => c.method === 'DELETE')).toEqual([]);
  });

  it('cancels whatever the account could still be charged for, straight away', async () => {
    await seed('producer', 'active');
    // A second subscription on the same customer, and one long over.
    stripeSubs.push({ id: 'sub_second', customer: 'cus_producer', status: 'past_due' });
    stripeSubs.push({ id: 'sub_old', customer: 'cus_producer', status: 'canceled' });

    expect((await remove('producer')).status).toBe(200);
    const cancelled = stripeCalls.filter((c) => c.method === 'DELETE').map((c) => c.url.split('/').pop());
    expect(cancelled.sort()).toEqual(['sub_producer', 'sub_second']);
    expect(await accountExists('producer')).toBe(false);
  });

  it('closes a checkout left open, before anything else, so it cannot start a subscription afterwards', async () => {
    await seed('producer');
    await seed('neighbour');
    // Upgrade, opened in another tab and not finished yet.
    openCheckouts.push({ id: 'cs_producer', customer: 'cus_producer' }, { id: 'cs_neighbour', customer: 'cus_neighbour' });

    expect((await remove('producer')).status).toBe(200);
    expect(openCheckouts).toEqual([{ id: 'cs_neighbour', customer: 'cus_neighbour' }]);
    const expired = stripeCalls.findIndex((c) => c.url.endsWith('/checkout/sessions/cs_producer/expire'));
    const listed = stripeCalls.findIndex((c) => c.url.includes('/subscriptions?customer='));
    expect(expired).toBeGreaterThan(-1);
    expect(expired).toBeLessThan(listed);
  });

  it('deletes nothing when Stripe will not cancel the subscription', async () => {
    await seed('producer', 'active');
    stripeRefusesCancel = true;
    const res = await remove('producer');
    expect(res.status).toBe(502);
    expect(await accountExists('producer')).toBe(true);
    expect(await everything('user_shows')).toContain('producer');
  });

  it('deletes nothing while Stripe is out of reach and the account may still be charged', async () => {
    await seed('producer', 'active');
    vi.stubEnv('STRIPE_SECRET_KEY', '');
    expect((await remove('producer')).status).toBe(501);
    expect(await accountExists('producer')).toBe(true);
  });

  it('goes ahead without Stripe when nothing is left to charge', async () => {
    await seed('producer', 'canceled');
    vi.stubEnv('STRIPE_SECRET_KEY', '');
    expect((await remove('producer')).status).toBe(200);
    expect(await accountExists('producer')).toBe(false);
  });

  it('takes the links from before owners were recorded that the account names, and nobody else’s', async () => {
    await seed('producer');
    await seed('neighbour');
    await run(`INSERT INTO sign_request (token, payload) VALUES ('old-contract-link-01', 'cipher')`);
    await run(`INSERT INTO sign_doc (token, seq, total, data) VALUES ('old-contract-link-01', 0, 1, 'cipher')`);
    await run(`INSERT INTO live_view (token, payload) VALUES ('old-viewer-link', '{}')`);
    await run(`INSERT INTO live_media (token, id, seq, total, data) VALUES ('old-viewer-link', 'walk-on-1', 0, 1, 'cipher')`);

    // The neighbour's chunks that no link row covers are still the
    // neighbour's: the chunks name them.
    const unsent = String((await run(`SELECT token FROM sign_doc WHERE user_id = 'neighbour' AND token LIKE 'unsent-%'`)).rows[0][0]);
    const unpublished = String((await run(`SELECT token FROM live_media WHERE user_id = 'neighbour' AND token LIKE 'unpublished-%'`)).rows[0][0]);

    const tokens = ['old-contract-link-01', 'old-viewer-link', 'neighbour-sign-token-0001', 'neighbour-view-token', unsent, unpublished];
    expect((await remove('producer', { tokens })).status).toBe(200);
    for (const table of ['sign_request', 'sign_doc', 'live_view', 'live_media']) {
      expect(await everything(table), table).not.toContain('old-');
    }
    expect(await everything('sign_doc')).toContain('neighbour-sign-token-0001');
    expect(await everything('live_media')).toContain('neighbour-view-token');
    expect(await everything('sign_doc')).toContain(unsent);
    expect(await everything('live_media')).toContain(unpublished);
  });

  it('needs the account’s own sign-in', async () => {
    await seed('producer');
    expect((await remove()).status).toBe(401);
    expect(await accountExists('producer')).toBe(true);
  });

  it('refuses a body that is not a list of links, and deletes nothing', async () => {
    await seed('producer');
    expect((await remove('producer', { tokens: 'everything' })).status).toBe(400);
    expect((await remove('producer', { tokens: ['x'.repeat(129)] })).status).toBe(400);
    expect(await accountExists('producer')).toBe(true);
  });
});

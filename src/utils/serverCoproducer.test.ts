import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient, type Client } from '@libsql/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import coproducer from '../../api/coproducer';
import sign from '../../api/sign';
import signDoc from '../../api/sign-doc';
import { COPRODUCER_SEAL_INFO, sealBinding } from '../../api/_lib/coproducerAuth';
import { pseudonym } from '../../api/_lib/coproducerViews';
import { applySchema } from '../../api/_lib/db';
import { hasLinkRoom } from '../../api/_lib/linkStorage';
import { unsealKeys } from '../../api/_lib/seal';
import { cipherHash } from '../../api/_lib/showWrites';
import { buildOutline } from '../coproducer/outline';
import { FIXTURE_SECRETS, fullSettings, fullShow } from '../coproducer/testFixtures';
import type { CoproducerLinkInfo, CoproducerRequestView, EditPayload, OwnerRequestRow, RequestPayload } from '../coproducer/types';
import type { AppSettings, Show } from '../types';
import { decryptWithKey, encryptWithKey } from './encryption';

const connection = vi.hoisted(() => ({ db: null as Client | null }));
const locked = vi.hoisted(() => new Set<string>());
vi.mock('../../api/_lib/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/_lib/db')>()),
  ensureSchema: async () => {},
  getDb: () => connection.db,
}));
vi.mock('../../api/_lib/auth', () => ({
  authorize: async (req: Request) => req.headers.get('x-user-id'),
}));
vi.mock('../../api/_lib/plan', () => ({
  producerLocked: async (_db: unknown, userId: string) => locked.has(userId),
}));

const main = 'https://icanrunashow.com';
const review = 'https://showrunner-theta.vercel.app';
const KEY = randomBytes(32).toString('hex');
const LEGACY = randomBytes(32).toString('hex');
const NEIGHBOUR_KEY = randomBytes(32).toString('hex');
const NEIGHBOUR_LEGACY = randomBytes(32).toString('hex');
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const SVG = `data:image/svg+xml;base64,${btoa('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>')}`;
const HTML = `data:text/html;base64,${btoa('<html><script>alert(1)</script></html>')}`;
const PNG_AS_AUDIO = PNG.replace('image/png', 'audio/mpeg');
const DAY = 24 * 60 * 60;

let dir: string;

const run = (sql: string, ...args: (string | number | null)[]) => connection.db!.execute({ sql, args });
const rows = async (sql: string, ...args: (string | number | null)[]) => (await run(sql, ...args)).rows.map((row) => Array.from(row));
const count = async (sql: string, ...args: (string | number | null)[]) => Number((await run(sql, ...args)).rows[0][0]);
const now = () => Math.floor(Date.now() / 1000);

interface Call {
  method?: string;
  body?: unknown;
  raw?: string;
  user?: string;
  token?: string;
  origin?: string;
  ip?: string;
  headers?: Record<string, string>;
}

function call(query: string, opts: Call = {}): Promise<Response> {
  const headers: Record<string, string> = { 'x-forwarded-for': opts.ip ?? '203.0.113.7', ...opts.headers };
  if (opts.body !== undefined || opts.raw !== undefined) headers['content-type'] = 'application/json';
  if (opts.user) headers['x-user-id'] = opts.user;
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.origin) headers.origin = opts.origin;
  return coproducer(new Request(`${opts.token ? review : main}/api/coproducer?${query}`, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.raw ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body)),
  }));
}
const asOwner = (query: string, opts: Call = {}) => call(query, { user: 'producer', ...opts });
const asHolder = (token: string, query: string, opts: Call = {}) => call(query, { token, ...opts });
const error = async (res: Response) => ((await res.json()) as { error?: string }).error;

async function makeLink(user = 'producer', label = 'Sam Rivera'): Promise<{ token: string; link: CoproducerLinkInfo }> {
  const keys = user === 'producer' ? { key: KEY, legacyKey: LEGACY } : { key: NEIGHBOUR_KEY, legacyKey: NEIGHBOUR_LEGACY };
  const res = await call('route=links', { method: 'POST', user, body: { label, ...keys, consent: true } });
  expect(res.status).toBe(201);
  return (await res.json()) as { token: string; link: CoproducerLinkInfo };
}

async function saveShow(show: Show, user = 'producer', key = KEY) {
  await run('INSERT OR REPLACE INTO user_shows (id, user_id, encrypted_data) VALUES (?, ?, ?)', show.id, user, encryptWithKey(show, key));
}
async function saveSettings(settings: AppSettings, user = 'producer', key = KEY) {
  await run('INSERT OR REPLACE INTO user_settings (user_id, encrypted_data) VALUES (?, ?)', user, encryptWithKey(settings, key));
}
async function saveMedia(id: string, slices: string[], user = 'producer', key = KEY) {
  for (const [seq, slice] of slices.entries()) {
    await run('INSERT INTO user_media (user_id, id, seq, total, data) VALUES (?, ?, ?, ?, ?)', user, id, seq, slices.length, encryptWithKey(slice, key));
  }
}

const simpleShow = (id = 'show1', over: Partial<Show> = {}): Show => ({ ...fullShow({ id, viewToken: undefined, viewerKey: undefined }), ...over }) as Show;

function editPayload(venue = 'The Cellar', showId = 'show1'): EditPayload {
  return {
    kind: 'edit',
    shows: [{ target: 'show', op: 'update', showId, baseRevision: null, keys: ['venueName'], base: { venueName: 'The Basement' }, proposed: { venueName: venue } }],
    settings: null,
  };
}
function flyerPayload(ref: string): EditPayload {
  return {
    kind: 'edit',
    shows: [{ target: 'show', op: 'update', showId: 'show1', baseRevision: null, keys: ['flyer'], base: {}, proposed: { flyer: ref } }],
    settings: null,
  };
}
const sharePayload: RequestPayload = { kind: 'share', action: { type: 'viewer-link', showId: 'show1' } };
const downloadPayload: RequestPayload = { kind: 'download', action: { type: 'flyer', showId: 'show1' } };

function ask(token: string, payload: RequestPayload = editPayload(), mediaIds: string[] = [], opts: Call = {}) {
  return asHolder(token, 'route=requests', { method: 'POST', body: { kind: payload.kind, payload, mediaIds }, ...opts });
}
async function asked(token: string, payload: RequestPayload = editPayload(), mediaIds: string[] = []): Promise<CoproducerRequestView> {
  const res = await ask(token, payload, mediaIds);
  expect(res.status).toBe(201);
  return ((await res.json()) as { request: CoproducerRequestView }).request;
}
function stage(token: string, id: string, data = PNG, seq = 0, total = 1, opts: Call = {}) {
  return asHolder(token, 'route=stage', { method: 'PUT', body: { id, seq, total, data }, ...opts });
}
const mediaId = (n: number) => `abcdef12-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** A request row put straight into the table, for tests about many of them. */
async function insertRequest(linkId: string, over: { id?: string; status?: string; kind?: string; bytes?: number; createdAt?: number; decidedAt?: number | null; user?: string } = {}) {
  const id = over.id ?? crypto.randomUUID();
  await run(
    `INSERT INTO coproducer_requests (id, user_id, link_id, kind, status, payload, outline, created_at, decided_at, bytes) VALUES (?, ?, ?, ?, ?, 'payload-cipher', 'outline-cipher', ?, ?, ?)`,
    id, over.user ?? 'producer', linkId, over.kind ?? 'edit', over.status ?? 'pending', over.createdAt ?? now(), over.decidedAt ?? null, over.bytes ?? 10,
  );
  return id;
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'showrunner-coproducer-'));
  connection.db = createClient({ url: `file:${join(dir, 'test.db')}` });
  await applySchema(connection.db);
  await run("INSERT INTO users (id, password_hash) VALUES ('producer', 'hash'), ('neighbour', 'hash')");
  vi.stubEnv('APP_URL', main);
  vi.stubEnv('COPRODUCE_ORIGIN', '');
  locked.clear();
});
afterEach(() => {
  connection.db?.close();
  rmSync(dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

describe('making a link (owner)', () => {
  it('needs consent, a name and the account’s keys', async () => {
    const good = { label: 'Sam Rivera', key: KEY, legacyKey: LEGACY, consent: true };
    for (const body of [
      { ...good, consent: undefined },
      { ...good, consent: 'yes' },
      { ...good, label: '' },
      { ...good, label: '   ' },
      { ...good, label: 'x'.repeat(61) },
      { ...good, label: 'Sam\u0007' },
      { ...good, label: 'Sam‮' },
      { ...good, key: 'raw-password' },
      { ...good, legacyKey: undefined },
      { ...good, extra: true },
    ]) {
      const res = await asOwner('route=links', { method: 'POST', body });
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect((await asOwner('route=links', { method: 'POST', raw: '{nope' })).status).toBe(400);
    expect(await count('SELECT COUNT(*) FROM coproducer_links')).toBe(0);
  });

  it('is the owner’s alone: signed in, from the app’s own origin', async () => {
    const body = { label: 'Sam', key: KEY, legacyKey: LEGACY, consent: true };
    expect((await call('route=links', { method: 'POST', body })).status).toBe(401);
    expect(await error(await asOwner('route=links', { method: 'POST', body, origin: 'https://evil.test' }))).toBe('invalid_origin');
    expect(await error(await asOwner('route=links', { method: 'POST', body, origin: review }))).toBe('invalid_origin');
    expect((await asOwner('route=links', { method: 'POST', body, origin: main })).status).toBe(201);
    // A co-producer's token opens no owner route.
    const { token } = await makeLink();
    for (const route of ['links', 'inbox&count=1', 'handouts']) {
      expect((await call(`route=${route}`, { token })).status, route).toBe(401);
    }
  });

  it('is refused on the review origin even with no APP_URL to name the main one', async () => {
    vi.stubEnv('APP_URL', '');
    const body = { label: 'Sam', key: KEY, legacyKey: LEGACY, consent: true };
    // The same deployment answers on both addresses; this request arrives on the review one.
    const res = await coproducer(new Request(`${review}/api/coproducer?route=links`, {
      method: 'POST',
      headers: { 'x-user-id': 'producer', 'content-type': 'application/json', origin: review },
      body: JSON.stringify(body),
    }));
    expect(res.status).toBe(403);
    expect(await error(res)).toBe('invalid_origin');
    expect(await count('SELECT COUNT(*) FROM coproducer_links')).toBe(0);
    expect((await asOwner('route=links', { method: 'POST', body, origin: main })).status).toBe(201);
    const { token } = await makeLink();
    expect(await error(await call('route=session', { token, origin: main }))).toBe('invalid_origin');
    expect((await call('route=session', { token, origin: review })).status).toBe(200);
  });

  it('fails closed where there is no review origin', async () => {
    vi.stubEnv('APP_URL', 'https://example.test');
    const res = await asOwner('route=links', { method: 'POST', body: { label: 'Sam', key: KEY, legacyKey: LEGACY, consent: true } });
    expect(res.status).toBe(503);
    expect(await error(res)).toBe('coproduce_not_configured');
    // A local address is for development and tests, and an override names one.
    vi.stubEnv('APP_URL', 'http://localhost:4173');
    expect((await asOwner('route=links', { method: 'POST', body: { label: 'Sam', key: KEY, legacyKey: LEGACY, consent: true } })).status).toBe(201);
    vi.stubEnv('APP_URL', 'https://example.test');
    vi.stubEnv('COPRODUCE_ORIGIN', 'https://review.example.test');
    expect((await asOwner('route=links', { method: 'POST', body: { label: 'Sam', key: KEY, legacyKey: LEGACY, consent: true } })).status).toBe(201);
    vi.stubEnv('COPRODUCE_ORIGIN', 'javascript:alert(1)');
    expect(await error(await asOwner('route=links', { method: 'POST', body: { label: 'Sam', key: KEY, legacyKey: LEGACY, consent: true } }))).toBe('server_not_configured');
  });

  it('hands the token out once and keeps nothing that opens the keys', async () => {
    const { token, link } = await makeLink('producer', '  Sam Rivera  ');
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(link).toMatchObject({ openRequests: 0, storageBytes: 0, handouts: 0, firstUsedAt: null, lastUsedAt: null });
    expect(Date.parse(link.expiresAt) - Date.parse(link.createdAt)).toBe(30 * DAY * 1000);
    const tables = (await rows(`SELECT name FROM sqlite_master WHERE type = 'table'`)).map((row) => String(row[0]));
    for (const table of tables) {
      expect(JSON.stringify((await run(`SELECT * FROM ${table}`)).rows), table).not.toContain(token);
      expect(JSON.stringify((await run(`SELECT * FROM ${table}`)).rows), table).not.toContain(KEY);
    }
    const [[hash, sealed, label]] = await rows('SELECT token_hash, sealed_keys, label_cipher FROM coproducer_links WHERE id = ?', link.id);
    expect(hash).toBe(await cipherHash(token));
    expect(String(sealed).startsWith('v1.')).toBe(true);
    expect(await unsealKeys(String(sealed), token, COPRODUCER_SEAL_INFO, 'v1', sealBinding(link.id, 'producer'))).toEqual({ key: KEY, legacyKey: LEGACY });
    expect(decryptWithKey(String(label), KEY)).toBe('Sam Rivera');
    expect(link.labelCipher).toBe(label);
  });

  it('allows 20 active links an account', async () => {
    for (let i = 0; i < 20; i++) {
      await run(`INSERT INTO coproducer_links (id, user_id, token_hash, sealed_keys, label_cipher, created_at, expires_at) VALUES (?, 'producer', ?, 'v1.x.y', 'c', 0, ?)`, `held-${i}`, `hash-${i}`, now() + DAY);
    }
    const res = await asOwner('route=links', { method: 'POST', body: { label: 'Sam', key: KEY, legacyKey: LEGACY, consent: true } });
    expect(res.status).toBe(409);
    expect(await error(res)).toBe('too_many_links');
    // An ended link takes no place.
    await run(`UPDATE coproducer_links SET expires_at = ? WHERE id = 'held-0'`, now() - 1);
    expect((await asOwner('route=links', { method: 'POST', body: { label: 'Sam', key: KEY, legacyKey: LEGACY, consent: true } })).status).toBe(201);
  });

  it('allows 20 made an hour', async () => {
    for (let i = 0; i < 20; i++) {
      const { link } = await makeLink();
      expect((await asOwner(`route=links&id=${link.id}`, { method: 'DELETE' })).status).toBe(200);
    }
    expect((await asOwner('route=links', { method: 'POST', body: { label: 'Sam', key: KEY, legacyKey: LEGACY, consent: true } })).status).toBe(429);
  });

  it('lists the owner’s active links, newest first, with what each holds', async () => {
    const first = await makeLink('producer', 'First');
    const second = await makeLink('producer', 'Second');
    await makeLink('neighbour', 'Theirs');
    await run('UPDATE coproducer_links SET created_at = created_at - 10 WHERE id = ?', first.link.id);
    await saveShow(simpleShow());
    await asked(second.token);
    expect((await stage(second.token, mediaId(1))).status).toBe(200);
    await run(`INSERT INTO coproducer_handouts (id, user_id, link_id, label_cipher, refs_cipher, created_at) VALUES ('h1', 'producer', ?, 'c', 'r', 0)`, second.link.id);
    const listed = ((await (await asOwner('route=links')).json()) as { links: CoproducerLinkInfo[] }).links;
    expect(listed.map((link) => link.id)).toEqual([second.link.id, first.link.id]);
    const open = await count('SELECT bytes FROM coproducer_requests');
    const staged = await count('SELECT bytes FROM coproducer_media');
    expect(listed[0]).toMatchObject({ openRequests: 1, storageBytes: open + staged, handouts: 1 });
    expect(listed[1]).toMatchObject({ openRequests: 0, storageBytes: 0, handouts: 0 });
  });
});

describe('a co-producer’s token', () => {
  it('opens nothing when missing, malformed or unknown, and each counts as a failure', async () => {
    for (const authorization of [undefined, 'Bearer short', `Basic ${'A'.repeat(43)}`, `Bearer ${'A'.repeat(43)}`]) {
      const res = await coproducer(new Request(`${review}/api/coproducer?route=session`, {
        headers: { 'x-forwarded-for': '198.51.100.1', ...(authorization ? { authorization } : {}) },
      }));
      expect(res.status, authorization).toBe(410);
      expect(await error(res)).toBe('link_ended');
    }
    expect(await count(`SELECT count FROM rate_limit WHERE bucket = 'coprod:fail:198.51.100.1'`)).toBe(4);
  });

  it('is refused unread after 30 failures from an address, while a real link there still works', async () => {
    const { token } = await makeLink();
    for (let i = 0; i < 30; i++) expect((await call('route=session', { token: randomBytes(32).toString('base64url') })).status).toBe(410);
    const refused = await call('route=session', { token: randomBytes(32).toString('base64url') });
    expect(refused.status).toBe(429);
    expect((await call('route=session', { token })).status).toBe(200);
    // Another address is not held back by them.
    expect((await call('route=session', { token: randomBytes(32).toString('base64url'), ip: '192.0.2.9' })).status).toBe(410);
  });

  it('ends with the link: expired, withdrawn, or its owner gone', async () => {
    const expired = await makeLink();
    await run('UPDATE coproducer_links SET expires_at = ? WHERE id = ?', now() - 1, expired.link.id);
    expect(await error(await call('route=session', { token: expired.token }))).toBe('link_ended');

    const withdrawn = await makeLink();
    expect((await asOwner(`route=links&id=${withdrawn.link.id}`, { method: 'DELETE' })).status).toBe(200);
    expect(await error(await call('route=session', { token: withdrawn.token }))).toBe('link_ended');

    const theirs = await makeLink('neighbour');
    await run(`DELETE FROM users WHERE id = 'neighbour'`);
    expect(await error(await call('route=session', { token: theirs.token }))).toBe('link_ended');
  });

  it('is the only credential the co-producer routes read', async () => {
    await makeLink();
    const res = await coproducer(new Request(`${review}/api/coproducer?route=session`, { headers: { 'x-user-id': 'producer', 'x-auth': 'whatever' } }));
    expect(res.status).toBe(410);
  });

  it('works only from the review origin', async () => {
    const { token } = await makeLink();
    expect(await error(await call('route=session', { token, origin: main }))).toBe('invalid_origin');
    expect(await error(await call('route=session', { token, origin: 'https://evil.test' }))).toBe('invalid_origin');
    expect((await call('route=session', { token, origin: review })).status).toBe(200);
    vi.stubEnv('COPRODUCE_ORIGIN', 'https://review.example.test');
    expect(await error(await call('route=session', { token, origin: review }))).toBe('invalid_origin');
    expect((await call('route=session', { token, origin: 'https://review.example.test' })).status).toBe(200);
  });

  it('records when it was first opened, once, and when last used, at most once a minute', async () => {
    const { token, link } = await makeLink();
    expect((await call('route=session', { token })).status).toBe(200);
    const [[first, last]] = await rows('SELECT first_used_at, last_used_at FROM coproducer_links WHERE id = ?', link.id);
    expect(first).not.toBeNull();
    await run('UPDATE coproducer_links SET first_used_at = 5, last_used_at = ? WHERE id = ?', Number(last) - 30, link.id);
    await call('route=session', { token });
    expect(await rows('SELECT first_used_at, last_used_at FROM coproducer_links WHERE id = ?', link.id)).toEqual([[5, Number(last) - 30]]);
    await run('UPDATE coproducer_links SET last_used_at = ? WHERE id = ?', now() - 120, link.id);
    await call('route=revisions', { token });
    expect(Number((await rows('SELECT last_used_at FROM coproducer_links WHERE id = ?', link.id))[0][0])).toBeGreaterThanOrEqual(now() - 1);
  });

  it('answers unknown routes and wrong methods without opening anything', async () => {
    expect((await call('route=nope')).status).toBe(404);
    expect((await call('route=__proto__')).status).toBe(404);
    expect((await call('route=session', { method: 'POST' })).status).toBe(405);
    expect((await call('route=links', { method: 'PUT', user: 'producer' })).status).toBe(405);
  });
});

describe('what a co-producer reads', () => {
  it('names the link and the owner’s plan', async () => {
    const { token, link } = await makeLink('producer', 'Sam Rivera');
    const res = await call('route=session', { token });
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await res.json()).toEqual({ link: { id: link.id, label: 'Sam Rivera', expiresAt: link.expiresAt }, producerLocked: false });
    locked.add('producer');
    expect(((await (await call('route=session', { token })).json()) as { producerLocked: boolean }).producerLocked).toBe(true);
  });

  it('decrypts shows under the current key and the legacy one, and counts what does not open', async () => {
    const { token } = await makeLink();
    await saveShow(simpleShow('show-a'));
    await saveShow(simpleShow('show-b'), 'producer', LEGACY);
    await saveShow(simpleShow('show-c'), 'producer', NEIGHBOUR_KEY);
    await run(`INSERT INTO user_shows (id, user_id, encrypted_data) VALUES ('show-d', 'producer', ?)`, encryptWithKey(simpleShow('another-id'), KEY));
    await saveShow(simpleShow('show-z'), 'neighbour', NEIGHBOUR_KEY);
    const page = await (await call('route=shows', { token })).json() as { shows: { show: Show; revision: string }[]; next: string | null; unreadable: number };
    expect(page.shows.map((entry) => entry.show.id)).toEqual(['show-a', 'show-b']);
    expect(page.unreadable).toBe(2);
    expect(page.next).toBeNull();
  });

  it('pages by 50 rows, or by size, always at least one, and fetches named shows', async () => {
    const { token } = await makeLink();
    for (let i = 0; i < 51; i++) await saveShow(simpleShow(`show-${String(i).padStart(2, '0')}`));
    const first = await (await call('route=shows', { token })).json() as { shows: { show: Show }[]; next: string | null };
    expect(first.shows).toHaveLength(50);
    expect(first.next).toBe('show-49');
    const second = await (await call('route=shows&after=show-49', { token })).json() as { shows: { show: Show }[]; next: string | null };
    expect(second.shows.map((entry) => entry.show.id)).toEqual(['show-50']);
    expect(second.next).toBeNull();

    const named = await (await call('route=shows&ids=show-03,show-07,missing', { token })).json() as { shows: { show: Show }[]; next: string | null };
    expect(named.shows.map((entry) => entry.show.id)).toEqual(['show-03', 'show-07']);
    expect(named.next).toBeNull();
    const tooMany = Array.from({ length: 51 }, (_, i) => `show-${i}`).join(',');
    expect((await call(`route=shows&ids=${tooMany}`, { token })).status).toBe(400);
  });

  it('stops a page at 8,000,000 characters of ciphertext', async () => {
    const { token } = await makeLink();
    await run(`DELETE FROM user_shows`);
    const big = 'A'.repeat(3_000_000);
    for (const id of ['big-1', 'big-2', 'big-3']) await run(`INSERT INTO user_shows (id, user_id, encrypted_data) VALUES (?, 'producer', ?)`, id, big);
    const first = await (await call('route=shows', { token })).json() as { shows: unknown[]; next: string | null; unreadable: number };
    expect(first).toMatchObject({ shows: [], next: 'big-2', unreadable: 2 });
    const second = await (await call('route=shows&after=big-2', { token })).json() as { next: string | null; unreadable: number };
    expect(second).toMatchObject({ next: null, unreadable: 1 });
    await run(`UPDATE user_shows SET encrypted_data = ? WHERE id = 'big-1'`, 'A'.repeat(9_000_000));
    const huge = await (await call('route=shows', { token })).json() as { next: string | null; unreadable: number };
    expect(huge).toMatchObject({ next: 'big-1', unreadable: 1 });
  });

  it('gives each show a revision that moves with every save, the same in the page and the revisions', async () => {
    const { token } = await makeLink();
    await saveShow(simpleShow());
    await saveSettings(fullSettings());
    const page = await (await call('route=shows', { token })).json() as { shows: { revision: string }[] };
    const revisions = await (await call('route=revisions', { token })).json() as { shows: { id: string; revision: string }[]; settings: string };
    expect(revisions.shows).toEqual([{ id: 'show1', revision: page.shows[0].revision }]);
    expect(page.shows[0].revision).toMatch(/^[0-9a-f]{64}$/);
    const settings = await (await call('route=settings', { token })).json() as { revision: string };
    expect(revisions.settings).toBe(settings.revision);
    await saveShow(simpleShow());
    const after = await (await call('route=revisions', { token })).json() as { shows: { revision: string }[] };
    expect(after.shows[0].revision).not.toBe(page.shows[0].revision);
  });

  it('serves no settings for an account that never saved any, and refuses settings that do not open', async () => {
    const { token } = await makeLink();
    expect(await (await call('route=settings', { token })).json()).toEqual({ settings: null, revision: null });
    expect((await (await call('route=revisions', { token })).json() as { settings: unknown }).settings).toBeNull();
    await saveSettings(fullSettings(), 'producer', NEIGHBOUR_KEY);
    expect(await error(await call('route=settings', { token }))).toBe('link_unreadable');
  });

  it('never serves a link’s token or key, a viewer audio key or the account key', async () => {
    const { token } = await makeLink();
    await saveShow(fullShow({ id: 'show1' }));
    await saveSettings(fullSettings());
    await asked(token);
    const texts: string[] = [];
    for (const query of ['route=session', 'route=shows', 'route=shows&ids=show1', 'route=revisions', 'route=settings', 'route=requests']) {
      const res = await call(query, { token });
      expect(res.status, query).toBe(200);
      texts.push(await res.text());
    }
    const all = texts.join('\n');
    for (const secret of [...Object.values(FIXTURE_SECRETS), KEY, LEGACY, token]) expect(all).not.toContain(secret);
    expect(all).toContain(await pseudonym(FIXTURE_SECRETS.viewToken));
    expect(all).toContain(await pseudonym(FIXTURE_SECRETS.signToken));
  });
});

describe('files a co-producer reads', () => {
  it('serves the owner’s slices as plaintext, and nobody else’s', async () => {
    const { token } = await makeLink();
    await saveMedia(mediaId(1), ['data:image/png;base64,AAAA', 'BBBB']);
    await saveMedia(mediaId(2), ['data:image/png;base64,CCCC'], 'neighbour', NEIGHBOUR_KEY);
    expect(await (await call(`route=media&id=${mediaId(1)}&seq=0`, { token })).json()).toEqual({ data: 'data:image/png;base64,AAAA', total: 2 });
    expect(await (await call(`route=media&id=${mediaId(1)}&seq=1`, { token })).json()).toEqual({ data: 'BBBB', total: 2 });
    expect((await call(`route=media&id=${mediaId(1)}&seq=2`, { token })).status).toBe(404);
    expect((await call(`route=media&id=${mediaId(2)}&seq=0`, { token })).status).toBe(404);
    expect((await call(`route=media&id=short&seq=0`, { token })).status).toBe(400);
    expect((await call(`route=media&id=${mediaId(1)}&seq=-1`, { token })).status).toBe(400);
  });

  it('serves a file staged by this link to this link only', async () => {
    const mine = await makeLink();
    const other = await makeLink();
    expect((await stage(mine.token, mediaId(3))).status).toBe(200);
    expect(await (await call(`route=media&id=${mediaId(3)}&seq=0`, { token: mine.token })).json()).toEqual({ data: PNG, total: 1 });
    expect((await call(`route=media&id=${mediaId(3)}&seq=0`, { token: other.token })).status).toBe(404);
  });

  it('serves a details link’s headshot by the row id it can see, decrypted with that link’s key', async () => {
    const { token } = await makeLink();
    const settings = fullSettings();
    await saveSettings(settings);
    await run(`INSERT INTO sign_request (token, user_id, payload) VALUES (?, 'producer', 'x')`, FIXTURE_SECRETS.profileToken);
    await run(`INSERT INTO profile_photo (token, seq, total, data, user_id, bytes) VALUES (?, 0, 1, ?, 'producer', 1)`, FIXTURE_SECRETS.profileToken, encryptWithKey(PNG, FIXTURE_SECRETS.profileKey));
    const id = settings.profileRequests![0].id;
    expect(await (await call(`route=profile-photo&request=${id}&seq=0`, { token })).json()).toEqual({ data: PNG, total: 1 });
    expect((await call(`route=profile-photo&request=${id}&seq=1`, { token })).status).toBe(404);
    expect((await call(`route=profile-photo&request=${FIXTURE_SECRETS.profileToken}&seq=0`, { token })).status).toBe(404);
    expect((await call(`route=profile-photo&request=nobody&seq=0`, { token })).status).toBe(404);
    // A token another account owns is not read through this one's settings.
    await run(`UPDATE sign_request SET user_id = 'neighbour'`);
    expect((await call(`route=profile-photo&request=${id}&seq=0`, { token })).status).toBe(404);
  });
});

describe('staging a file (co-producer)', () => {
  it('takes only a kind of file the app takes, by its bytes', async () => {
    const { token } = await makeLink();
    for (const data of [SVG, HTML, PNG_AS_AUDIO, 'data:image/png;base64,', 'not a data url']) {
      const res = await stage(token, mediaId(1), data);
      expect(res.status, data.slice(0, 30)).toBe(400);
      expect(await error(res)).toBe('unsupported_media');
    }
    const mp3 = `data:audio/mpeg;base64,${btoa('ID3\u0004\u0000\u0000\u0000\u0000\u0000#TSSE')}`;
    expect((await stage(token, mediaId(2), mp3)).status).toBe(200);
    // Only the first slice carries the header.
    expect((await stage(token, mediaId(3), PNG, 0, 2)).status).toBe(200);
    expect((await stage(token, mediaId(3), 'QUJD', 1, 2)).status).toBe(200);
  });

  it('holds chunks to their limits', async () => {
    const { token } = await makeLink();
    expect((await stage(token, mediaId(1), PNG, 0, 65)).status).toBe(400);
    expect((await stage(token, mediaId(1), PNG, 1, 1)).status).toBe(400);
    expect((await stage(token, 'bad id!', PNG)).status).toBe(400);
    const res = await stage(token, mediaId(1), `${PNG}${'A'.repeat(1_600_000)}`);
    expect(res.status).toBe(413);
    expect(await error(res)).toBe('payload_too_large');
  });

  it('stores each chunk encrypted under the account key, as user_media holds it', async () => {
    const { token, link } = await makeLink();
    expect((await stage(token, mediaId(1))).status).toBe(200);
    const [[data, bytes, linkId, requestId]] = await rows('SELECT data, bytes, link_id, request_id FROM coproducer_media');
    expect(decryptWithKey(String(data), KEY)).toBe(PNG);
    expect(bytes).toBe(String(data).length);
    expect([linkId, requestId]).toEqual([link.id, null]);
    expect(String(data)).not.toContain('iVBOR');
  });

  it('refuses an id the owner or another link already uses', async () => {
    const { token } = await makeLink();
    const other = await makeLink();
    await saveMedia(mediaId(1), ['data:image/png;base64,AAAA']);
    expect(await error(await stage(token, mediaId(1)))).toBe('id_taken');
    expect((await stage(other.token, mediaId(2))).status).toBe(200);
    expect(await error(await stage(token, mediaId(2)))).toBe('id_taken');
  });

  it('allows 20 files waiting for a request', async () => {
    const { token } = await makeLink();
    for (let i = 0; i < 20; i++) expect((await stage(token, mediaId(i), PNG, 0, 1, { ip: `192.0.2.${i}` })).status).toBe(200);
    const res = await stage(token, mediaId(99));
    expect(res.status).toBe(409);
    expect(await error(res)).toBe('too_many_staged_files');
    // A file already started is not a new one.
    expect((await stage(token, mediaId(3))).status).toBe(200);
  });

  it('holds a link to 200,000,000 staged characters and an account to 1,000,000,000', async () => {
    const { token, link } = await makeLink();
    const fresh = await makeLink();
    await run(`INSERT INTO coproducer_media (user_id, link_id, id, seq, total, data, bytes, request_id, created_at) VALUES ('producer', ?, 'held-link', 0, 1, 'x', 199999950, 'some-request', ?)`, link.id, now());
    let res = await stage(token, mediaId(1));
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: 'coproducer_storage_full', reason: 'link_full' });
    // Under the link's own limit, but not the account's.
    expect((await stage(fresh.token, mediaId(2))).status).toBe(200);
    await run(`UPDATE coproducer_media SET bytes = 999999950 WHERE id = 'held-link'`);
    res = await stage(fresh.token, mediaId(3));
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: 'coproducer_storage_full', reason: 'account_full' });
  });

  it('sweeps the link’s own day-old files at the first chunk of every file', async () => {
    const { token, link } = await makeLink();
    await run(`INSERT INTO coproducer_media (user_id, link_id, id, seq, total, data, bytes, created_at) VALUES ('producer', ?, 'old-file-1', 0, 1, 'x', 1, ?)`, link.id, now() - DAY - 10);
    await run(`INSERT INTO coproducer_media (user_id, link_id, id, seq, total, data, bytes, created_at) VALUES ('producer', ?, 'young-file', 0, 1, 'x', 1, ?)`, link.id, now() - 60);
    expect((await stage(token, mediaId(1))).status).toBe(200);
    expect((await rows('SELECT id FROM coproducer_media ORDER BY id')).map((row) => row[0])).toEqual([mediaId(1), 'young-file']);
  });

  it('never takes the owner’s link allowance: contracts and signatures still land', async () => {
    const { token, link } = await makeLink();
    await run(`INSERT INTO coproducer_media (user_id, link_id, id, seq, total, data, bytes, request_id, created_at) VALUES ('producer', ?, 'held', 0, 1, 'x', 999999999, 'r', ?)`, link.id, now());
    expect(await error(await stage(token, mediaId(1)))).toBe('coproducer_storage_full');
    expect(await hasLinkRoom(connection.db!, 'producer', { table: 'sign_doc', token: 'contract-link-token-0001', seq: 0, total: 1, bytes: 1000 })).toBe(true);
    const put = (route: (req: Request) => Promise<Response>, path: string, method: string, body: unknown, user?: string) =>
      route(new Request(`${main}${path}`, { method, headers: { 'content-type': 'application/json', ...(user ? { 'x-user-id': user } : {}) }, body: JSON.stringify(body) }));
    expect((await put(signDoc, '/api/sign-doc', 'PUT', { token: 'contract-link-token-0001', seq: 0, total: 1, data: 'pdf' }, 'producer')).status).toBe(200);
    expect((await put(sign, '/api/sign', 'PUT', { token: 'contract-link-token-0001', payload: 'terms' }, 'producer')).status).toBe(200);
    expect((await put(sign, '/api/sign', 'POST', { token: 'contract-link-token-0001', signature: 'agreed' })).status).toBe(200);
  });

  it('limits uploads per link across addresses', async () => {
    const { token, link } = await makeLink();
    await run(`INSERT INTO rate_limit (bucket, count) VALUES (?, 600)`, `coprod:stage:${link.id}:all`);
    expect((await stage(token, mediaId(1), PNG, 0, 1, { ip: '192.0.2.200' })).status).toBe(429);
  });
});

describe('asking (co-producer)', () => {
  it('refuses anything that reaches a prototype, nests too deep or breaks the schema', async () => {
    const { token } = await makeLink();
    const forbidden = `{"kind":"edit","payload":{"kind":"edit","shows":[],"settings":{"fields":[{"__proto__":{"x":1}}]}},"mediaIds":[]}`;
    expect(await error(await asHolder(token, 'route=requests', { method: 'POST', raw: forbidden }))).toBe('bad_request');
    let deep: unknown = 'x';
    for (let i = 0; i < 17; i++) deep = { deep };
    expect(await error(await ask(token, { ...editPayload(), extra: deep } as unknown as RequestPayload))).toBe('bad_request');
    const wrong = await ask(token, { ...editPayload(), shows: [{ ...editPayload().shows[0], keys: ['viewToken'] }] } as unknown as RequestPayload);
    expect(wrong.status).toBe(400);
    const body = await wrong.json() as { problems: unknown[] };
    expect(body.problems.length).toBeGreaterThan(0);
    expect(body.problems.length).toBeLessThanOrEqual(20);
    expect((await asHolder(token, 'route=requests', { method: 'POST', body: { kind: 'share', payload: editPayload(), mediaIds: [] } })).status).toBe(400);
    expect(await count('SELECT COUNT(*) FROM coproducer_requests')).toBe(0);
  });

  it('stores the payload and its outline encrypted under the account key', async () => {
    const { token } = await makeLink();
    const payload = editPayload();
    const view = await asked(token, payload);
    expect(view).toMatchObject({ kind: 'edit', status: 'pending', decidedAt: null, usedAt: null, result: null, outline: buildOutline(payload) });
    const [[stored, outline, bytes, status]] = await rows('SELECT payload, outline, bytes, status FROM coproducer_requests WHERE id = ?', view.id);
    expect(decryptWithKey(String(stored), KEY)).toEqual(payload);
    expect(decryptWithKey(String(outline), KEY)).toEqual(buildOutline(payload));
    expect(bytes).toBe(String(stored).length + String(outline).length);
    expect(status).toBe('pending');
    expect(String(stored)).not.toContain('The Cellar');
  });

  it('allows 200 waiting requests a link', async () => {
    const { token, link } = await makeLink();
    for (let i = 0; i < 200; i++) await insertRequest(link.id);
    const res = await ask(token);
    expect(res.status).toBe(409);
    expect(await error(res)).toBe('too_many_open_requests');
  });

  it('holds a request to 2,000,000 characters and a link’s waiting requests to 50,000,000', async () => {
    const { token, link } = await makeLink();
    const big = editPayload('x'.repeat(2_000_001));
    expect(await error(await ask(token, big))).toBe('payload_too_large');
    await insertRequest(link.id, { bytes: 49_999_999 });
    const res = await ask(token);
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: 'coproducer_storage_full', reason: 'link_full' });
  });

  it('checks files both ways', async () => {
    const { token } = await makeLink();
    const other = await makeLink();
    await saveMedia(mediaId(10), ['data:image/png;base64,AAAA']);
    expect((await stage(token, mediaId(1))).status).toBe(200);
    expect((await stage(other.token, mediaId(2))).status).toBe(200);

    // Carried but not used.
    expect(await error(await ask(token, editPayload(), [mediaId(1)]))).toBe('unknown_media');
    // Used but nowhere.
    expect(await error(await ask(token, flyerPayload(`media:${mediaId(5)}#1`)))).toBe('unknown_media');
    // Used and staged, but not said to be carried.
    expect(await error(await ask(token, flyerPayload(`media:${mediaId(1)}#1`)))).toBe('unknown_media');
    // Staged by another link.
    expect(await error(await ask(token, flyerPayload(`media:${mediaId(2)}#1`), [mediaId(2)]))).toBe('unknown_media');
    // Already the owner's.
    expect((await ask(token, flyerPayload(`media:${mediaId(10)}#1`))).status).toBe(201);
    // Staged by this link and carried: attached to the request.
    const carried = await asked(token, flyerPayload(`media:${mediaId(1)}#1`), [mediaId(1)]);
    expect(await rows('SELECT request_id FROM coproducer_media WHERE id = ?', mediaId(1))).toEqual([[carried.id]]);
    const [[mediaIds]] = await rows('SELECT media_ids FROM coproducer_requests WHERE id = ?', carried.id);
    expect(JSON.parse(String(mediaIds))).toEqual([mediaId(1)]);
    // Carried by another request already.
    const again = await ask(token, flyerPayload(`media:${mediaId(1)}#1`), [mediaId(1)]);
    expect(again.status).toBe(409);
    expect(await error(again)).toBe('media_in_use');
    expect(await error(await ask(token, flyerPayload(`media:${mediaId(1)}#1`)))).toBe('media_in_use');
    // And it cannot be staged over.
    expect(await error(await stage(token, mediaId(1)))).toBe('media_in_use');
  });

  it('lists this link’s recent requests without their payloads, and opens one of its own', async () => {
    const { token, link } = await makeLink();
    const other = await makeLink();
    const theirs = await makeLink('neighbour');
    const edit = await asked(token);
    const share = await asked(token, sharePayload);
    const elsewhere = await asked(other.token);
    await insertRequest(link.id, { status: 'withdrawn', decidedAt: now() });
    await run(`UPDATE coproducer_requests SET created_at = created_at - 5 WHERE id = ?`, edit.id);
    const list = await (await call('route=requests', { token })).json() as { requests: CoproducerRequestView[] };
    expect(list.requests.map((request) => request.id)).toEqual([share.id, edit.id]);
    expect(JSON.stringify(list)).not.toContain('payload');
    expect(list.requests[1].outline).toEqual(buildOutline(editPayload()));

    const detail = await (await call(`route=requests&id=${edit.id}`, { token })).json() as { request: { payload: unknown } };
    expect(detail.request.payload).toEqual(editPayload());
    expect((await call(`route=requests&id=${elsewhere.id}`, { token })).status).toBe(404);
    const neighbourRequest = await insertRequest('x', { user: 'neighbour' });
    expect((await call(`route=requests&id=${neighbourRequest}`, { token })).status).toBe(404);
    expect((await call(`route=requests&id=${edit.id}`, { token: theirs.token })).status).toBe(404);
  });

  it('withdraws its own waiting request, with the files it carried', async () => {
    const { token } = await makeLink();
    const other = await makeLink();
    await saveShow(simpleShow());
    expect((await stage(token, mediaId(1))).status).toBe(200);
    const request = await asked(token, flyerPayload(`media:${mediaId(1)}#1`), [mediaId(1)]);
    expect((await call(`route=requests&id=${request.id}`, { token: other.token, method: 'DELETE' })).status).toBe(404);
    expect((await call(`route=requests&id=${request.id}`, { token, method: 'DELETE' })).status).toBe(200);
    expect(await rows('SELECT status FROM coproducer_requests WHERE id = ?', request.id)).toEqual([['withdrawn']]);
    expect(await count('SELECT COUNT(*) FROM coproducer_media')).toBe(0);
    expect(await error(await call(`route=requests&id=${request.id}`, { token, method: 'DELETE' }))).toBe('already_decided');
    expect((await call(`route=requests`, { token, method: 'DELETE' })).status).toBe(400);
  });

  it('records the use of an approved share or download of its own, once', async () => {
    const { token } = await makeLink();
    const other = await makeLink();
    const share = await asked(token, sharePayload);
    const download = await asked(token, downloadPayload);
    const edit = await asked(token);
    expect(await error(await call('route=use', { token, method: 'POST', body: { id: share.id } }))).toBe('not_approved');
    for (const id of [share.id, download.id, edit.id]) await asOwner('route=decide', { method: 'POST', body: { id, decision: 'approved' } });
    expect((await call('route=use', { token: other.token, method: 'POST', body: { id: share.id } })).status).toBe(404);
    expect(await error(await call('route=use', { token, method: 'POST', body: { id: edit.id } }))).toBe('not_approved');
    expect((await call('route=use', { token, method: 'POST', body: { id: download.id } })).status).toBe(200);
    const [[used]] = await rows('SELECT used_at FROM coproducer_requests WHERE id = ?', download.id);
    await run('UPDATE coproducer_requests SET used_at = 7 WHERE id = ?', download.id);
    expect((await call('route=use', { token, method: 'POST', body: { id: download.id } })).status).toBe(200);
    expect(await rows('SELECT used_at FROM coproducer_requests WHERE id = ?', download.id)).toEqual([[7]]);
    expect(used).not.toBeNull();
  });
});

describe('the owner’s inbox', () => {
  it('counts what is waiting across active links', async () => {
    const { token, link } = await makeLink();
    await makeLink();
    await asked(token);
    await asked(token, sharePayload);
    await insertRequest(link.id, { status: 'approved', decidedAt: now() });
    const expired = await makeLink();
    await insertRequest(expired.link.id);
    await run('UPDATE coproducer_links SET expires_at = ? WHERE id = ?', now() - 1, expired.link.id);
    await insertRequest('theirs', { user: 'neighbour' });
    expect(await (await asOwner('route=inbox&count=1')).json()).toEqual({ open: 2, links: 2 });
  });

  it('lists outlines, never payloads, oldest first, a page at a time', async () => {
    const { link } = await makeLink();
    const start = now() - 1000;
    for (let i = 0; i < 101; i++) await insertRequest(link.id, { id: `req-${String(i).padStart(3, '0')}`, createdAt: start + i, status: i % 2 ? 'stale' : 'pending' });
    await insertRequest(link.id, { id: 'done', status: 'rejected', decidedAt: now() });
    const first = await (await asOwner('route=inbox&status=open')).json() as { requests: OwnerRequestRow[]; next: string };
    expect(first.requests).toHaveLength(100);
    expect(first.requests[0]).toEqual({ id: 'req-000', linkId: link.id, kind: 'edit', status: 'pending', createdAt: new Date(start * 1000).toISOString(), decidedAt: null, usedAt: null, outline: 'outline-cipher', mediaIds: [], bytes: 10 });
    expect(JSON.stringify(first)).not.toContain('payload');
    expect(first.next).toBe(`${start + 99}:req-099`);
    const second = await (await asOwner(`route=inbox&status=open&after=${encodeURIComponent(first.next)}`)).json() as { requests: OwnerRequestRow[]; next: string | null };
    expect(second.requests.map((row) => row.id)).toEqual(['req-100']);
    expect(second.next).toBeNull();
    const recent = await (await asOwner('route=inbox&status=recent')).json() as { requests: OwnerRequestRow[] };
    expect(recent.requests.map((row) => row.id)).toEqual(['done']);
    expect((await asOwner('route=inbox&status=everything')).status).toBe(400);
    expect((await asOwner('route=inbox&status=open&after=nonsense')).status).toBe(400);
  });

  it('opens one request, the owner’s own', async () => {
    const { token } = await makeLink();
    const request = await asked(token);
    const detail = await (await asOwner(`route=inbox&id=${request.id}`)).json() as { request: { payload: string; result: null } };
    expect(decryptWithKey(detail.request.payload, KEY)).toEqual(editPayload());
    expect(detail.request.result).toBeNull();
    expect((await asOwner(`route=inbox&id=${request.id}`, { user: 'neighbour' })).status).toBe(404);
  });

  it('reads and adopts staged files for the owner only, byte for byte, once', async () => {
    const { token } = await makeLink();
    await saveShow(simpleShow());
    expect((await stage(token, mediaId(1), PNG, 0, 2)).status).toBe(200);
    expect((await stage(token, mediaId(1), 'QUJD', 1, 2)).status).toBe(200);
    const request = await asked(token, flyerPayload(`media:${mediaId(1)}#2`), [mediaId(1)]);
    const staged = await rows('SELECT seq, total, data FROM coproducer_media ORDER BY seq');
    const chunk = await (await asOwner(`route=staged&id=${mediaId(1)}&seq=0`)).json() as { data: string; total: number };
    expect(chunk).toEqual({ data: staged[0][2], total: 2 });
    expect(decryptWithKey(chunk.data, KEY)).toBe(PNG);
    expect((await asOwner(`route=staged&id=${mediaId(1)}&seq=0`, { user: 'neighbour' })).status).toBe(404);
    expect((await asOwner('route=adopt', { user: 'neighbour', method: 'POST', body: { id: request.id } })).status).toBe(404);

    expect(await (await asOwner('route=adopt', { method: 'POST', body: { id: request.id } })).json()).toEqual({ ok: true, adopted: 2 });
    expect(await rows(`SELECT seq, total, data FROM user_media WHERE user_id = 'producer' ORDER BY seq`)).toEqual(staged);
    expect(await count('SELECT COUNT(*) FROM coproducer_media')).toBe(0);
    expect((await asOwner(`route=staged&id=${mediaId(1)}&seq=0`)).status).toBe(404);
    expect(await (await asOwner('route=adopt', { method: 'POST', body: { id: request.id } })).json()).toEqual({ ok: true, adopted: 0 });
    // The co-producer now reads the file from the owner's media.
    expect(await (await call(`route=media&id=${mediaId(1)}&seq=1`, { token })).json()).toEqual({ data: 'QUJD', total: 2 });

    await asOwner('route=decide', { method: 'POST', body: { id: request.id, decision: 'approved' } });
    expect(await error(await asOwner('route=adopt', { method: 'POST', body: { id: request.id } }))).toBe('not_open');
  });

  it('decides each request once: stale from pending only, rejected dropping its files', async () => {
    const { token } = await makeLink();
    await saveShow(simpleShow());
    const decide = (id: string, decision: string, extra: Record<string, unknown> = {}) => asOwner('route=decide', { method: 'POST', body: { id, decision, ...extra } });

    const first = await asked(token);
    const stale = await decide(first.id, 'stale');
    expect(((await stale.json()) as { request: OwnerRequestRow }).request).toMatchObject({ status: 'stale', decidedAt: null });
    expect(await error(await decide(first.id, 'stale'))).toBe('already_decided');
    const approved = await decide(first.id, 'approved');
    expect(((await approved.json()) as { request: OwnerRequestRow }).request.status).toBe('approved');
    expect(await error(await decide(first.id, 'rejected'))).toBe('already_decided');
    expect(await error(await decide('nobody', 'rejected'))).toBe('not_found');
    expect((await decide(first.id, 'maybe')).status).toBe(400);
    expect((await asOwner('route=decide', { user: 'neighbour', method: 'POST', body: { id: first.id, decision: 'rejected' } })).status).toBe(404);

    expect((await stage(token, mediaId(1))).status).toBe(200);
    const second = await asked(token, flyerPayload(`media:${mediaId(1)}#1`), [mediaId(1)]);
    expect((await decide(second.id, 'rejected', { result: 'x' })).status).toBe(400);
    expect(((await (await decide(second.id, 'rejected')).json()) as { request: OwnerRequestRow }).request.status).toBe('rejected');
    expect(await count('SELECT COUNT(*) FROM coproducer_media')).toBe(0);
  });

  it('hands an approval’s result back to the co-producer, and records what it handed out', async () => {
    const { token, link } = await makeLink();
    const share = await asked(token, sharePayload);
    const result = { links: [{ label: 'Viewer link for “Friday Laughs”', url: `${main}/live?t=abc#k=def` }] };
    const res = await asOwner('route=decide', {
      method: 'POST',
      body: { id: share.id, decision: 'approved', result: encryptWithKey(result, KEY), handout: encryptWithKey({ links: [{ kind: 'viewer', showId: 'show1' }] }, KEY) },
    });
    expect(res.status).toBe(200);
    const list = await (await call('route=requests', { token })).json() as { requests: CoproducerRequestView[] };
    expect(list.requests[0]).toMatchObject({ id: share.id, status: 'approved', result });
    const [[bytes, payload, outline, stored]] = await rows('SELECT bytes, payload, outline, result FROM coproducer_requests WHERE id = ?', share.id);
    expect(bytes).toBe(String(payload).length + String(outline).length + String(stored).length);
    const handouts = await (await asOwner('route=handouts')).json() as { handouts: { linkId: string; labelCipher: string; refsCipher: string; linkEndedAt: null }[] };
    expect(handouts.handouts).toHaveLength(1);
    expect(handouts.handouts[0]).toMatchObject({ linkId: link.id, labelCipher: link.labelCipher, linkEndedAt: null });
    expect(decryptWithKey(handouts.handouts[0].refsCipher, KEY)).toEqual({ links: [{ kind: 'viewer', showId: 'show1' }] });

    // A result that is not an ApprovalResult is not passed on.
    const other = await asked(token, downloadPayload);
    await asOwner('route=decide', { method: 'POST', body: { id: other.id, decision: 'approved', result: encryptWithKey({ links: 'nope' }, KEY) } });
    const again = await (await call('route=requests', { token })).json() as { requests: CoproducerRequestView[] };
    expect(again.requests.find((request) => request.id === other.id)?.result).toBeNull();
  });

  it('refuses a result or handout over its size', async () => {
    const { token } = await makeLink();
    const share = await asked(token, sharePayload);
    expect(await error(await asOwner('route=decide', { method: 'POST', body: { id: share.id, decision: 'approved', result: 'x'.repeat(65_537) } }))).toBe('payload_too_large');
    expect(await error(await asOwner('route=decide', { method: 'POST', body: { id: share.id, decision: 'approved', handout: 'x'.repeat(16_385) } }))).toBe('payload_too_large');
  });

  it('keeps the newest 500 handed-out links', async () => {
    const { token, link } = await makeLink();
    for (let i = 0; i < 500; i++) {
      await run(`INSERT INTO coproducer_handouts (id, user_id, link_id, label_cipher, refs_cipher, created_at) VALUES (?, 'producer', ?, 'c', 'r', ?)`, `old-${String(i).padStart(3, '0')}`, link.id, 1000 + i);
    }
    const share = await asked(token, sharePayload);
    await asOwner('route=decide', { method: 'POST', body: { id: share.id, decision: 'approved', handout: 'refs' } });
    expect(await count(`SELECT COUNT(*) FROM coproducer_handouts WHERE user_id = 'producer'`)).toBe(500);
    expect(await count(`SELECT COUNT(*) FROM coproducer_handouts WHERE id = 'old-000'`)).toBe(0);
    expect(await count(`SELECT COUNT(*) FROM coproducer_handouts WHERE refs_cipher = 'refs'`)).toBe(1);
  });

  it('decides many at once, only this owner’s open requests', async () => {
    const { token, link } = await makeLink();
    const theirs = await makeLink('neighbour');
    expect((await stage(token, mediaId(1))).status).toBe(200);
    await saveShow(simpleShow());
    const a = await asked(token, flyerPayload(`media:${mediaId(1)}#1`), [mediaId(1)]);
    const b = await asked(token);
    const decided = await insertRequest(link.id, { status: 'approved', decidedAt: now() });
    const neighbours = await asked(theirs.token);
    const stale = await (await asOwner('route=decide-many', { method: 'POST', body: { ids: [a.id, decided, neighbours.id, 'nobody'], decision: 'stale' } })).json();
    expect(stale).toEqual({ decided: [a.id] });
    const rejected = await (await asOwner('route=decide-many', { method: 'POST', body: { ids: [a.id, b.id, decided, neighbours.id], decision: 'rejected' } })).json() as { decided: string[] };
    expect(rejected.decided.sort()).toEqual([a.id, b.id].sort());
    expect(await count('SELECT COUNT(*) FROM coproducer_media')).toBe(0);
    expect(await rows('SELECT status FROM coproducer_requests WHERE id = ?', neighbours.id)).toEqual([['pending']]);
    for (const body of [{ ids: [], decision: 'rejected' }, { ids: [a.id, a.id], decision: 'rejected' }, { ids: [a.id], decision: 'approved' }, { ids: Array.from({ length: 201 }, (_, i) => `r${i}`), decision: 'stale' }]) {
      expect((await asOwner('route=decide-many', { method: 'POST', body })).status, JSON.stringify(body).slice(0, 60)).toBe(400);
    }
  });

  it('lists and dismisses handed-out links, the owner’s only', async () => {
    const { link } = await makeLink();
    await run(`INSERT INTO coproducer_handouts (id, user_id, link_id, label_cipher, refs_cipher, created_at) VALUES ('h1', 'producer', ?, 'c', 'r', 100), ('h2', 'producer', ?, 'c', 'r', 200), ('h3', 'neighbour', 'x', 'c', 'r', 300)`, link.id, link.id);
    const list = await (await asOwner('route=handouts')).json() as { handouts: { id: string }[] };
    expect(list.handouts.map((h) => h.id)).toEqual(['h2', 'h1']);
    expect((await asOwner('route=handouts&id=h3', { method: 'DELETE' })).status).toBe(200);
    expect(await count(`SELECT COUNT(*) FROM coproducer_handouts WHERE id = 'h3'`)).toBe(1);
    expect((await asOwner('route=handouts&id=h1', { method: 'DELETE' })).status).toBe(200);
    expect(await count(`SELECT COUNT(*) FROM coproducer_handouts WHERE id = 'h1'`)).toBe(0);
    expect((await asOwner('route=handouts', { method: 'DELETE' })).status).toBe(400);
  });
});

describe('withdrawing links (owner)', () => {
  it('takes one link’s requests and files with it, and keeps what it was handed, marked ended', async () => {
    const one = await makeLink();
    const two = await makeLink();
    const theirs = await makeLink('neighbour');
    await saveShow(simpleShow());
    for (const { token } of [one, two, theirs]) {
      await asked(token);
      expect((await stage(token, mediaId(Math.floor(Math.random() * 1e9)))).status).toBe(200);
    }
    await run(`INSERT INTO coproducer_handouts (id, user_id, link_id, label_cipher, refs_cipher, created_at) VALUES ('h1', 'producer', ?, 'c', 'r', 0)`, one.link.id);
    expect((await asOwner(`route=links&id=${theirs.link.id}`, { method: 'DELETE' })).status).toBe(200);
    expect(await count('SELECT COUNT(*) FROM coproducer_links WHERE id = ?', theirs.link.id)).toBe(1);

    expect((await asOwner(`route=links&id=${one.link.id}`, { method: 'DELETE' })).status).toBe(200);
    expect(await count('SELECT COUNT(*) FROM coproducer_requests WHERE link_id = ?', one.link.id)).toBe(0);
    expect(await count('SELECT COUNT(*) FROM coproducer_media WHERE link_id = ?', one.link.id)).toBe(0);
    expect(await count('SELECT COUNT(*) FROM coproducer_links WHERE id = ?', one.link.id)).toBe(0);
    expect(await count('SELECT COUNT(*) FROM coproducer_requests WHERE link_id = ?', two.link.id)).toBe(1);
    const [[ended]] = await rows(`SELECT link_ended_at FROM coproducer_handouts WHERE id = 'h1'`);
    expect(ended).not.toBeNull();

    expect((await asOwner('route=links', { method: 'DELETE' })).status).toBe(200);
    expect(await rows(`SELECT user_id FROM coproducer_links`)).toEqual([['neighbour']]);
    expect(await rows(`SELECT DISTINCT user_id FROM coproducer_requests`)).toEqual([['neighbour']]);
    expect(await rows(`SELECT DISTINCT user_id FROM coproducer_media`)).toEqual([['neighbour']]);
  });

  it('refuses an empty or repeated id rather than reading it as all', async () => {
    await makeLink();
    expect((await asOwner('route=links&id=', { method: 'DELETE' })).status).toBe(400);
    expect((await asOwner('route=links&id=a&id=b', { method: 'DELETE' })).status).toBe(400);
    expect(await count('SELECT COUNT(*) FROM coproducer_links')).toBe(1);
  });
});

describe('clean-up', () => {
  it('ends an expired link: its requests and files go, its handouts stay marked', async () => {
    const { token, link } = await makeLink();
    await saveShow(simpleShow());
    await asked(token);
    expect((await stage(token, mediaId(1))).status).toBe(200);
    await run(`INSERT INTO coproducer_handouts (id, user_id, link_id, label_cipher, refs_cipher, created_at) VALUES ('h1', 'producer', ?, 'c', 'r', 0)`, link.id);
    await run('UPDATE coproducer_links SET expires_at = ? WHERE id = ?', now() - 5, link.id);
    // Read before any clean-up: it already reads as ended.
    const listed = await (await asOwner('route=handouts')).json() as { handouts: { linkEndedAt: string | null }[] };
    expect(listed.handouts[0].linkEndedAt).not.toBeNull();
    await asOwner('route=decide-many', { method: 'POST', body: { ids: ['nothing'], decision: 'stale' } });
    expect(await count('SELECT COUNT(*) FROM coproducer_links')).toBe(0);
    expect(await count('SELECT COUNT(*) FROM coproducer_requests')).toBe(0);
    expect(await count('SELECT COUNT(*) FROM coproducer_media')).toBe(0);
    expect(await count(`SELECT COUNT(*) FROM coproducer_handouts WHERE link_ended_at IS NOT NULL`)).toBe(1);
  });

  it('keeps decided requests for 7 days, approved ones for 30, and unsent files for a day', async () => {
    const { token, link } = await makeLink();
    for (const [id, status, age] of [
      ['rejected-old', 'rejected', 8], ['rejected-new', 'rejected', 6], ['withdrawn-old', 'withdrawn', 8],
      ['approved-old', 'approved', 31], ['approved-new', 'approved', 29],
    ] as const) {
      await insertRequest(link.id, { id, status, decidedAt: now() - age * DAY });
    }
    await insertRequest(link.id, { id: 'waiting', createdAt: now() - 60 * DAY });
    await run(`INSERT INTO coproducer_media (user_id, link_id, id, seq, total, data, bytes, created_at) VALUES ('producer', ?, 'unsent-old', 0, 1, 'x', 1, ?), ('producer', ?, 'unsent-new', 0, 1, 'x', 1, ?), ('producer', ?, 'carried', 0, 1, 'x', 1, ?)`, link.id, now() - DAY - 5, link.id, now(), link.id, now() - 5 * DAY);
    await run(`UPDATE coproducer_media SET request_id = 'waiting' WHERE id = 'carried'`);
    // A co-producer's own write runs the same clean-up.
    await asked(token);
    expect((await rows(`SELECT id FROM coproducer_requests WHERE id NOT LIKE '%-%-%-%-%' ORDER BY id`)).map((row) => row[0]))
      .toEqual(['approved-new', 'rejected-new', 'waiting']);
    expect((await rows('SELECT id FROM coproducer_media ORDER BY id')).map((row) => row[0])).toEqual(['carried', 'unsent-new']);
  });
});

describe('a co-producer writes nothing of the owner’s', () => {
  it('leaves every owner table byte for byte as it was, whatever routes it calls', async () => {
    const { token } = await makeLink();
    const settings = fullSettings();
    await saveShow(fullShow({ id: 'show1' }));
    await saveSettings(settings);
    await saveMedia(mediaId(10), ['data:image/png;base64,AAAA']);
    await run(`INSERT INTO sign_request (token, user_id, payload) VALUES (?, 'producer', 'x')`, FIXTURE_SECRETS.profileToken);
    await run(`INSERT INTO sign_doc (token, seq, total, data, user_id, bytes) VALUES (?, 0, 1, 'pdf', 'producer', 3)`, FIXTURE_SECRETS.signToken);
    await run(`INSERT INTO profile_photo (token, seq, total, data, user_id, bytes) VALUES (?, 0, 1, ?, 'producer', 1)`, FIXTURE_SECRETS.profileToken, encryptWithKey(PNG, FIXTURE_SECRETS.profileKey));
    await run(`INSERT INTO live_view (token, user_id, payload) VALUES (?, 'producer', '{}')`, FIXTURE_SECRETS.viewToken);
    await run(`INSERT INTO live_media (token, id, seq, total, data, user_id, bytes) VALUES (?, 'w', 0, 1, 'audio', 'producer', 5)`, FIXTURE_SECRETS.viewToken);
    await run(`INSERT INTO subscription (user_id, status) VALUES ('producer', 'active')`);
    await run(`INSERT INTO chatgpt_grants (id, user_id, client_id, scope, resource, created_at, expires_at) VALUES ('g', 'producer', 'c', 'shows:read', 'r', 0, 9999999999)`);
    const share = await asked(token, sharePayload);
    await asOwner('route=decide', { method: 'POST', body: { id: share.id, decision: 'approved', result: encryptWithKey({ text: 'x' }, KEY), handout: 'refs' } });

    const tables = ['user_shows', 'user_settings', 'user_media', 'user_shows_backup', 'user_settings_backup', 'sign_request', 'sign_doc', 'profile_photo', 'live_view', 'live_media', 'subscription', 'coproducer_handouts', 'chatgpt_grants', 'chatgpt_tokens', 'chatgpt_clients', 'users'];
    const snapshot = async () => Object.fromEntries(await Promise.all(tables.map(async (table) => [table, JSON.stringify((await run(`SELECT * FROM ${table}`)).rows)])));
    const before = await snapshot();

    const statuses: number[] = [];
    const go = async (query: string, opts: Call = {}) => { const res = await call(query, { token, ...opts }); statuses.push(res.status); return res; };
    await go('route=session');
    await go('route=revisions');
    await go('route=shows');
    await go('route=shows&ids=show1');
    await go('route=settings');
    await go(`route=media&id=${mediaId(10)}&seq=0`);
    await go(`route=profile-photo&request=${settings.profileRequests![0].id}&seq=0`);
    await go('route=stage', { method: 'PUT', body: { id: mediaId(1), seq: 0, total: 1, data: PNG } });
    const created = await go('route=requests', { method: 'POST', body: { kind: 'edit', payload: flyerPayload(`media:${mediaId(1)}#1`), mediaIds: [mediaId(1)] } });
    const id = ((await created.json()) as { request: { id: string } }).request.id;
    await go('route=requests');
    await go(`route=requests&id=${id}`);
    await go(`route=requests&id=${id}`, { method: 'DELETE' });
    await go('route=use', { method: 'POST', body: { id: share.id } });
    expect(statuses).toEqual([200, 200, 200, 200, 200, 200, 200, 200, 201, 200, 200, 200, 200]);

    expect(await snapshot()).toEqual(before);
  });
});

// Someone a co-producer brings in comes with a name, a tape and social media,
// and nothing else (src/coproducer/newComics.ts). The server holds a request
// to that against the owner's own account.
describe('asking to add someone new (co-producer)', () => {
  const TAPE = 'https://youtu.be/jopark-tape';
  const jo = { id: 'c-jo', name: 'Jo Park', videoLink: TAPE, tapeMinutes: 5, socialMedia: '@jopark' };
  const settings = fullSettings();
  const sam = settings.potentialComics[0];
  const before = settings.potentialComics.map((comic) => comic.id);

  function rolodexAdd(row: Record<string, unknown>): EditPayload {
    return {
      kind: 'edit',
      shows: [],
      settings: {
        target: 'settings', baseRevision: null,
        fields: [{ field: 'potentialComics', kind: 'rows', idField: 'id', baseOrder: before, proposedOrder: [String(row.id), ...before], base: [], proposed: [[String(row.id), row]] }],
      },
    };
  }
  function lineup(list: 'performers' | 'artists', row: Record<string, unknown>, show = simpleShow()): EditPayload {
    return {
      kind: 'edit',
      shows: [{ target: 'show', op: 'update', showId: show.id, baseRevision: null, keys: [list], base: { [list]: show[list] }, proposed: { [list]: [...show[list], row] } } as unknown as EditPayload['shows'][number]],
      settings: null,
    };
  }
  const NOW_ISO = '2026-09-01T12:00:00.000Z';
  const problemsOf = async (res: Response) => ((await res.json()) as { problems?: { path: string; problem: string }[] }).problems?.map((p) => p.problem) ?? [];

  async function account() {
    await saveSettings(settings);
    await saveShow(simpleShow());
    return (await makeLink()).token;
  }

  it('accepts a new Rolodex entry with a name, a tape link, its length and social media', async () => {
    const token = await account();
    const view = await asked(token, rolodexAdd(jo));
    const [[stored]] = await rows('SELECT payload FROM coproducer_requests WHERE id = ?', view.id);
    expect(decryptWithKey(String(stored), KEY)).toEqual(rolodexAdd(jo));
    await asked(token, rolodexAdd({ ...jo, id: 'c-al', name: 'Al', tapeMinutes: 10, socialMedia: 'https://facebook.com/profile.php?id=7' }));
  });

  it('refuses one missing any of them, and stores nothing', async () => {
    const token = await account();
    const without = (key: string) => {
      const row: Record<string, unknown> = { ...jo };
      delete row[key];
      return row;
    };
    const cases: [Record<string, unknown>, string][] = [
      [{ ...jo, name: ' ' }, 'someone new needs a name'],
      [without('videoLink'), 'someone new needs a tape: an http or https link to a video of their set'],
      [without('tapeMinutes'), 'someone new needs a tape length of 5 or 10 minutes'],
      [without('socialMedia'), 'someone new needs their social media: a handle or a profile link'],
      [{ ...jo, socialMedia: 'ask me later' }, 'someone new needs their social media: a handle or a profile link'],
    ];
    for (const [row, problem] of cases) {
      const res = await ask(token, rolodexAdd(row));
      expect(res.status, problem).toBe(400);
      expect(await problemsOf(res)).toEqual([problem]);
    }
    expect(await count('SELECT COUNT(*) FROM coproducer_requests')).toBe(0);
  });

  it('refuses a tape that is not an http or https link, and a length that is not 5 or 10', async () => {
    const token = await account();
    for (const videoLink of ['my tape', 'javascript:alert(1)', 'ftp://example.com/tape.mp4', `${main}/api/settings`]) {
      expect((await ask(token, rolodexAdd({ ...jo, videoLink }))).status, videoLink).toBe(400);
    }
    for (const tapeMinutes of [7, 0, 15, '5']) {
      expect((await ask(token, rolodexAdd({ ...jo, tapeMinutes }))).status, String(tapeMinutes)).toBe(400);
    }
    expect(await count('SELECT COUNT(*) FROM coproducer_requests')).toBe(0);
  });

  it('refuses any other field on someone new', async () => {
    const token = await account();
    for (const extra of [{ email: 'jo@example.com' }, { phone: '555 0100' }, { notes: 'Pay 50' }, { credits: 'TV' }, { photo: 'media:abcdefgh#1' }, { walkOnMusicName: 'Song' }]) {
      const res = await ask(token, rolodexAdd({ ...jo, ...extra }));
      expect(res.status, Object.keys(extra)[0]).toBe(400);
      expect(await problemsOf(res)).toEqual(['not allowed for someone new: only a name, a tape and social media']);
    }
    expect(await count('SELECT COUNT(*) FROM coproducer_requests')).toBe(0);
  });

  it('refuses a new name on a bill without them, and accepts it with them', async () => {
    const token = await account();
    const bare = await ask(token, lineup('performers', { id: 'p-new', name: 'Walk In' }));
    expect(bare.status).toBe(400);
    expect(await problemsOf(bare)).toHaveLength(3);
    expect((await ask(token, lineup('artists', { id: 'a-new', name: 'New Band', notes: 'Loud' }))).status).toBe(400);
    expect((await ask(token, lineup('performers', { ...jo, id: 'p-new', email: 'jo@example.com' }))).status).toBe(400);
    // A booking that claims a Rolodex entry the owner does not have.
    const madeUp = await ask(token, lineup('performers', { ...sam, id: 'p-new', comicId: 'made-up' }));
    expect(await problemsOf(madeUp)).toEqual(['not someone in the Rolodex']);
    expect(await count('SELECT COUNT(*) FROM coproducer_requests')).toBe(0);

    await asked(token, lineup('artists', { ...jo, id: 'a-new', artistType: 'Band' }));
    const both = lineup('performers', { ...jo, id: 'p-new', comicId: 'c-jo' });
    both.settings = rolodexAdd(jo).settings;
    await asked(token, both);
  });

  it('still books someone already in the Rolodex, and edits them, as before', async () => {
    const token = await account();
    // Their profile as the Rolodex has it, less the files (a file must be one the account holds).
    const row: Record<string, unknown> = { ...sam };
    delete row.photo;
    delete row.walkOnMusic;
    await asked(token, lineup('performers', { ...row, id: 'p-new', comicId: sam.id }));
    await asked(token, {
      kind: 'edit',
      shows: [],
      settings: {
        target: 'settings', baseRevision: null,
        fields: [{ field: 'potentialComics', kind: 'rows', idField: 'id', baseOrder: before, proposedOrder: before, base: [[sam.id, row]], proposed: [[sam.id, { ...row, email: 'new@example.com', notes: 'Moved.' }]] }],
      },
    });
  });

  it('knows an act already on one of the owner’s bills with no Rolodex entry, so a copy of that show still goes through', async () => {
    await saveSettings(settings);
    const legacy = simpleShow('show1', { artists: [{ id: 'a1', name: 'The House Band', notes: 'Loud' }] });
    await saveShow(legacy);
    const { token } = await makeLink();
    const copy: Show = {
      id: 'show2', name: 'Copy', date: '', time: '', location: '', venueName: '', status: 'upcoming',
      performers: [], artists: [{ ...legacy.artists[0], id: 'a2' }], schedule: [], hosts: [], djSongs: [], staff: [], expenses: [],
      createdAt: NOW_ISO, updatedAt: NOW_ISO,
    };
    await asked(token, { kind: 'edit', shows: [{ target: 'show', op: 'create', showId: 'show2', show: copy }], settings: null });
    // The same act is nobody the owner has once it is on no bill.
    await saveShow(simpleShow('show1', { artists: [] }));
    expect((await ask(token, { kind: 'edit', shows: [{ target: 'show', op: 'create', showId: 'show3', show: { ...copy, id: 'show3' } }], settings: null })).status).toBe(400);
  });

  // A request made by hand can say anything about what was there before:
  // who is new is read from the owner's account, never from the request.
  describe('made by hand, lying about who was already there', () => {
    const extras = { email: 'n@b.co', notes: 'no tape' };
    const update = (list: 'performers' | 'artists', base: unknown[], proposed: unknown[]): EditPayload => ({
      kind: 'edit',
      shows: [{ target: 'show', op: 'update', showId: 'show1', baseRevision: null, keys: [list], base: { [list]: base }, proposed: { [list]: proposed } } as unknown as EditPayload['shows'][number]],
      settings: null,
    });
    const NOT_THEIRS = ['not someone in the Rolodex'];

    async function accountWith(show: Show) {
      await saveSettings(settings);
      await saveShow(show);
      return (await makeLink()).token;
    }

    it('refuses a new name typed over an unlinked booking behind a made-up link on both sides', async () => {
      const token = await accountWith(simpleShow('show1', { artists: [{ id: 'a1', name: 'House Band' }], performers: [{ id: 'p2', name: 'Walk On' }] }));
      const band = await ask(token, update('artists', [{ id: 'a1', name: 'House Band', comicId: 'zzz' }], [{ id: 'a1', name: 'Brand New Band', comicId: 'zzz', ...extras }]));
      expect(band.status).toBe(400);
      expect(await problemsOf(band)).toEqual(NOT_THEIRS);
      const comic = await ask(token, update('performers', [{ id: 'p2', name: 'Walk On', comicId: 'zzz' }], [{ id: 'p2', name: 'Brand New Comic', comicId: 'zzz', ...extras }]));
      expect(comic.status).toBe(400);
      expect(await problemsOf(comic)).toEqual(NOT_THEIRS);
      // The honest version of the same rename.
      const honest = await ask(token, update('artists', [{ id: 'a1', name: 'House Band' }], [{ id: 'a1', name: 'Brand New Band', ...extras }]));
      expect(honest.status).toBe(400);
      expect(await problemsOf(honest)).toHaveLength(5);
      expect(await count('SELECT COUNT(*) FROM coproducer_requests')).toBe(0);
    });

    it('refuses a new name behind a link whose Rolodex entry is gone', async () => {
      const gone = { id: 'p1', name: 'Gone Person', comicId: 'gone' };
      const token = await accountWith(simpleShow('show1', { performers: [gone] }));
      for (const proposed of [
        [gone, { id: 'p-s', name: 'Sneak In', comicId: 'gone', ...extras }],
        [{ ...gone, name: 'Sneak In' }],
      ]) {
        const res = await ask(token, update('performers', [gone], proposed));
        expect(res.status).toBe(400);
        expect(await problemsOf(res)).toEqual(NOT_THEIRS);
      }
      expect(await count('SELECT COUNT(*) FROM coproducer_requests')).toBe(0);
      // The owner's own booking is still theirs to edit and to copy.
      await asked(token, update('performers', [gone], [{ ...gone, notes: 'Back in May' }, { ...gone, id: 'p9' }]));
    });

    it('refuses a Rolodex entry or a name on a bill the owner does not have, whatever the request says was there', async () => {
      const token = await account();
      const sneak = { id: 'c-sneak', name: 'Sneak In', email: 'x@y.co' };
      for (const base of [[], [['c-sneak', { id: 'c-sneak', name: 'Sneak In' }]]] as [string, unknown][][]) {
        const res = await ask(token, {
          kind: 'edit', shows: [],
          settings: { target: 'settings', baseRevision: null, fields: [{ field: 'potentialComics', kind: 'rows', idField: 'id', baseOrder: ['c-sneak', ...before], proposedOrder: ['c-sneak', ...before], base, proposed: [['c-sneak', sneak]] }] },
        });
        expect(res.status).toBe(400);
        expect(await problemsOf(res)).toHaveLength(4);
      }
      const real = simpleShow().performers;
      const onBill = await ask(token, update('performers', [...real, { id: 'p-s', name: 'Sneak In' }], [...real, { id: 'p-s', name: 'Sneak In', email: 'x@y.co' }]));
      expect(onBill.status).toBe(400);
      expect(await problemsOf(onBill)).toHaveLength(4);
      expect(await count('SELECT COUNT(*) FROM coproducer_requests')).toBe(0);
    });

    it('files someone already on a bill only as their booking has them', async () => {
      const token = await accountWith(simpleShow('show1', { performers: [{ id: 'p2', name: 'Walk On', phone: '555 0100' }] }));
      const more = await ask(token, rolodexAdd({ id: 'c-w', name: 'walk on', email: 'a@b.co', notes: 'n' }));
      expect(more.status).toBe(400);
      expect(await problemsOf(more)).toHaveLength(5);
      expect(await count('SELECT COUNT(*) FROM coproducer_requests')).toBe(0);
      await asked(token, rolodexAdd({ id: 'c-w', name: 'Walk On', phone: '555 0100' }));
    });

    it('refuses social media that is not a handle or a profile link', async () => {
      const token = await account();
      for (const socialMedia of ['.', '-', 'https://', 'javascript:alert(1)', 'https://instagram.com/', 'https://instagram.com/p/abc']) {
        const res = await ask(token, rolodexAdd({ ...jo, socialMedia }));
        expect(res.status, socialMedia).toBe(400);
        expect(await problemsOf(res)).toEqual(['someone new needs their social media: a handle or a profile link']);
      }
      expect(await count('SELECT COUNT(*) FROM coproducer_requests')).toBe(0);
    });
  });
});

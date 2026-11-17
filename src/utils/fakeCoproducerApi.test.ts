import { randomBytes } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildOutline } from '../coproducer/outline';
import type { EditPayload } from '../coproducer/types';
import { decryptWithKey, encryptWithKey } from './encryption';

/**
 * The end-to-end suite's fake /api/coproducer (e2e/support/fake-coproducer.mjs)
 * answers as api/coproducer.ts does. Run here, against a stand-in for
 * Playwright's request routing, so the mirror the co-producer specs stand on
 * is checked without a browser.
 */

interface Answer { status: number; body: Record<string, unknown> }
type Route = (route: unknown) => Promise<void>;
interface FakeModule {
  emptyState: (overrides?: Record<string, unknown>) => Record<string, unknown> & { users: Record<string, unknown>; shows: { id: string; encryptedData: string }[]; settings: string | null; media: Record<string, string[]> };
  installFakeApi: (ctx: { route: (pattern: string, handler: Route) => Promise<void> }, state: unknown) => Promise<void>;
  addCoproducerLink: (state: unknown, link: { userId: string; key: string; legacyKey?: string; label?: string; expiresAt?: number }) => string;
  addCoproducerRequest: (state: unknown, request: { token: string; kind: string; payload: unknown; status?: string; mediaIds?: string[] }) => string;
  readCoproducerRequest: (state: unknown, id: string, key: string) => { status: string; payload: unknown; outline: unknown; result: unknown; usedAt: string | null } | null;
  decideCoproducerRequest: (state: unknown, id: string, decision: string, result?: unknown) => void;
}
interface Origins { MAIN_ORIGIN: string; REVIEW_ORIGIN: string }

let fake: FakeModule;
let origins: Origins;
const KEY = randomBytes(32).toString('hex');
const LEGACY = randomBytes(32).toString('hex');
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

beforeAll(async () => {
  // Plain JavaScript with no type declarations, so loaded by address.
  fake = (await import(/* @vite-ignore */ new URL('../../e2e/support/fake-api.mjs', import.meta.url).href)) as FakeModule;
  origins = (await import(/* @vite-ignore */ new URL('../../e2e/support/coproduceOrigins.mjs', import.meta.url).href)) as Origins;
});

async function setUp() {
  const state = fake.emptyState();
  state.users.producer = { credential: 'owner-credential', clientVersion: 2 };
  let handler: Route | null = null;
  await fake.installFakeApi({ route: async (_pattern, h) => { handler = h; } }, state);
  async function call(query: string, opts: { method?: string; body?: unknown; owner?: boolean; token?: string; origin?: string } = {}): Promise<Answer> {
    const base = opts.token ? origins.REVIEW_ORIGIN : origins.MAIN_ORIGIN;
    const headers: Record<string, string> = { 'x-forwarded-for': '203.0.113.7' };
    if (opts.owner) Object.assign(headers, { 'x-user-id': 'producer', 'x-auth': 'owner-credential' });
    if (opts.token) headers.authorization = `Bearer ${opts.token}`;
    if (opts.origin) headers.origin = opts.origin;
    let answer: { status: number; body: string } | null = null;
    await handler!({
      request: () => ({
        url: () => `${base}/api/coproducer?${query}`,
        method: () => opts.method ?? 'GET',
        headers: () => headers,
        postData: () => (opts.body === undefined ? null : JSON.stringify(opts.body)),
      }),
      fulfill: async (response: { status: number; body: string }) => { answer = response; },
    });
    const { status, body } = answer!;
    return { status, body: JSON.parse(body) as Record<string, unknown> };
  }
  return { state, call };
}

const editPayload: EditPayload = {
  kind: 'edit',
  shows: [{ target: 'show', op: 'update', showId: 'show1', baseRevision: null, keys: ['venueName'], base: { venueName: 'The Basement' }, proposed: { venueName: 'The Cellar' } }],
  settings: null,
};

describe('the fake /api/coproducer', () => {
  it('makes a link for the owner and opens it for the co-producer, from their own origins', async () => {
    const { state, call } = await setUp();
    const made = await call('route=links', { method: 'POST', owner: true, origin: origins.MAIN_ORIGIN, body: { label: 'Sam', key: KEY, legacyKey: LEGACY, consent: true } });
    expect(made.status).toBe(201);
    const token = made.body.token as string;
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(JSON.stringify(state)).not.toContain(token);
    expect((await call('route=links', { method: 'POST', owner: true, origin: origins.REVIEW_ORIGIN, body: {} })).status).toBe(403);
    expect((await call('route=session', { token, origin: origins.MAIN_ORIGIN })).status).toBe(403);
    const session = await call('route=session', { token });
    expect(session.body).toMatchObject({ link: { label: 'Sam' }, producerLocked: false });
    expect((await call('route=session', { token: 'A'.repeat(43) })).body).toEqual({ error: 'link_ended' });
    expect((await call('route=links', { owner: true })).body.links).toHaveLength(1);
  });

  it('serves redacted shows and settings, and refuses what does not open', async () => {
    const { state, call } = await setUp();
    const token = fake.addCoproducerLink(state, { userId: 'producer', key: KEY, legacyKey: LEGACY });
    state.shows.push({ id: 'show1', encryptedData: encryptWithKey({ id: 'show1', name: 'Friday', viewToken: 'secret-view-token-0000000000000000000000000', viewerKey: 'secret-audio-key', performers: [], artists: [], schedule: [], hosts: [], djSongs: [], staff: [], expenses: [], createdAt: '', updatedAt: '' }, KEY) });
    state.settings = encryptWithKey({ brandName: 'Laugh Co', signatureRequests: [{ id: 'abc', token: 'secret-sign-token-00000000000000000000000000', key: 'secret-sign-key', contractId: 'c', contractName: 'C', signerName: 'S', sentAt: '' }] }, KEY);
    const shows = await call('route=shows', { token });
    const settings = await call('route=settings', { token });
    const text = JSON.stringify([shows.body, settings.body]);
    expect(text).not.toContain('secret-');
    expect(text).toContain('redacted-');
    expect(shows.body).toMatchObject({ next: null, unreadable: 0 });
    expect((await call('route=revisions', { token })).body.shows).toHaveLength(1);
    state.settings = encryptWithKey({ brandName: 'x' }, randomBytes(32).toString('hex'));
    expect((await call('route=settings', { token })).body).toEqual({ error: 'link_unreadable' });
  });

  it('stages a file, takes a request carrying it, and the owner adopts and decides it', async () => {
    const { state, call } = await setUp();
    const token = fake.addCoproducerLink(state, { userId: 'producer', key: KEY, legacyKey: LEGACY });
    const id = 'abcdef12-0000-4000-8000-000000000001';
    expect((await call('route=stage', { token, method: 'PUT', body: { id, seq: 0, total: 1, data: PNG.replace('image/png', 'audio/mpeg') } })).body).toEqual({ error: 'unsupported_media' });
    expect((await call('route=stage', { token, method: 'PUT', body: { id, seq: 0, total: 1, data: PNG } })).status).toBe(200);
    const payload: EditPayload = { ...editPayload, shows: [{ target: 'show', op: 'update', showId: 'show1', baseRevision: null, keys: ['flyer'], base: {}, proposed: { flyer: `media:${id}#1` } }] };
    expect((await call('route=requests', { token, method: 'POST', body: { kind: 'edit', payload, mediaIds: [] } })).body).toEqual({ error: 'unknown_media' });
    const bad = await call('route=requests', { token, method: 'POST', body: { kind: 'edit', payload: { ...payload, settings: { nope: true } }, mediaIds: [] } });
    expect(bad.status).toBe(400);
    expect(Array.isArray(bad.body.problems)).toBe(true);
    const asked = await call('route=requests', { token, method: 'POST', body: { kind: 'edit', payload, mediaIds: [id] } });
    expect(asked.status).toBe(201);
    const requestId = (asked.body.request as { id: string }).id;
    expect(fake.readCoproducerRequest(state, requestId, KEY)).toMatchObject({ status: 'pending', payload, outline: buildOutline(payload) });

    const inbox = await call('route=inbox&status=open', { owner: true });
    expect((inbox.body.requests as { id: string; outline: string }[]).map((row) => row.id)).toEqual([requestId]);
    expect(decryptWithKey((inbox.body.requests as { outline: string }[])[0].outline, KEY)).toEqual(buildOutline(payload));
    expect((await call('route=inbox&count=1', { owner: true })).body).toEqual({ open: 1, links: 1 });
    expect((await call('route=adopt', { owner: true, method: 'POST', body: { id: requestId } })).body).toEqual({ ok: true, adopted: 1 });
    expect(decryptWithKey(state.media[id][0], KEY)).toBe(PNG);
    expect((await call(`route=media&id=${id}&seq=0`, { token })).body).toEqual({ data: PNG, total: 1 });
    const decided = await call('route=decide', { owner: true, method: 'POST', body: { id: requestId, decision: 'approved' } });
    expect((decided.body.request as { status: string }).status).toBe('approved');
    expect((await call('route=decide', { owner: true, method: 'POST', body: { id: requestId, decision: 'rejected' } })).body).toEqual({ error: 'already_decided' });
  });

  it('seeds and decides requests for specs, and hands an approval’s result back', async () => {
    const { state, call } = await setUp();
    const token = fake.addCoproducerLink(state, { userId: 'producer', key: KEY, legacyKey: LEGACY });
    const share = fake.addCoproducerRequest(state, { token, kind: 'share', payload: { kind: 'share', action: { type: 'viewer-link', showId: 'show1' } } });
    const hostile = fake.addCoproducerRequest(state, { token, kind: 'edit', payload: { kind: 'edit', shows: [], settings: { target: 'settings', baseRevision: null, fields: [{ field: 'deletedShowIds', kind: 'value', proposed: ['x'] }] } } });
    expect(fake.readCoproducerRequest(state, hostile, KEY)?.status).toBe('pending');
    fake.decideCoproducerRequest(state, share, 'approved', { links: [{ label: 'Viewer link', url: `${origins.MAIN_ORIGIN}/live?t=a#k=b` }] });
    const list = await call('route=requests', { token });
    const listed = list.body.requests as { id: string; status: string; result: unknown; outline: { action?: { key: string } } }[];
    const approved = listed.find((row) => row.id === share)!;
    expect(approved).toMatchObject({ status: 'approved', result: { links: [{ label: 'Viewer link' }] } });
    expect(approved.outline.action?.key).toBe('share:viewer-link:show1');
    expect(JSON.stringify(list.body)).not.toContain('payload');
    expect((await call('route=use', { token, method: 'POST', body: { id: share } })).body).toEqual({ ok: true });
    expect(fake.readCoproducerRequest(state, share, KEY)?.usedAt).not.toBeNull();
    expect((await call(`route=requests&id=${hostile}`, { token, method: 'DELETE' })).body).toEqual({ ok: true });
    expect((await call('route=links', { owner: true, method: 'DELETE' })).body).toEqual({ ok: true });
    expect((await call('route=session', { token })).body).toEqual({ error: 'link_ended' });
  });
});

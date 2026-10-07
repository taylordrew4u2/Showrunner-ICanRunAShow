import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHmac } from 'node:crypto';
import { createClient, type Client } from '@libsql/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import billing from '../../api/billing';
import webhook from '../../api/stripe-webhook';
import { encodeForm, verifyStripeSignature } from '../../api/_lib/stripe';

const connection = vi.hoisted(() => ({ db: null as Client | null }));
vi.mock('../../api/_lib/db', () => ({
  ensureSchema: async () => {},
  getDb: () => connection.db,
  ServerNotConfiguredError: class extends Error {},
}));
vi.mock('../../api/_lib/auth', () => ({
  authorize: async (req: Request) => req.headers.get('x-user-id'),
}));

const SECRET = 'whsec_test';
let dir: string;
let stripeCalls: { url: string; body: string }[];

function signed(payload: string, at = Math.floor(Date.now() / 1000), secret = SECRET): string {
  const sig = createHmac('sha256', secret).update(`${at}.${payload}`).digest('hex');
  return `t=${at},v1=${sig}`;
}

const sendEvent = (event: unknown, signature?: string) => {
  const payload = JSON.stringify(event);
  return webhook(new Request('https://example.test/api/stripe-webhook', {
    method: 'POST',
    headers: { 'stripe-signature': signature ?? signed(payload) },
    body: payload,
  }));
};

const plan = async (user = 'producer') => {
  const res = await billing(new Request('https://example.test/api/billing', { headers: { 'x-user-id': user } }));
  return res.json() as Promise<{ plan: string; founder: boolean; status: string | null; canManage: boolean; configured: boolean }>;
};

const post = (action: string, user = 'producer') =>
  billing(new Request('https://example.test/api/billing', {
    method: 'POST',
    headers: { 'x-user-id': user, 'content-type': 'application/json' },
    body: JSON.stringify({ action }),
  }));

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'showrunner-billing-'));
  connection.db = createClient({ url: `file:${join(dir, 'test.db')}` });
  await connection.db.execute(`CREATE TABLE subscription (
    user_id TEXT PRIMARY KEY, customer_id TEXT, subscription_id TEXT, status TEXT,
    current_period_end INTEGER, updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  await connection.db.execute(`CREATE TABLE users (
    id TEXT PRIMARY KEY, created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_x');
  vi.stubEnv('STRIPE_PRICE_ID', 'price_producer');
  vi.stubEnv('STRIPE_WEBHOOK_SECRET', SECRET);
  vi.stubEnv('APP_URL', 'https://icanrunashow.com');
  stripeCalls = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    stripeCalls.push({ url, body: String(init?.body ?? '') });
    if (url.includes('/checkout/sessions')) return Response.json({ url: 'https://checkout.stripe.com/c/pay/test' });
    if (url.includes('/billing_portal/sessions')) return Response.json({ url: 'https://billing.stripe.com/p/session/test' });
    if (url.includes('/subscriptions/sub_1')) {
      return Response.json({ id: 'sub_1', customer: 'cus_1', status: 'active', items: { data: [{ current_period_end: 1_800_000_000 }] } });
    }
    return Response.json({ error: { message: 'unexpected' } }, { status: 400 });
  }));
});
afterEach(() => {
  connection.db?.close();
  rmSync(dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('the Stripe webhook signature', () => {
  it('accepts a body signed with the endpoint secret', async () => {
    const body = '{"a":1}';
    expect(await verifyStripeSignature(body, signed(body), SECRET)).toBe(true);
  });

  it('refuses a body that was changed after signing', async () => {
    expect(await verifyStripeSignature('{"a":2}', signed('{"a":1}'), SECRET)).toBe(false);
  });

  it('refuses an old signature, so a captured request cannot be replayed', async () => {
    const body = '{"a":1}';
    const anHourAgo = Math.floor(Date.now() / 1000) - 3600;
    expect(await verifyStripeSignature(body, signed(body, anHourAgo), SECRET)).toBe(false);
  });

  it('refuses a request signed with some other secret', async () => {
    const res = await sendEvent({ type: 'ping', data: { object: {} } }, signed('{}', undefined, 'whsec_other'));
    expect(res.status).toBe(400);
  });
});

describe('a producer subscribing', () => {
  it('is on the free plan until Stripe says otherwise', async () => {
    expect(await plan()).toMatchObject({ plan: 'free', status: null, canManage: false, configured: true });
  });

  it('is sent to a Stripe-hosted checkout that knows which account is paying', async () => {
    const res = await post('checkout');
    expect(await res.json()).toEqual({ url: 'https://checkout.stripe.com/c/pay/test' });
    const body = decodeURIComponent(stripeCalls[0].body);
    expect(body).toContain('mode=subscription');
    expect(body).toContain('line_items[0][price]=price_producer');
    expect(body).toContain('client_reference_id=producer');
    expect(body).toContain('subscription_data[metadata][user_id]=producer');
    expect(body).toContain('success_url=https://icanrunashow.com/?billing=success');
  });

  it('becomes a Producer once checkout completes', async () => {
    await sendEvent({ type: 'checkout.session.completed', data: { object: { client_reference_id: 'producer', subscription: 'sub_1' } } });
    expect(await plan()).toMatchObject({ plan: 'producer', status: 'active', canManage: true });
  });

  it('goes back to free when the subscription is cancelled', async () => {
    await sendEvent({ type: 'checkout.session.completed', data: { object: { client_reference_id: 'producer', subscription: 'sub_1' } } });
    await sendEvent({ type: 'customer.subscription.deleted', data: { object: { id: 'sub_1', customer: 'cus_1', status: 'canceled', metadata: {} } } });
    expect(await plan()).toMatchObject({ plan: 'free', status: 'canceled' });
  });

  it('keeps paid features through a failed card while Stripe retries it', async () => {
    await sendEvent({ type: 'customer.subscription.updated', data: { object: { id: 'sub_1', customer: 'cus_1', status: 'past_due', metadata: { user_id: 'producer' } } } });
    expect((await plan()).plan).toBe('producer');
  });

  it('is not sent to checkout twice', async () => {
    await sendEvent({ type: 'checkout.session.completed', data: { object: { client_reference_id: 'producer', subscription: 'sub_1' } } });
    expect((await post('checkout')).status).toBe(409);
  });

  it('can open the Stripe portal to change a card or cancel, once there is a customer', async () => {
    expect((await post('portal')).status).toBe(404);
    await sendEvent({ type: 'checkout.session.completed', data: { object: { client_reference_id: 'producer', subscription: 'sub_1' } } });
    expect(await (await post('portal')).json()).toEqual({ url: 'https://billing.stripe.com/p/session/test' });
  });

  it('passes on why Stripe refused, so a mismatched key and price can be fixed without logs', async () => {
    vi.stubEnv('STRIPE_PRICE_ID', 'price_missing');
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(
      { error: { code: 'resource_missing', message: "No such price: 'price_missing'; a similar object exists in test mode" } },
      { status: 400 },
    )));
    const res = await post('checkout');
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error: 'stripe_error', code: 'resource_missing', message: expect.stringContaining('test mode') });
  });

  it('says so plainly when the server has no Stripe keys yet', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', '');
    expect((await plan()).configured).toBe(false);
    expect((await post('checkout')).status).toBe(501);
  });

  it('never lets one producer see another producer’s plan', async () => {
    await sendEvent({ type: 'checkout.session.completed', data: { object: { client_reference_id: 'producer', subscription: 'sub_1' } } });
    expect((await plan('someone-else')).plan).toBe('free');
  });
});

describe('accounts from before subscriptions', () => {
  const signedUp = (user: string, at: string) =>
    connection.db!.execute({ sql: `INSERT INTO users (id, created_at) VALUES (?, ?)`, args: [user, at] });

  it('keep every Producer feature free, without a subscription', async () => {
    await signedUp('early', '2026-03-14 20:15:00');
    expect(await plan('early')).toMatchObject({ plan: 'producer', founder: true, canManage: false });
  });

  it('are never sent to checkout for something they already have', async () => {
    await signedUp('early', '2026-03-14 20:15:00');
    expect((await post('checkout', 'early')).status).toBe(409);
    expect(stripeCalls).toHaveLength(0);
  });

  it('stop at the moment the locks shipped: anyone after it is on the free plan', async () => {
    await signedUp('just-before', '2026-10-06 23:31:57');
    await signedUp('just-after', '2026-10-06 23:31:58');
    expect((await plan('just-before')).plan).toBe('producer');
    expect(await plan('just-after')).toMatchObject({ plan: 'free', founder: false });
  });

  it('read an ISO timestamp the same way as SQLite’s own', async () => {
    await signedUp('iso', '2026-10-06T22:00:00.000Z');
    expect((await plan('iso')).founder).toBe(true);
  });

  it('do not lose the plan when a founder also subscribes and then cancels', async () => {
    await signedUp('producer', '2026-01-01 00:00:00');
    await sendEvent({ type: 'customer.subscription.deleted', data: { object: { id: 'sub_1', customer: 'cus_1', status: 'canceled', metadata: { user_id: 'producer' } } } });
    expect(await plan()).toMatchObject({ plan: 'producer', founder: true });
  });
});

describe('the Stripe form encoding', () => {
  it('flattens nested objects and arrays into bracket keys', () => {
    expect(encodeForm({ a: { b: 'c' }, l: [{ p: 'x' }], skip: undefined })).toEqual(['a%5Bb%5D=c', 'l%5B0%5D%5Bp%5D=x']);
  });
});

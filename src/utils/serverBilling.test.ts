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
// What Stripe itself currently holds, by subscription id. Events carry a
// snapshot; this is the live object behind it.
let stripeSubs: Record<string, Record<string, unknown>>;
// Checkout pages made and not yet paid, closed or expired, by customer.
let openCheckouts: { id: string; customer: string }[];
// Customers Stripe no longer has: removed in the dashboard, or made in the
// other mode. It refuses anything that names one.
let goneCustomers: string[];

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
  return res.json() as Promise<{
    plan: string; founder: boolean; status: string | null; canManage: boolean; configured: boolean;
    renewsAt: string | null; endsAt: string | null;
  }>;
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
    current_period_end INTEGER, cancel_at INTEGER, updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  await connection.db.execute(`CREATE TABLE users (
    id TEXT PRIMARY KEY, created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  // The account the webhook saves for has to exist; one made after the
  // founder cutoff, so it pays like anyone new.
  await connection.db.execute(`INSERT INTO users (id, created_at) VALUES ('producer', '2026-10-10 12:00:00')`);
  vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_x');
  vi.stubEnv('STRIPE_PRICE_ID', 'price_producer');
  vi.stubEnv('STRIPE_WEBHOOK_SECRET', SECRET);
  vi.stubEnv('APP_URL', 'https://icanrunashow.com');
  stripeCalls = [];
  stripeSubs = {
    // Made two days after the account, as a subscription always is.
    sub_1: {
      id: 'sub_1', customer: 'cus_1', status: 'active', metadata: { user_id: 'producer' }, created: 1_791_797_400,
      items: { data: [{ current_period_end: 1_800_000_000 }] },
    },
  };
  openCheckouts = [];
  goneCustomers = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    stripeCalls.push({ url, body: String(init?.body ?? '') });
    const named = new URLSearchParams(String(init?.body ?? '')).get('customer') ?? new URL(url).searchParams.get('customer');
    if (named && goneCustomers.includes(named)) {
      return Response.json(
        { error: { code: 'resource_missing', param: 'customer', message: `No such customer: '${named}'; a similar object exists in test mode` } },
        { status: 400 },
      );
    }
    if (url.endsWith('/checkout/sessions')) {
      const customer = new URLSearchParams(String(init?.body ?? '')).get('customer') ?? '';
      openCheckouts.push({ id: `cs_${stripeCalls.filter((c) => c.url.endsWith('/checkout/sessions')).length}`, customer });
      return Response.json({ url: 'https://checkout.stripe.com/c/pay/test' });
    }
    const open = /\/checkout\/sessions\?customer=([^&]+)&status=open/.exec(url);
    if (open) return Response.json({ data: openCheckouts.filter((c) => c.customer === decodeURIComponent(open[1])) });
    const expire = /\/checkout\/sessions\/([^/?]+)\/expire$/.exec(url);
    if (expire) {
      openCheckouts = openCheckouts.filter((c) => c.id !== expire[1]);
      return Response.json({ id: expire[1], status: 'expired' });
    }
    if (url.includes('/billing_portal/sessions')) return Response.json({ url: 'https://billing.stripe.com/p/session/test' });
    if (url.endsWith('/customers')) return Response.json({ id: `cus_new_${stripeCalls.filter((c) => c.url.endsWith('/customers')).length}` });
    const list = /\/subscriptions\?customer=([^&]+)/.exec(url);
    if (list) return Response.json({ data: Object.values(stripeSubs).filter((s) => s.customer === decodeURIComponent(list[1])) });
    const sub = /\/subscriptions\/([^/?]+)$/.exec(url);
    if (sub && stripeSubs[sub[1]]) return Response.json(stripeSubs[sub[1]]);
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
    const body = decodeURIComponent(stripeCalls.find((c) => c.url.endsWith('/checkout/sessions'))!.body);
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
    stripeSubs.sub_1.status = 'canceled';
    await sendEvent({ type: 'customer.subscription.deleted', data: { object: { id: 'sub_1', customer: 'cus_1', status: 'canceled', metadata: {} } } });
    expect(await plan()).toMatchObject({ plan: 'free', status: 'canceled' });
  });

  it('keeps paid features through a failed card while Stripe retries it', async () => {
    stripeSubs.sub_1.status = 'past_due';
    await sendEvent({ type: 'customer.subscription.updated', data: { object: { id: 'sub_1', customer: 'cus_1', status: 'past_due', metadata: { user_id: 'producer' } } } });
    expect((await plan()).plan).toBe('producer');
  });

  it('is told when the plan renews', async () => {
    await sendEvent({ type: 'checkout.session.completed', data: { object: { client_reference_id: 'producer', subscription: 'sub_1' } } });
    expect(await plan()).toMatchObject({ renewsAt: '2027-01-15T08:00:00.000Z', endsAt: null });
  });

  it('is told when a cancelled plan ends, rather than that it renews', async () => {
    // The portal's cancel keeps the subscription active to the end of the
    // period it was paid for, and marks it to stop there.
    stripeSubs.sub_1.cancel_at_period_end = true;
    stripeSubs.sub_1.cancel_at = 1_800_000_000;
    await sendEvent({ type: 'customer.subscription.updated', data: { object: { id: 'sub_1', customer: 'cus_1', status: 'active', metadata: { user_id: 'producer' } } } });
    expect(await plan()).toMatchObject({ plan: 'producer', status: 'active', renewsAt: null, endsAt: '2027-01-15T08:00:00.000Z' });

    // And renews again once the cancellation is taken back.
    stripeSubs.sub_1.cancel_at_period_end = false;
    stripeSubs.sub_1.cancel_at = null;
    await sendEvent({ type: 'customer.subscription.updated', data: { object: { id: 'sub_1', customer: 'cus_1', status: 'active', metadata: { user_id: 'producer' } } } });
    expect(await plan()).toMatchObject({ renewsAt: '2027-01-15T08:00:00.000Z', endsAt: null });
  });

  it('is told when a plan set to end on a date of its own ends', async () => {
    stripeSubs.sub_1.cancel_at = 1_790_000_000;
    await sendEvent({ type: 'customer.subscription.updated', data: { object: { id: 'sub_1', customer: 'cus_1', status: 'active', metadata: { user_id: 'producer' } } } });
    expect(await plan()).toMatchObject({ renewsAt: null, endsAt: new Date(1_790_000_000 * 1000).toISOString() });
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

describe('paying twice', () => {
  // Until Stripe's webhook lands, the account's own row still says free: a
  // producer back from checkout before it, or with checkout open in two tabs,
  // is offered Upgrade again.
  it('cannot make a second Stripe customer: the first checkout pins one, and the next reuses it', async () => {
    await post('checkout');
    await post('checkout');
    const customers = stripeCalls.filter((c) => c.url.endsWith('/customers'));
    expect(customers).toHaveLength(1);
    expect(decodeURIComponent(customers[0].body)).toContain('metadata[user_id]=producer');
    const checkouts = stripeCalls.filter((c) => c.url.endsWith('/checkout/sessions')).map((c) => decodeURIComponent(c.body));
    expect(checkouts).toHaveLength(2);
    for (const body of checkouts) expect(body).toContain('customer=cus_new_1');
  });

  it('is refused while Stripe holds a subscription the webhook has not reported yet', async () => {
    await post('checkout');
    stripeSubs.sub_2 = { id: 'sub_2', customer: 'cus_new_1', status: 'active', metadata: { user_id: 'producer' } };
    const res = await post('checkout');
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'already_subscribed' });
    expect(stripeCalls.filter((c) => c.url.endsWith('/checkout/sessions'))).toHaveLength(1);
  });

  it('closes a checkout left open before opening another, so only the newest can be paid', async () => {
    // Upgrade on the laptop, left on Stripe's page; then Upgrade on the phone.
    await post('checkout');
    expect(openCheckouts).toEqual([{ id: 'cs_1', customer: 'cus_new_1' }]);
    await post('checkout');
    expect(openCheckouts).toEqual([{ id: 'cs_2', customer: 'cus_new_1' }]);
  });

  it('looks for a subscription only once nothing else can start one', async () => {
    // A checkout paid for between the look and the close would otherwise
    // go on to be followed by a second.
    await post('checkout');
    await post('checkout');
    const second = stripeCalls.slice(stripeCalls.findIndex((c) => c.url.endsWith('/checkout/sessions')) + 1);
    const expired = second.findIndex((c) => c.url.endsWith('/checkout/sessions/cs_1/expire'));
    const looked = second.findIndex((c) => c.url.includes('/subscriptions?customer='));
    expect(expired).toBeGreaterThan(-1);
    expect(expired).toBeLessThan(looked);
  });

  it('does not offer Manage billing for a checkout that was never finished', async () => {
    await post('checkout');
    expect((await plan()).canManage).toBe(false);
  });

  it('does not let news of another subscription replace the one being paid for', async () => {
    await sendEvent({ type: 'checkout.session.completed', data: { object: { client_reference_id: 'producer', subscription: 'sub_1' } } });
    stripeSubs.sub_2 = { id: 'sub_2', customer: 'cus_1', status: 'canceled', metadata: { user_id: 'producer' } };
    await sendEvent({ type: 'customer.subscription.deleted', data: { object: { id: 'sub_2', customer: 'cus_1', status: 'canceled', metadata: { user_id: 'producer' } } } });
    expect(await plan()).toMatchObject({ plan: 'producer', status: 'active' });
  });

  // The portal's cancel keeps a subscription active to the end of its period
  // and marks it to stop there, so news of it is news of a paid subscription.
  const secondSubscription = () => {
    stripeSubs.sub_2 = {
      id: 'sub_2', customer: 'cus_1', status: 'active', metadata: { user_id: 'producer' }, created: 1_791_797_500,
      items: { data: [{ current_period_end: 1_800_000_100 }] },
    };
  };
  const updated = (id: string) =>
    sendEvent({ type: 'customer.subscription.updated', data: { object: { id, customer: 'cus_1', status: 'active', metadata: { user_id: 'producer' } } } });
  const deleted = (id: string) =>
    sendEvent({ type: 'customer.subscription.deleted', data: { object: { id, customer: 'cus_1', status: 'canceled', metadata: { user_id: 'producer' } } } });

  it('keeps the plan when the other subscription is cancelled at the end of its period', async () => {
    await sendEvent({ type: 'checkout.session.completed', data: { object: { client_reference_id: 'producer', subscription: 'sub_1' } } });
    secondSubscription();
    stripeSubs.sub_2.cancel_at_period_end = true;
    await updated('sub_2');
    // Still the one that renews, not the one on its way out.
    expect(await plan()).toMatchObject({ plan: 'producer', renewsAt: '2027-01-15T08:00:00.000Z', endsAt: null });

    stripeSubs.sub_2.status = 'canceled';
    await deleted('sub_2');
    expect(await plan()).toMatchObject({ plan: 'producer', status: 'active' });
  });

  it('follows the subscription still being paid for when the one it tracks is cancelled', async () => {
    await sendEvent({ type: 'checkout.session.completed', data: { object: { client_reference_id: 'producer', subscription: 'sub_1' } } });
    secondSubscription();
    // The second one's news came last, so it is the one the row names.
    await updated('sub_2');
    stripeSubs.sub_2.cancel_at_period_end = true;
    await updated('sub_2');
    expect(await plan()).toMatchObject({ plan: 'producer', renewsAt: '2027-01-15T08:00:00.000Z', endsAt: null });

    stripeSubs.sub_2.status = 'canceled';
    await deleted('sub_2');
    expect(await plan()).toMatchObject({ plan: 'producer', status: 'active' });
  });

  it('still says when the plan ends once every subscription is cancelled', async () => {
    await sendEvent({ type: 'checkout.session.completed', data: { object: { client_reference_id: 'producer', subscription: 'sub_1' } } });
    secondSubscription();
    stripeSubs.sub_1.cancel_at_period_end = true;
    stripeSubs.sub_2.cancel_at_period_end = true;
    await updated('sub_1');
    // The later of the two, which is when paid features actually stop.
    expect(await plan()).toMatchObject({ plan: 'producer', renewsAt: null, endsAt: new Date(1_800_000_100 * 1000).toISOString() });

    stripeSubs.sub_1.status = 'canceled';
    await deleted('sub_1');
    expect(await plan()).toMatchObject({ plan: 'producer', status: 'active' });

    stripeSubs.sub_2.status = 'canceled';
    await deleted('sub_2');
    expect(await plan()).toMatchObject({ plan: 'free', status: 'canceled' });
  });
});

describe('a pinned customer Stripe no longer has', () => {
  // Removed in the Stripe dashboard, or pinned while the server ran on test
  // keys before they moved to live.
  const pinned = (status: string | null, subscriptionId: string | null = null) =>
    connection.db!.execute({
      sql: `INSERT INTO subscription (user_id, customer_id, subscription_id, status) VALUES ('producer', 'cus_gone', ?, ?)`,
      args: [subscriptionId, status],
    });
  const row = async () =>
    Array.from((await connection.db!.execute(`SELECT customer_id, subscription_id, status FROM subscription WHERE user_id = 'producer'`)).rows[0]);

  it('is replaced at the next Upgrade, rather than refusing every checkout for good', async () => {
    goneCustomers.push('cus_gone');
    await pinned(null);
    const res = await post('checkout');
    expect(await res.json()).toEqual({ url: 'https://checkout.stripe.com/c/pay/test' });
    expect(await row()).toEqual(['cus_new_1', null, null]);
    const created = stripeCalls.filter((c) => c.url.endsWith('/checkout/sessions')).map((c) => decodeURIComponent(c.body));
    expect(created).toHaveLength(1);
    expect(created[0]).toContain('customer=cus_new_1');
  });

  it('takes the subscription it ended with along with it', async () => {
    // Deleting a customer cancels what was on it, and the webhook says so.
    goneCustomers.push('cus_gone');
    await pinned('canceled', 'sub_gone');
    expect((await post('checkout')).status).toBe(200);
    expect(await row()).toEqual(['cus_new_1', null, null]);
  });

  it('stops offering Manage billing once the portal finds it gone', async () => {
    goneCustomers.push('cus_gone');
    await pinned('canceled', 'sub_gone');
    expect((await plan()).canManage).toBe(true);
    const res = await post('portal');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'no_customer' });
    expect((await plan()).canManage).toBe(false);
  });

  it('is kept while the row says it is being paid for', async () => {
    goneCustomers.push('cus_gone');
    await pinned('active', 'sub_gone');
    expect((await post('portal')).status).toBe(404);
    expect(await row()).toEqual(['cus_gone', 'sub_gone', 'active']);
  });

  it('still ends the plan when the subscription on it ends with it', async () => {
    // Removing a customer in the dashboard cancels what was on it, and
    // Stripe will not list the subscriptions of a customer it no longer has.
    await sendEvent({ type: 'checkout.session.completed', data: { object: { client_reference_id: 'producer', subscription: 'sub_1' } } });
    goneCustomers.push('cus_1');
    stripeSubs.sub_1.status = 'canceled';
    const res = await sendEvent({ type: 'customer.subscription.deleted', data: { object: { id: 'sub_1', customer: 'cus_1', status: 'canceled', metadata: { user_id: 'producer' } } } });
    expect(res.status).toBe(200);
    expect(await plan()).toMatchObject({ plan: 'free', status: 'canceled' });
  });

  it('is not taken for a price Stripe does not have', async () => {
    // The same code, about something else: the customer is fine.
    await pinned(null);
    vi.stubEnv('STRIPE_PRICE_ID', 'price_missing');
    const fetchBefore = fetch;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => (url.endsWith('/checkout/sessions')
      ? Response.json({ error: { code: 'resource_missing', param: 'line_items[0][price]', message: "No such price: 'price_missing'" } }, { status: 400 })
      : fetchBefore(url, init))));
    expect((await post('checkout')).status).toBe(502);
    expect(await row()).toEqual(['cus_gone', null, null]);
  });
});

describe('an account that has been deleted', () => {
  it('is not brought back by the Stripe event its cancellation sends', async () => {
    // Deleting an account cancels its subscription, and Stripe says so
    // afterwards. Saving that would leave the old customer waiting behind
    // Manage billing for whoever next signs up under the same name.
    stripeSubs.sub_9 = { id: 'sub_9', customer: 'cus_9', status: 'canceled', metadata: { user_id: 'deleted-account' } };
    await sendEvent({ type: 'customer.subscription.deleted', data: { object: { id: 'sub_9', customer: 'cus_9', status: 'canceled', metadata: { user_id: 'deleted-account' } } } });
    await sendEvent({ type: 'checkout.session.completed', data: { object: { client_reference_id: 'deleted-account', subscription: 'sub_9' } } });
    const rows = await connection.db!.execute(`SELECT user_id FROM subscription`);
    expect(rows.rows).toHaveLength(0);
  });

  it('does not hand its subscription to whoever signs up under the same name later', async () => {
    // A delivery that failed is retried for days. By then the name may be
    // taken again, and the account made with it has the same id. 'producer'
    // signed up on 10 October; this subscription is from September, when the
    // account it belonged to was deleted along with it.
    stripeSubs.sub_old = {
      id: 'sub_old', customer: 'cus_old', status: 'canceled', metadata: { user_id: 'producer' }, created: 1_788_253_200,
    };
    await sendEvent({ type: 'customer.subscription.deleted', data: { object: { id: 'sub_old', customer: 'cus_old', status: 'canceled', metadata: { user_id: 'producer' } } } });
    expect((await connection.db!.execute(`SELECT user_id FROM subscription`)).rows).toHaveLength(0);

    // Nor over the customer the new account has pinned for its own checkout.
    await post('checkout');
    await sendEvent({ type: 'customer.subscription.deleted', data: { object: { id: 'sub_old', customer: 'cus_old', status: 'canceled', metadata: { user_id: 'producer' } } } });
    const row = await connection.db!.execute(`SELECT customer_id, subscription_id FROM subscription WHERE user_id = 'producer'`);
    expect(Array.from(row.rows[0])).toEqual(['cus_new_1', null]);
    expect((await plan()).canManage).toBe(false);
  });
});

describe('Stripe events that arrive late or out of order', () => {
  // Stripe does not promise to deliver events in order, and retries a failed
  // delivery for days with the payload it first sent.
  it('do not undo a payment with the "created" event that was delivered after it', async () => {
    await sendEvent({ type: 'customer.subscription.updated', data: { object: { id: 'sub_1', customer: 'cus_1', status: 'active', metadata: { user_id: 'producer' } } } });
    await sendEvent({ type: 'customer.subscription.created', data: { object: { id: 'sub_1', customer: 'cus_1', status: 'incomplete', metadata: { user_id: 'producer' } } } });
    expect(await plan()).toMatchObject({ plan: 'producer', status: 'active' });
  });

  it('do not bring back a cancelled subscription with a retried renewal', async () => {
    await sendEvent({ type: 'checkout.session.completed', data: { object: { client_reference_id: 'producer', subscription: 'sub_1' } } });
    stripeSubs.sub_1.status = 'canceled';
    await sendEvent({ type: 'customer.subscription.deleted', data: { object: { id: 'sub_1', customer: 'cus_1', status: 'canceled', metadata: { user_id: 'producer' } } } });
    await sendEvent({ type: 'customer.subscription.updated', data: { object: { id: 'sub_1', customer: 'cus_1', status: 'active', metadata: { user_id: 'producer' } } } });
    expect(await plan()).toMatchObject({ plan: 'free', status: 'canceled' });
  });
});

describe('accounts from before subscriptions', () => {
  const signedUp = (user: string, at: string) =>
    connection.db!.execute({
      sql: `INSERT INTO users (id, created_at) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET created_at = excluded.created_at`,
      args: [user, at],
    });

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
    stripeSubs.sub_1.status = 'canceled';
    await sendEvent({ type: 'customer.subscription.deleted', data: { object: { id: 'sub_1', customer: 'cus_1', status: 'canceled', metadata: { user_id: 'producer' } } } });
    expect(await plan()).toMatchObject({ plan: 'producer', founder: true });
  });
});

describe('the Stripe form encoding', () => {
  it('flattens nested objects and arrays into bracket keys', () => {
    expect(encodeForm({ a: { b: 'c' }, l: [{ p: 'x' }], skip: undefined })).toEqual(['a%5Bb%5D=c', 'l%5B0%5D%5Bp%5D=x']);
  });
});

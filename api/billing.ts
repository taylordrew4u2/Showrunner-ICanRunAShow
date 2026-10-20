// /api/billing — the signed-in producer's plan, and the way into Stripe.
//   GET                          → { configured, plan, founder, status, renewsAt, endsAt, canManage }
//   POST { action: 'checkout' }  → { url } of a Stripe Checkout page for the Producer plan
//   POST { action: 'portal' }    → { url } of the Stripe customer portal (change card, cancel)
// Card details never touch this server: both URLs are Stripe-hosted pages.
import { authorize } from './_lib/auth';
import { ensureSchema, getDb } from './_lib/db';
import { handleError, json, readJson } from './_lib/http';
import {
  BillingNotConfiguredError,
  isBillingConfigured,
  isPaidStatus,
  stripe,
  StripeError,
  type StripeSubscription,
} from './_lib/stripe';

interface SubscriptionRow {
  customerId: string | null;
  subscriptionId: string | null;
  status: string | null;
  periodEnd: number | null;
  cancelAt: number | null;
}

async function loadRow(userId: string): Promise<SubscriptionRow | null> {
  const result = await getDb().execute({
    sql: `SELECT customer_id, subscription_id, status, current_period_end, cancel_at FROM subscription WHERE user_id = ?`,
    args: [userId],
  });
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  const customerId = row[0];
  const subscriptionId = row[1];
  const status = row[2];
  const periodEnd = row[3];
  const cancelAt = row[4];
  return {
    customerId: customerId != null ? String(customerId) : null,
    subscriptionId: subscriptionId != null ? String(subscriptionId) : null,
    status: status != null ? String(status) : null,
    periodEnd: periodEnd != null ? Number(periodEnd) : null,
    cancelAt: cancelAt != null ? Number(cancelAt) : null,
  };
}

/**
 * The account's Stripe customer, made now if it has none yet.
 *
 * Made before the first checkout rather than left to Checkout, which makes a
 * new customer every time it isn't handed one. The row only learns of a
 * subscription when the webhook lands, so a producer who came back before it
 * did, or had checkout open in two tabs, paid again as a second customer with
 * a second subscription, and the app only ever tracked one of the two.
 */
async function ensureCustomer(userId: string, row: SubscriptionRow | null): Promise<string> {
  if (row?.customerId) return row.customerId;
  const customer = await stripe<{ id: string }>('POST', '/customers', { metadata: { user_id: userId } });
  // Two checkouts racing here both make one; the first to be written is the
  // one every later checkout uses, and the spare is a customer with nothing on it.
  await getDb().execute({
    sql: `INSERT INTO subscription (user_id, customer_id) VALUES (?, ?)
          ON CONFLICT(user_id) DO UPDATE SET customer_id = COALESCE(subscription.customer_id, excluded.customer_id)`,
    args: [userId, customer.id],
  });
  return (await loadRow(userId))?.customerId ?? customer.id;
}

/** Statuses of a subscription that is paid for, or on its way to being. */
const LIVE_STATUSES = new Set(['active', 'trialing', 'past_due', 'incomplete']);

/**
 * Whether Stripe already has a subscription for this customer, whatever the
 * row says. Asked of Stripe because the row is the webhook's, and it can be
 * seconds — or, when a delivery failed, hours — behind.
 */
async function hasLiveSubscription(customerId: string): Promise<boolean> {
  const list = await stripe<{ data: StripeSubscription[] }>(
    'GET',
    `/subscriptions?customer=${encodeURIComponent(customerId)}&status=all&limit=10`,
  );
  return list.data.some((sub) => LIVE_STATUSES.has(sub.status));
}

/**
 * When the Producer features started being held back (the lock shipped in
 * #317), in the users table's own UTC "YYYY-MM-DD HH:MM:SS" form. Accounts
 * made before it were promised a free app and keep every feature without
 * paying: they are founding members, on the Producer plan for good.
 */
export const SUBSCRIPTIONS_STARTED_AT = '2026-10-06 23:31:58';

export function isFoundingMember(createdAt: string | null): boolean {
  if (!createdAt) return false;
  // SQLite writes a space between date and time; tolerate the ISO "T" too so
  // a row written another way can't sort after the cutoff by accident.
  return createdAt.replace('T', ' ').slice(0, 19) < SUBSCRIPTIONS_STARTED_AT;
}

async function loadCreatedAt(userId: string): Promise<string | null> {
  const result = await getDb().execute({ sql: `SELECT created_at FROM users WHERE id = ?`, args: [userId] });
  const value = result.rows[0]?.[0];
  return value != null ? String(value) : null;
}

// Where Stripe sends the producer back to. APP_URL pins it in production so a
// request arriving through some other hostname can't redirect a paying
// customer somewhere else; previews fall back to the URL they were reached on.
function appOrigin(req: Request): string {
  return (process.env.APP_URL || new URL(req.url).origin).replace(/\/$/, '');
}

export default async function handler(req: Request): Promise<Response> {
  try {
    await ensureSchema();
    const userId = await authorize(req);
    if (!userId) return json({ error: 'unauthorized' }, 401);
    const row = await loadRow(userId);
    const founder = isFoundingMember(await loadCreatedAt(userId));

    if (req.method === 'GET') {
      return json({
        configured: isBillingConfigured(),
        plan: founder || isPaidStatus(row?.status) ? 'producer' : 'free',
        founder,
        status: row?.status ?? null,
        // A subscription cancelled in the portal stays active to the end of
        // its period. It does not renew, and the card has to say when it ends.
        renewsAt: row?.periodEnd && !row.cancelAt ? new Date(row.periodEnd * 1000).toISOString() : null,
        endsAt: row?.cancelAt ? new Date(row.cancelAt * 1000).toISOString() : null,
        // The portal is for a subscription. A customer is made before the
        // first checkout, so one that was never finished leaves a customer
        // with nothing on it to manage.
        canManage: Boolean(row?.customerId && row.subscriptionId),
      });
    }

    if (req.method === 'POST') {
      if (!isBillingConfigured()) return json({ error: 'billing_not_configured' }, 501);
      const { action } = await readJson<{ action?: string }>(req);
      const origin = appOrigin(req);

      if (action === 'checkout') {
        if (founder) return json({ error: 'founding_member' }, 409);
        if (isPaidStatus(row?.status)) return json({ error: 'already_subscribed' }, 409);
        const customer = await ensureCustomer(userId, row);
        if (await hasLiveSubscription(customer)) return json({ error: 'already_subscribed' }, 409);
        const session = await stripe<{ url: string }>('POST', '/checkout/sessions', {
          mode: 'subscription',
          line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
          // The account is identified three ways so the webhook can always
          // find it: on the session, on the subscription it creates, and by
          // the customer. Usernames never go to Stripe — only the opaque,
          // derived account id.
          client_reference_id: userId,
          subscription_data: { metadata: { user_id: userId } },
          customer,
          allow_promotion_codes: true,
          success_url: `${origin}/?billing=success`,
          cancel_url: `${origin}/?billing=cancelled`,
        });
        return json({ url: session.url });
      }

      if (action === 'portal') {
        if (!row?.customerId) return json({ error: 'no_customer' }, 404);
        const session = await stripe<{ url: string }>('POST', '/billing_portal/sessions', {
          customer: row.customerId,
          return_url: `${origin}/`,
        });
        return json({ url: session.url });
      }

      return json({ error: 'bad_request' }, 400);
    }

    return json({ error: 'method_not_allowed' }, 405);
  } catch (err) {
    if (err instanceof BillingNotConfiguredError) return json({ error: 'billing_not_configured' }, 501);
    if (err instanceof StripeError) {
      console.error('Stripe error:', err.path, err.code, err.message);
      return json({ error: 'stripe_error', code: err.code ?? null, message: err.message }, 502);
    }
    return handleError(err);
  }
}

export const config = { runtime: 'edge' };

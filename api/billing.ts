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

/** Stripe refused because it has no such customer, rather than over anything else a request names. */
function isMissingCustomer(err: unknown): boolean {
  return err instanceof StripeError && err.code === 'resource_missing' && err.param === 'customer';
}

/**
 * Let go of a pinned customer Stripe no longer has, with whatever the row
 * says about a subscription on it, so the next checkout pins a new one.
 *
 * Removed in the Stripe dashboard, or pinned while the server ran on test
 * keys that have since moved to live: Stripe refuses every request that
 * names it, and nothing else ever replaces a pinned customer, so the producer
 * could never subscribe. Not while the row says something is being paid for,
 * which is the webhook's to change.
 */
async function forgetMissingCustomer(userId: string, customerId: string): Promise<void> {
  await getDb().execute({
    sql: `UPDATE subscription
             SET customer_id = NULL, subscription_id = NULL, status = NULL,
                 current_period_end = NULL, cancel_at = NULL, updated_at = datetime('now')
           WHERE user_id = ? AND customer_id = ?
             AND (status IS NULL OR status NOT IN ('active', 'trialing', 'past_due'))`,
    args: [userId, customerId],
  });
}

/**
 * Close every checkout still open on this customer, so the one about to be
 * made is the only one that can be paid.
 *
 * A checkout page stays payable for a day, and Stripe takes a second
 * subscription from a customer who already has one. Pinning the customer
 * put both on one customer; it did not stop the second payment. A page left
 * open in the laptop's tab, after the producer had paid on their phone, could
 * still be paid, and they were billed twice for one plan.
 */
async function closeOpenCheckouts(customerId: string): Promise<void> {
  const open = await stripe<{ data: { id: string }[] }>(
    'GET',
    `/checkout/sessions?customer=${encodeURIComponent(customerId)}&status=open&limit=100`,
  );
  for (const session of open.data) {
    await stripe('POST', `/checkout/sessions/${encodeURIComponent(session.id)}/expire`);
  }
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
 * A Stripe Checkout page for the Producer plan, paid as this customer, or
 * null when Stripe already has a subscription for it.
 */
async function checkoutUrl(userId: string, customer: string, origin: string): Promise<string | null> {
  // Closed before looking for a subscription, not after: one paid for
  // between the look and the close would be followed by another.
  await closeOpenCheckouts(customer);
  if (await hasLiveSubscription(customer)) return null;
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
  return session.url;
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
        let url: string | null;
        try {
          url = await checkoutUrl(userId, customer, origin);
        } catch (err) {
          if (!isMissingCustomer(err)) throw err;
          await forgetMissingCustomer(userId, customer);
          const replacement = await ensureCustomer(userId, await loadRow(userId));
          // Still pinned: the row says it is paid for (see forgetMissingCustomer).
          if (replacement === customer) throw err;
          url = await checkoutUrl(userId, replacement, origin);
        }
        if (url === null) return json({ error: 'already_subscribed' }, 409);
        return json({ url });
      }

      if (action === 'portal') {
        if (!row?.customerId) return json({ error: 'no_customer' }, 404);
        try {
          const session = await stripe<{ url: string }>('POST', '/billing_portal/sessions', {
            customer: row.customerId,
            return_url: `${origin}/`,
          });
          return json({ url: session.url });
        } catch (err) {
          if (!isMissingCustomer(err)) throw err;
          // There is nothing left to manage there. Let it go, so Manage
          // billing stops being offered and the next Upgrade pins a new one.
          await forgetMissingCustomer(userId, row.customerId);
          return json({ error: 'no_customer' }, 404);
        }
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

// /api/billing — the signed-in producer's plan, and the way into Stripe.
//   GET                          → { configured, plan, status, renewsAt }
//   POST { action: 'checkout' }  → { url } of a Stripe Checkout page for the Producer plan
//   POST { action: 'portal' }    → { url } of the Stripe customer portal (change card, cancel)
// Card details never touch this server: both URLs are Stripe-hosted pages.
import { authorize } from './_lib/auth';
import { ensureSchema, getDb } from './_lib/db';
import { handleError, json, readJson } from './_lib/http';
import { BillingNotConfiguredError, isBillingConfigured, isPaidStatus, stripe, StripeError } from './_lib/stripe';

interface SubscriptionRow {
  customerId: string | null;
  status: string | null;
  periodEnd: number | null;
}

async function loadRow(userId: string): Promise<SubscriptionRow | null> {
  const result = await getDb().execute({
    sql: `SELECT customer_id, status, current_period_end FROM subscription WHERE user_id = ?`,
    args: [userId],
  });
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  const customerId = row[0];
  const status = row[1];
  const periodEnd = row[2];
  return {
    customerId: customerId != null ? String(customerId) : null,
    status: status != null ? String(status) : null,
    periodEnd: periodEnd != null ? Number(periodEnd) : null,
  };
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

    if (req.method === 'GET') {
      return json({
        configured: isBillingConfigured(),
        plan: isPaidStatus(row?.status) ? 'producer' : 'free',
        status: row?.status ?? null,
        renewsAt: row?.periodEnd ? new Date(row.periodEnd * 1000).toISOString() : null,
        canManage: Boolean(row?.customerId),
      });
    }

    if (req.method === 'POST') {
      if (!isBillingConfigured()) return json({ error: 'billing_not_configured' }, 501);
      const { action } = await readJson<{ action?: string }>(req);
      const origin = appOrigin(req);

      if (action === 'checkout') {
        if (isPaidStatus(row?.status)) return json({ error: 'already_subscribed' }, 409);
        const session = await stripe<{ url: string }>('POST', '/checkout/sessions', {
          mode: 'subscription',
          line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
          // The account is identified three ways so the webhook can always
          // find it: on the session, on the subscription it creates, and by
          // the customer once one exists. Usernames never go to Stripe —
          // only the opaque, derived account id.
          client_reference_id: userId,
          subscription_data: { metadata: { user_id: userId } },
          ...(row?.customerId ? { customer: row.customerId } : {}),
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

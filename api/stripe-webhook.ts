// /api/stripe-webhook — Stripe telling us a subscription started, changed or
// ended. Unauthenticated by design (Stripe calls it), so nothing is trusted
// until the Stripe-Signature header checks out against the raw body.
import { ensureSchema, getDb } from './_lib/db';
import { handleError, json } from './_lib/http';
import { periodEnd, stripe, verifyStripeSignature, type StripeSubscription } from './_lib/stripe';

interface StripeEvent {
  type: string;
  data: { object: Record<string, unknown> };
}

async function saveSubscription(userId: string, sub: StripeSubscription): Promise<void> {
  await getDb().execute({
    sql: `INSERT INTO subscription (user_id, customer_id, subscription_id, status, current_period_end, updated_at)
          VALUES (?, ?, ?, ?, ?, datetime('now'))
          ON CONFLICT(user_id) DO UPDATE SET
            customer_id = excluded.customer_id,
            subscription_id = excluded.subscription_id,
            status = excluded.status,
            current_period_end = excluded.current_period_end,
            updated_at = excluded.updated_at`,
    args: [userId, sub.customer, sub.id, sub.status, periodEnd(sub)],
  });
}

// A subscription event names its account in the metadata checkout put there;
// one made some other way (by hand in the Stripe dashboard, say) is matched by
// its customer instead.
async function accountFor(sub: StripeSubscription): Promise<string | null> {
  if (sub.metadata?.user_id) return sub.metadata.user_id;
  const result = await getDb().execute({
    sql: `SELECT user_id FROM subscription WHERE customer_id = ?`,
    args: [sub.customer],
  });
  return result.rows.length ? String(result.rows[0][0]) : null;
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return json({ error: 'billing_not_configured' }, 501);
  try {
    const payload = await req.text();
    if (!(await verifyStripeSignature(payload, req.headers.get('stripe-signature'), secret))) {
      return json({ error: 'bad_signature' }, 400);
    }
    const event = JSON.parse(payload) as StripeEvent;
    await ensureSchema();

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as { client_reference_id?: string; subscription?: string };
      if (session.client_reference_id && session.subscription) {
        // Fetched rather than assumed: the session only says checkout
        // finished, and the subscription's own status is what counts.
        const sub = await stripe<StripeSubscription>('GET', `/subscriptions/${encodeURIComponent(session.subscription)}`);
        await saveSubscription(session.client_reference_id, sub);
      }
    } else if (
      event.type === 'customer.subscription.created' ||
      event.type === 'customer.subscription.updated' ||
      event.type === 'customer.subscription.deleted'
    ) {
      const sub = event.data.object as unknown as StripeSubscription;
      const userId = await accountFor(sub);
      if (userId) await saveSubscription(userId, sub);
    }
    // Every other event is acknowledged and ignored, or Stripe retries it for days.
    return json({ received: true });
  } catch (err) {
    return handleError(err);
  }
}

export const config = { runtime: 'edge' };

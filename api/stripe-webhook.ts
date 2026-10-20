// /api/stripe-webhook — Stripe telling us a subscription started, changed or
// ended. Unauthenticated by design (Stripe calls it), so nothing is trusted
// until the Stripe-Signature header checks out against the raw body.
import { ensureSchema, getDb } from './_lib/db';
import { handleError, json } from './_lib/http';
import { cancelAt, periodEnd, stripe, verifyStripeSignature, type StripeSubscription } from './_lib/stripe';

interface StripeEvent {
  type: string;
  data: { object: Record<string, unknown> };
}

// One row per account, so an account that somehow holds two subscriptions is
// tracked by one of them. News of the other must not replace a paid one with
// one that is not: cancelling a duplicate used to put the account on the free
// plan while the subscription it was still paying for kept charging. The
// statuses listed are the ones isPaidStatus counts as paid.
//
// Only for an account that still exists, and that existed when the
// subscription was made. Deleting an account cancels its subscription, and
// Stripe's word of that arrives afterwards; saving it would leave the old
// customer behind Manage billing for whoever next signs up under the same
// name, since an account's id comes from its name. Checking that the account
// exists covers the usual seconds. It does not cover a delivery that failed
// and is retried days later, after the name has been taken again — but no
// subscription can be started before its account is, so one older than the
// account (by more than two clocks can disagree) was never this account's.
async function saveSubscription(userId: string, sub: StripeSubscription): Promise<void> {
  const created = sub.created ?? null;
  await getDb().execute({
    sql: `INSERT INTO subscription (user_id, customer_id, subscription_id, status, current_period_end, cancel_at, updated_at)
          SELECT ?, ?, ?, ?, ?, ?, datetime('now')
           WHERE EXISTS (
             SELECT 1 FROM users
              WHERE id = ?
                AND (? IS NULL OR datetime(created_at) IS NULL
                     OR datetime(created_at) <= datetime(?, 'unixepoch', '+10 minutes'))
           )
          ON CONFLICT(user_id) DO UPDATE SET
            customer_id = excluded.customer_id,
            subscription_id = excluded.subscription_id,
            status = excluded.status,
            current_period_end = excluded.current_period_end,
            cancel_at = excluded.cancel_at,
            updated_at = excluded.updated_at
          WHERE subscription.subscription_id IS NULL
             OR subscription.subscription_id = excluded.subscription_id
             OR subscription.status NOT IN ('active', 'trialing', 'past_due')
             OR excluded.status IN ('active', 'trialing', 'past_due')`,
    args: [userId, sub.customer, sub.id, sub.status, periodEnd(sub), cancelAt(sub), userId, created, created],
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
      // Fetched too, rather than saving the copy inside the event. That copy
      // is the subscription as it was when the event was made, and Stripe
      // neither delivers events in order nor gives up on one that failed: a
      // late "created" (incomplete) used to land on top of the "updated"
      // (active) after it and lock out someone who had paid, and a renewal
      // retried after a cancellation switched the plan back on for good.
      const snapshot = event.data.object as unknown as StripeSubscription;
      const sub = await stripe<StripeSubscription>('GET', `/subscriptions/${encodeURIComponent(snapshot.id)}`);
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

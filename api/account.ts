// /api/account — the signed-in account itself.
//
//   DELETE { tokens? } → delete the account and everything stored under it (authed)
//
// Deleting is final, so it happens in an order that leaves nobody worse off
// for a failure part-way. Stripe goes first: a subscription that cannot be
// cancelled stops the whole thing with nothing deleted, because an account
// that is gone while its card is still being charged is the one outcome worse
// than an account that is still there. The database goes second, in one
// transaction, so it is all or nothing.
//
// `tokens` are the links the account's own data says it sent — signing,
// profile and viewer links. Those made before the server recorded who made
// them name no account (see _lib/tokenOwnership), and only the account's own
// encrypted data can say they were its. A named token is removed only where no
// other account owns it, which is no more than anyone holding the link could
// already do through DELETE /api/sign.
import type { InStatement } from '@libsql/client/web';
import { authorize } from './_lib/auth';
import { ensureSchema, getDb } from './_lib/db';
import { handleError, json } from './_lib/http';
import { BillingNotConfiguredError, stripe, StripeError, type StripeSubscription } from './_lib/stripe';

// Far past what a producer sends in years, and a bound on one request's work.
const MAX_NAMED_TOKENS = 5000;
// Placeholders per statement, well inside SQLite's limit.
const TOKENS_PER_STATEMENT = 200;

/** Statuses of a subscription that has stopped for good and can charge nothing more. */
const ENDED_STATUSES = new Set(['canceled', 'incomplete_expired']);

/** The links named in the body, or null when the body is not a list of them. */
async function namedTokens(req: Request): Promise<string[] | null> {
  const text = await req.text();
  if (!text) return [];
  let body: { tokens?: unknown };
  try {
    body = JSON.parse(text) as { tokens?: unknown };
  } catch {
    return null;
  }
  const tokens = body?.tokens ?? [];
  if (
    !Array.isArray(tokens) || tokens.length > MAX_NAMED_TOKENS ||
    tokens.some((t) => typeof t !== 'string' || t.length === 0 || t.length > 128)
  ) {
    return null;
  }
  return [...new Set(tokens as string[])];
}

/** Stripe's answer, or null when it has no such object (removed in the dashboard, say). */
async function unlessMissing<T>(request: Promise<T>): Promise<T | null> {
  try {
    return await request;
  } catch (err) {
    if (err instanceof StripeError && err.code === 'resource_missing') return null;
    throw err;
  }
}

/**
 * Cancel, straight away, every subscription the account could still be
 * charged for: the one its row names, and anything else on its customer —
 * a second checkout from before customers were pinned, say — and close any
 * checkout still open on that customer.
 */
async function cancelSubscriptions(userId: string): Promise<void> {
  const result = await getDb().execute({
    sql: `SELECT customer_id, subscription_id, status FROM subscription WHERE user_id = ?`,
    args: [userId],
  });
  if (result.rows.length === 0) return;
  const [customerId, subscriptionId, status] = Array.from(result.rows[0]).map((v) => (v == null ? null : String(v)));

  // Without Stripe keys nothing can be checked or cancelled. That only stops
  // the deletion when the row says something may still be charging.
  if (!process.env.STRIPE_SECRET_KEY) {
    if (status && !ENDED_STATUSES.has(status)) throw new BillingNotConfiguredError();
    return;
  }

  const subs: StripeSubscription[] = [];
  if (customerId) {
    // First, so nothing can be started behind the cancellations: a checkout
    // left open in another tab would otherwise go on to take payment for a
    // subscription whose account is gone, with no way left to cancel it.
    const open = await unlessMissing(stripe<{ data: { id: string }[] }>(
      'GET',
      `/checkout/sessions?customer=${encodeURIComponent(customerId)}&status=open&limit=100`,
    ));
    for (const session of open?.data ?? []) {
      await stripe('POST', `/checkout/sessions/${encodeURIComponent(session.id)}/expire`);
    }
    const list = await unlessMissing(stripe<{ data: StripeSubscription[] }>(
      'GET',
      `/subscriptions?customer=${encodeURIComponent(customerId)}&status=all&limit=100`,
    ));
    subs.push(...(list?.data ?? []));
  }
  if (subscriptionId && !subs.some((sub) => sub.id === subscriptionId)) {
    const sub = await unlessMissing(stripe<StripeSubscription>('GET', `/subscriptions/${encodeURIComponent(subscriptionId)}`));
    if (sub) subs.push(sub);
  }
  for (const sub of subs) {
    if (!ENDED_STATUSES.has(sub.status)) await stripe('DELETE', `/subscriptions/${encodeURIComponent(sub.id)}`);
  }
}

/**
 * Every row the account owns, in every table. What hangs off a link goes
 * before the link row that says whose it is. The users row goes last.
 */
function deletions(userId: string, tokens: string[]): InStatement[] {
  const statements: InStatement[] = [
    { sql: `DELETE FROM sign_doc WHERE token IN (SELECT token FROM sign_request WHERE user_id = ?)`, args: [userId] },
    { sql: `DELETE FROM profile_photo WHERE token IN (SELECT token FROM sign_request WHERE user_id = ?)`, args: [userId] },
    { sql: `DELETE FROM sign_request WHERE user_id = ?`, args: [userId] },
    { sql: `DELETE FROM live_media WHERE token IN (SELECT token FROM live_view WHERE user_id = ?)`, args: [userId] },
    { sql: `DELETE FROM live_view WHERE user_id = ?`, args: [userId] },
  ];
  // The account's own rows are gone by now, so "owned by anyone" below means
  // owned by somebody else.
  for (let i = 0; i < tokens.length; i += TOKENS_PER_STATEMENT) {
    const group = tokens.slice(i, i + TOKENS_PER_STATEMENT);
    const list = group.map(() => '?').join(', ');
    statements.push(
      { sql: `DELETE FROM sign_doc WHERE token IN (${list}) AND token NOT IN (SELECT token FROM sign_request WHERE user_id IS NOT NULL)`, args: group },
      { sql: `DELETE FROM profile_photo WHERE token IN (${list}) AND token NOT IN (SELECT token FROM sign_request WHERE user_id IS NOT NULL)`, args: group },
      { sql: `DELETE FROM sign_request WHERE token IN (${list}) AND user_id IS NULL`, args: group },
      { sql: `DELETE FROM live_media WHERE token IN (${list}) AND token NOT IN (SELECT token FROM live_view WHERE user_id IS NOT NULL)`, args: group },
      { sql: `DELETE FROM live_view WHERE token IN (${list}) AND user_id IS NULL`, args: group },
    );
  }
  for (const table of ['user_media', 'user_shows', 'user_shows_backup', 'user_settings', 'user_settings_backup', 'subscription']) {
    statements.push({ sql: `DELETE FROM ${table} WHERE user_id = ?`, args: [userId] });
  }
  // The sign-in throttles are filed under the account's id too.
  for (const prefix of [`auth:${userId}:`, `authz:${userId}:`]) {
    statements.push({ sql: `DELETE FROM rate_limit WHERE substr(bucket, 1, length(?)) = ?`, args: [prefix, prefix] });
  }
  statements.push({ sql: `DELETE FROM users WHERE id = ?`, args: [userId] });
  return statements;
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'DELETE') return json({ error: 'method_not_allowed' }, 405);
  try {
    await ensureSchema();
    const userId = await authorize(req);
    if (!userId) return json({ error: 'unauthorized' }, 401);
    const tokens = await namedTokens(req);
    if (!tokens) return json({ error: 'bad_request' }, 400);

    await cancelSubscriptions(userId);
    await getDb().batch(deletions(userId, tokens), 'write');
    return json({ ok: true });
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

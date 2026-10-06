// Stripe over plain HTTPS: the REST API is form-encoded requests and JSON
// responses, which fetch handles in a few lines. The official SDK is a large
// Node-only dependency, and these routes run on the edge. Not a route.

const API = 'https://api.stripe.com/v1';

export class BillingNotConfiguredError extends Error {
  constructor() {
    super('Billing is not configured on this server.');
    this.name = 'BillingNotConfiguredError';
  }
}

/** True when the server holds everything checkout needs. */
export function isBillingConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PRICE_ID);
}

/**
 * Flatten nested params into Stripe's bracket form:
 * { subscription_data: { metadata: { user_id: 'u' } } } →
 * subscription_data[metadata][user_id]=u
 */
export function encodeForm(params: Record<string, unknown>, prefix = ''): string[] {
  const out: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    const name = prefix ? `${prefix}[${key}]` : key;
    if (Array.isArray(value)) {
      value.forEach((item, i) => {
        if (item && typeof item === 'object') out.push(...encodeForm(item as Record<string, unknown>, `${name}[${i}]`));
        else out.push(`${encodeURIComponent(`${name}[${i}]`)}=${encodeURIComponent(String(item))}`);
      });
    } else if (typeof value === 'object') {
      out.push(...encodeForm(value as Record<string, unknown>, name));
    } else {
      out.push(`${encodeURIComponent(name)}=${encodeURIComponent(String(value))}`);
    }
  }
  return out;
}

export async function stripe<T>(method: 'GET' | 'POST', path: string, params?: Record<string, unknown>): Promise<T> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new BillingNotConfiguredError();
  const body = params ? encodeForm(params).join('&') : undefined;
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${key}`,
      ...(body ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
    },
    body,
  });
  const data = (await res.json()) as T & { error?: { message?: string } };
  if (!res.ok) throw new Error(`Stripe ${path}: ${data.error?.message ?? res.status}`);
  return data;
}

function hex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Compared in full every time, so how long a wrong signature takes to refuse
// says nothing about how much of it was right.
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Check a webhook's Stripe-Signature header against the raw body, the way
 * Stripe's SDK does: HMAC-SHA256 of "<timestamp>.<body>" with the endpoint
 * secret, and a timestamp no older than `toleranceSeconds` so a captured
 * request can't be replayed later.
 */
export async function verifyStripeSignature(
  payload: string,
  header: string | null,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
  toleranceSeconds = 300,
): Promise<boolean> {
  if (!header) return false;
  const parts = header.split(',').map((p) => p.trim().split('='));
  const timestamp = Number(parts.find(([k]) => k === 't')?.[1]);
  const signatures = parts.filter(([k]) => k === 'v1').map(([, v]) => v ?? '');
  if (!Number.isFinite(timestamp) || signatures.length === 0) return false;
  if (Math.abs(nowSeconds - timestamp) > toleranceSeconds) return false;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const expected = hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${payload}`)));
  return signatures.some((sig) => constantTimeEqual(sig, expected));
}

/** Statuses that keep paid features on. past_due is Stripe retrying a card, not a cancellation. */
const PAID_STATUSES = new Set(['active', 'trialing', 'past_due']);

export function isPaidStatus(status: string | null | undefined): boolean {
  return Boolean(status && PAID_STATUSES.has(status));
}

export interface StripeSubscription {
  id: string;
  customer: string;
  status: string;
  metadata?: Record<string, string>;
  /** Top-level on older API versions; moved onto each item in 2025. */
  current_period_end?: number;
  items?: { data?: { current_period_end?: number }[] };
}

export function periodEnd(sub: StripeSubscription): number | null {
  return sub.current_period_end ?? sub.items?.data?.[0]?.current_period_end ?? null;
}

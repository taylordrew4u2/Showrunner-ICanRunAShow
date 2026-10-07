// The browser's side of /api/billing. Card details are never handled here:
// checkout and the portal are Stripe-hosted pages the app hands off to.
import { api } from './api';
import type { SessionCredentials } from './session-vault';

export type Plan = 'free' | 'producer';

export interface BillingState {
  /** False until the server has Stripe keys; the plan card says so rather than offering a button that can't work. */
  configured: boolean;
  plan: Plan;
  /** Signed up before subscriptions existed: every Producer feature, free, for good. */
  founder?: boolean;
  status: string | null;
  renewsAt: string | null;
  /** Whether there's a Stripe customer to open the portal for. */
  canManage: boolean;
}

/**
 * Whether the Producer features are actually held back from free accounts.
 * Off: everything stays open to everyone, so the plan card must not describe
 * them as things you only get by paying. Turn this on together with the
 * checks that hold them back, never before.
 */
export const PAID_FEATURES_LOCKED = true;

/** What the plan costs, as the sales page and the plan card both say it. */
export const PRODUCER_PRICE_LABEL = '$9/month';

const auth = (creds: SessionCredentials) => ({ authUserId: creds.userId, authHash: creds.authHash });

export function loadBilling(creds: SessionCredentials): Promise<BillingState> {
  return api.get<BillingState>('/api/billing', auth(creds));
}

export async function startCheckout(creds: SessionCredentials): Promise<string> {
  return (await api.post<{ url: string }>('/api/billing', { action: 'checkout' }, auth(creds))).url;
}

export async function openBillingPortal(creds: SessionCredentials): Promise<string> {
  return (await api.post<{ url: string }>('/api/billing', { action: 'portal' }, auth(creds))).url;
}

/** Stripe sends the producer back with ?billing=success or ?billing=cancelled. */
export function billingReturn(search: string): 'success' | 'cancelled' | null {
  const value = new URLSearchParams(search).get('billing');
  return value === 'success' || value === 'cancelled' ? value : null;
}

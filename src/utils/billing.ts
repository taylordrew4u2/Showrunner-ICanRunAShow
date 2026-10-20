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
  /** When a subscription that was cancelled but is still paid for stops; renewsAt is null then. */
  endsAt?: string | null;
  /** Whether there's a subscription to open the Stripe portal for. */
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

/**
 * Whether coming back to the app is a reason to look at the plan again.
 *
 * After this page sent the producer to Stripe, yes. Neither checkout nor the
 * billing portal reliably comes back through ?billing=success: the producer
 * can simply come Back, or finish somewhere this session isn't signed in and
 * switch back. In the iOS shell, also whenever the account is on the free
 * plan, since nothing in the app takes payment there and an upgrade can only
 * have happened on the web meanwhile.
 * Otherwise nothing will have changed, so there's nothing to ask.
 */
export function shouldRecheckPlan({ sentToStripe, nativeShell, freePlan }: {
  sentToStripe: boolean;
  nativeShell: boolean;
  /** Known to be on the free plan, with Stripe set up. */
  freePlan: boolean;
}): boolean {
  return sentToStripe || (nativeShell && freePlan);
}

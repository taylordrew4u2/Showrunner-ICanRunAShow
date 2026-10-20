import { useEffect, useRef, useState } from 'react';
import type { ApiError } from '../utils/api';
import { PAID_FEATURES_LOCKED, PRODUCER_PRICE_LABEL, shouldRecheckPlan, type BillingState } from '../utils/billing';
import { isNativeShell } from '../utils/nativeShell';
import { onPageReturn } from '../utils/pageReturn';

export interface BillingActions {
  load: () => Promise<BillingState>;
  checkout: () => Promise<string>;
  portal: () => Promise<string>;
  /** Set when Stripe has just sent the producer back from checkout. */
  returned?: 'success' | 'cancelled' | null;
}

// Exactly what ProducerLock holds back — keep the two lists in step.
const PRODUCER_PERKS = [
  'Send contracts for e-signing',
  'Read a schedule off a photo or PDF',
  'A live link for your audience',
  'The Season report and venue pitch',
  'Pair a Bluetooth stage remote',
];

function renewLabel(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? null
    : date.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
}

/**
 * The producer's plan, and the one button that changes it. Payment happens on
 * Stripe's own pages; this card only ever sends the producer there and reads
 * back what Stripe reported.
 *
 * Not in the iOS app, though. App Store guideline 3.1.1 keeps it from selling
 * the plan any way but Apple's, so there the card only says which plan this
 * is: no price, no checkout, no billing portal, nothing that links out.
 */
export function PlanCard({ load, checkout, portal, returned }: BillingActions) {
  const [state, setState] = useState<BillingState | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // When this card last sent the producer to Stripe, until a look at the plan
  // afterwards has settled it; and a count bumped to take that look. See App.
  const sentToStripeAt = useRef<number | null>(null);
  const [recheck, setRecheck] = useState(0);
  const native = isNativeShell();

  useEffect(() => {
    let cancelled = false;
    // Stripe's webhook usually lands before the redirect back does, but not
    // always. After a successful checkout, or back from one this card sent the
    // producer to, look again a few times rather than telling someone who
    // just paid that they're on the free plan.
    const awaiting = sentToStripeAt.current;
    const attempts = returned === 'success' || awaiting !== null ? 6 : 1;
    (async () => {
      for (let i = 0; i < attempts && !cancelled; i++) {
        try {
          const next = await load();
          if (cancelled) return;
          setState(next);
          setFailed(false);
          if (next.plan === 'producer') break;
        } catch {
          if (!cancelled) setFailed(true);
        }
        if (i < attempts - 1) await new Promise((r) => setTimeout(r, 2000));
      }
      if (!cancelled && sentToStripeAt.current === awaiting) sentToStripeAt.current = null;
    })();
    return () => { cancelled = true; };
  }, [load, returned, recheck]);

  // Stripe takes over the page and nothing comes back to say the producer is
  // done there. Being back here is the sign: the buttons work again, and the
  // plan is worth another look.
  const freePlan = !!state?.configured && state.plan !== 'producer';
  useEffect(() => onPageReturn(() => {
    setBusy(false);
    const sentToStripe = sentToStripeAt.current !== null;
    if (shouldRecheckPlan({ sentToStripe, nativeShell: isNativeShell(), freePlan })) setRecheck((n) => n + 1);
  }), [freePlan]);

  async function go(open: () => Promise<string>) {
    setBusy(true);
    setError('');
    try {
      const url = await open();
      sentToStripeAt.current = Date.now();
      window.location.assign(url);
    } catch (err) {
      // Stripe has a subscription this card hasn't heard about yet: a payment
      // that went through moments ago. Calling that a connection problem sent
      // the producer looking for another way to pay twice.
      setError((err as ApiError).code === 'already_subscribed'
        ? 'You already have a Producer subscription — Stripe is still confirming it. Check back in a minute.'
        : 'Couldn’t reach the payment page. Check your connection and try again.');
      setBusy(false);
    }
  }

  const founder = state?.founder === true;
  const paid = state?.plan === 'producer' && !founder;
  // Checkout was open to everyone for a day before founding members were
  // told apart, so some of them pay for a plan they already have for free.
  const founderStillPaying = founder && ['active', 'trialing', 'past_due'].includes(state?.status ?? '') && !state?.endsAt;
  const renews = renewLabel(state?.renewsAt ?? null);
  const ends = renewLabel(state?.endsAt ?? null);

  return (
    <div className="settings__card plan-card">
      <h2 className="settings__card-title">Plan</h2>

      {returned === 'success' && (
        <p className="plan-card__notice" role="status">
          {paid ? 'Thanks — you’re on the Producer plan.' : 'Payment received. Confirming with Stripe…'}
        </p>
      )}
      {returned === 'cancelled' && !paid && (
        <p className="settings__hint" role="status">Checkout was cancelled — nothing was charged.</p>
      )}

      {!state && !failed && <p className="settings__hint">Checking your plan…</p>}
      {!state && failed && (
        <p className="settings__hint">Couldn’t check your plan right now. Everything you have keeps working.</p>
      )}

      {state && founder && (
        <>
          <p className="plan-card__current">
            <span className="plan-card__name">Producer</span>
            <span className="plan-card__price">Founding member</span>
          </p>
          <p className="settings__hint">
            You were here before paid plans, so every Producer feature is yours free — for good.
            Thank you for being early.
          </p>
          {/* Inside the iOS app there is no billing link to point at (App
              Store guideline 3.1.1), so the note waits for the web. */}
          {founderStillPaying && !native && (
            <p className="settings__hint">
              You also have a Producer subscription you don’t need. Cancel it in Manage billing
              and you keep every feature.
            </p>
          )}
          {/* The portal is the only way out of that subscription, so a founder
              with one is never left without the button — on the web. */}
          {state.canManage && state.configured && !native && (
            <div className="settings__account-actions">
              <button className="btn btn--ghost" onClick={() => go(portal)} disabled={busy}>
                Manage billing
              </button>
            </div>
          )}
          {error && <p className="plan-card__error" role="alert">{error}</p>}
        </>
      )}

      {state && !founder && (
        <>
          <p className="plan-card__current">
            <span className="plan-card__name">{paid ? 'Producer' : 'Open Mic'}</span>
            {!(paid && native) && (
              <span className="plan-card__price">{paid ? PRODUCER_PRICE_LABEL : 'Free'}</span>
            )}
          </p>
          {paid && (
            <p className="settings__hint">
              {state.status === 'past_due'
                ? 'Your last payment didn’t go through. Stripe will retry — update your card to keep the Producer plan.'
                : ends
                  ? `Cancelled — you keep the Producer plan until ${ends}.`
                  : renews
                    ? `Renews ${renews}.`
                    : 'Active.'}
            </p>
          )}
          {!paid && PAID_FEATURES_LOCKED && (
            <ul className="plan-card__perks">
              {PRODUCER_PERKS.map((perk) => <li key={perk}>{perk}</li>)}
            </ul>
          )}
          {!paid && !PAID_FEATURES_LOCKED && state.configured && (
            <p className="settings__hint">
              Every feature is open to everyone during early access. Subscribing to Producer
              supports the app and keeps it independent and ad-free.
            </p>
          )}
          {!paid && !state.configured && (
            <p className="settings__hint">Paid plans aren’t open yet — everything is free during early access.</p>
          )}
          <div className="settings__account-actions">
            {!paid && state.configured && !native && (
              <button className="btn btn--primary" onClick={() => go(checkout)} disabled={busy}>
                {busy ? 'Opening checkout…' : `Upgrade to Producer — ${PRODUCER_PRICE_LABEL}`}
              </button>
            )}
            {state.canManage && state.configured && !native && (
              <button className="btn btn--ghost" onClick={() => go(portal)} disabled={busy}>
                Manage billing
              </button>
            )}
          </div>
          {error && <p className="plan-card__error" role="alert">{error}</p>}
          {!paid && state.configured && !native && (
            <p className="settings__hint">Secure checkout by Stripe. Cancel anytime from Manage billing.</p>
          )}
          {!paid && state.configured && native && PAID_FEATURES_LOCKED && (
            <p className="settings__hint">Producer features are part of a Producer plan.</p>
          )}
        </>
      )}
    </div>
  );
}

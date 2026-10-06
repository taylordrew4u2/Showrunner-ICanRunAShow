import { useEffect, useState } from 'react';
import { PAID_FEATURES_LOCKED, PRODUCER_PRICE_LABEL, type BillingState } from '../utils/billing';

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
 */
export function PlanCard({ load, checkout, portal, returned }: BillingActions) {
  const [state, setState] = useState<BillingState | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    // Stripe's webhook usually lands before the redirect back does, but not
    // always. After a successful checkout, look again a few times rather than
    // telling someone who just paid that they're on the free plan.
    const attempts = returned === 'success' ? 6 : 1;
    (async () => {
      for (let i = 0; i < attempts && !cancelled; i++) {
        try {
          const next = await load();
          if (cancelled) return;
          setState(next);
          setFailed(false);
          if (next.plan === 'producer') return;
        } catch {
          if (!cancelled) setFailed(true);
        }
        if (i < attempts - 1) await new Promise((r) => setTimeout(r, 2000));
      }
    })();
    return () => { cancelled = true; };
  }, [load, returned]);

  async function go(open: () => Promise<string>) {
    setBusy(true);
    setError('');
    try {
      window.location.assign(await open());
    } catch {
      setError('Couldn’t reach the payment page. Check your connection and try again.');
      setBusy(false);
    }
  }

  const paid = state?.plan === 'producer';
  const renews = renewLabel(state?.renewsAt ?? null);

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

      {state && (
        <>
          <p className="plan-card__current">
            <span className="plan-card__name">{paid ? 'Producer' : 'Open Mic'}</span>
            <span className="plan-card__price">{paid ? PRODUCER_PRICE_LABEL : 'Free'}</span>
          </p>
          {paid && (
            <p className="settings__hint">
              {state.status === 'past_due'
                ? 'Your last payment didn’t go through. Stripe will retry — update your card to keep the Producer plan.'
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
            {!paid && state.configured && (
              <button className="btn btn--primary" onClick={() => go(checkout)} disabled={busy}>
                {busy ? 'Opening checkout…' : `Upgrade to Producer — ${PRODUCER_PRICE_LABEL}`}
              </button>
            )}
            {state.canManage && state.configured && (
              <button className="btn btn--ghost" onClick={() => go(portal)} disabled={busy}>
                Manage billing
              </button>
            )}
          </div>
          {error && <p className="plan-card__error" role="alert">{error}</p>}
          {!paid && state.configured && (
            <p className="settings__hint">Secure checkout by Stripe. Cancel anytime from Manage billing.</p>
          )}
        </>
      )}
    </div>
  );
}

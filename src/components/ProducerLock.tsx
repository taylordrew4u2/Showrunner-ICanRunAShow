import { useEffect, useState } from 'react';
import { PRODUCER_PRICE_LABEL } from '../utils/billing';
import { isNativeShell } from '../utils/nativeShell';
import { onPageReturn } from '../utils/pageReturn';
import { useProducerAccess } from '../utils/producerAccess';

/**
 * Said in place of a Producer-only control on the free plan: what it is, what
 * the plan costs, and the one button that gets it. Never a dead, greyed-out
 * button with no explanation.
 *
 * In the iOS app it only says what the feature is part of. App Store guideline
 * 3.1.1 keeps the app from selling the plan any way but Apple's, so there's no
 * price there and no button that leads off to pay.
 */
export function ProducerLock({ feature, compact = false }: { feature: string; compact?: boolean }) {
  const { upgrade } = useProducerAccess();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const native = isNativeShell();

  // Checkout takes over the page and nothing comes back to say the producer
  // is done there; being back here is the sign the button should work again.
  useEffect(() => onPageReturn(() => setBusy(false)), []);

  async function go() {
    setBusy(true);
    setFailed(false);
    try {
      await upgrade();
    } catch {
      setFailed(true);
      setBusy(false);
    }
  }

  return (
    <div className={`producer-lock${compact ? ' producer-lock--compact' : ''}`} role="note">
      <p className="producer-lock__text">
        <span className="producer-lock__badge">Producer</span>
        {native
          ? `${feature} is part of the Producer plan.`
          : `${feature} is part of the Producer plan — ${PRODUCER_PRICE_LABEL}.`}
      </p>
      {!native && (
        <button type="button" className="btn btn--primary btn--sm" onClick={go} disabled={busy}>
          {busy ? 'Opening checkout…' : 'Upgrade'}
        </button>
      )}
      {failed && (
        <p className="producer-lock__error" role="alert">
          Couldn’t reach the payment page. Check your connection and try again.
        </p>
      )}
    </div>
  );
}

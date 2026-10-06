import { createContext, useContext } from 'react';

export interface ProducerAccess {
  /** True only when this account is known to be on the free plan with paid features held back. */
  locked: boolean;
  /** Send the producer to Stripe checkout for the Producer plan. */
  upgrade: () => Promise<void>;
}

// Unlocked by default: a screen rendered outside the provider (a test, the
// public viewer) and an account whose plan couldn't be checked both keep every
// feature. Locking someone out because the venue wifi dropped mid-show would
// be the worst way for this to fail.
const ProducerContext = createContext<ProducerAccess>({ locked: false, upgrade: async () => {} });

export const ProducerProvider = ProducerContext.Provider;

export function useProducerAccess(): ProducerAccess {
  return useContext(ProducerContext);
}

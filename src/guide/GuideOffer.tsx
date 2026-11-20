/**
 * The offer on the Shows list: a tour and the setup page, for a new account.
 *
 * Offered, never forced. It is one line in the page, under the title: it
 * takes no focus, covers nothing, and goes for good on this device once it
 * is dismissed or the Help page has been opened.
 */
import { useGuide } from './GuideContext';
import { resumeStepId, stepNumber } from './tourEngine';
import './guide.css';

export function GuideOffer({ showCount, onOpenHelp }: { showCount: number; onOpenHelp: () => void }) {
  const guide = useGuide();
  const { state } = guide;
  const paused = state.tour.status === 'paused';
  const offered = guide.enabled
    && guide.session === null
    && !guide.closedNote
    && state.offer !== 'dismissed'
    && (state.tour.status === 'new' || paused)
    // A new account, or one with nothing in it yet. An account that already
    // has shows, signed in on a new device, is not offered anything.
    && (state.offer === 'show' || showCount === 0);
  if (!offered) return null;

  return (
    <aside className="guide-offer" aria-label="Getting started">
      <p className="guide-offer__text">
        {paused
          ? `You stopped the tour at step ${stepNumber(resumeStepId(state.tour.stepId), false).n}.`
          : 'New here? Take a five-minute tour on a sample show, or open the step-by-step setup.'}
      </p>
      <div className="guide-offer__actions">
        <button
          type="button"
          className="btn btn--secondary btn--sm"
          onClick={() => { if (paused) guide.resumeTour(); else void guide.startTour(); }}
        >
          {paused ? 'Pick up the tour' : 'Take the tour'}
        </button>
        <button type="button" className="btn btn--ghost btn--sm" onClick={onOpenHelp}>Help &amp; setup</button>
        <button type="button" className="guide-offer__close" onClick={guide.dismissOffer} aria-label="Dismiss the tour offer">
          ×
        </button>
      </div>
    </aside>
  );
}

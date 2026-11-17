import { mainOrigin } from '../../coproducer/origins';
import './coproducer.css';

export type CoproduceGateState = 'loading' | 'missing' | 'ended' | 'unreadable' | 'offline' | 'wrong-place';

const COPY: Record<Exclude<CoproduceGateState, 'loading'>, { title: string; text: string }> = {
  missing: {
    title: 'This link is incomplete',
    text: 'Open the full link you were sent. It ends with #t= and a long code.',
  },
  ended: {
    title: 'This co-producer link has ended',
    text: 'The owner withdrew it or it expired. Ask them for a new link if you still need access.',
  },
  unreadable: {
    title: "This link can't open the account any more",
    text: 'Ask the owner for a new link.',
  },
  offline: {
    title: "Couldn't open the shared account",
    text: 'Check your connection and try again.',
  },
  'wrong-place': {
    title: 'This address only opens co-producer links',
    text: 'To use your own account, go to I Can Run A Show.',
  },
};

/**
 * What a co-producer link shows instead of the app: while it opens, and when
 * it cannot (the link is cut short, withdrawn, expired, unreadable, or the
 * connection is down). Never the sign-in: this page opens someone else's
 * account through the link and nothing else.
 */
export function CoproduceGate({ state, onRetry }: { state: CoproduceGateState; onRetry?: () => void }) {
  if (state === 'loading') {
    return (
      <div className="app">
        <div className="app-loading" role="status" aria-live="polite" aria-label="Opening the shared account…">
          <div className="app-loading__skeletons" aria-hidden="true">
            <div className="skeleton-tile-row">
              <div className="skeleton skeleton--tile" />
              <div className="skeleton skeleton--tile" />
            </div>
            <div className="skeleton skeleton--bar" />
            <div className="skeleton skeleton--card" />
            <div className="skeleton skeleton--card" />
            <div className="skeleton skeleton--card" />
          </div>
        </div>
      </div>
    );
  }
  const copy = COPY[state];
  return (
    <div className="app">
      <div className="app-loading">
        <div className="app-loading__skeletons">
          <div className="empty-state" role="alert">
            <h2 className="empty-state__title">{copy.title}</h2>
            <p className="empty-state__text">{copy.text}</p>
            <div className="empty-state__actions">
              {state === 'offline' ? (
                onRetry && (
                  <button type="button" className="btn btn--primary" onClick={onRetry}>
                    Try again
                  </button>
                )
              ) : (
                <a className="btn btn--primary" href={`${mainOrigin()}/`}>
                  Go to I Can Run A Show
                </a>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

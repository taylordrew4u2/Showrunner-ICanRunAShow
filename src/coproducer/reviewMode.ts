/**
 * Co-producer view: the app showing another producer the owner's account,
 * where everything they change, share or download becomes a request to the
 * owner.
 *
 * Entered once per page load, on the review origin's /coproduce, and left
 * only by navigating away, so the flag never changes under a mounted
 * component. Utilities read isReviewMode(); components read ReviewContext,
 * so a test can render them either way.
 *
 * Entering it closes three gates that do not import this module: the
 * network floor in api.ts (nothing but the co-producer route may be written
 * to), the delivery gate in gates.ts (no clipboard, share sheet, download or
 * print without an approval), and the media store's source (files are read
 * from and staged at the co-producer route).
 */
import { setReviewFloor } from '../utils/api';
import { setMediaSource } from '../utils/mediaStore';
import type { SessionCredentials } from '../utils/session-vault';
import { reviewMediaSource } from './client';
import { setDeliveryGate } from './gates';
import type { CoproducerClient, CoproducerSessionInfo } from './types';

export { ReviewModeBlockedError } from './errors';

export interface ReviewSession {
  token: string;
  linkId: string;
  /** The co-producer's own name, as the owner typed it. */
  label: string;
  expiresAt: string;
  producerLocked: boolean;
  client: CoproducerClient;
  /**
   * Stand-in credentials, so the app's many `if (!session)` checks pass and
   * every handler runs normally on the working copy. Never sent anywhere:
   * userId, authHash, key and legacyKey are all ''. The username is
   * `coproducer:<linkId>`, so anything this device files under a username
   * can never mix with an account's. Anything that reaches for the key
   * past a gate throws on the empty key rather than encrypting under it.
   */
  credentials: SessionCredentials;
}

let current: ReviewSession | null = null;

export function makeReviewSession(token: string, info: CoproducerSessionInfo, client: CoproducerClient): ReviewSession {
  return {
    token,
    linkId: info.link.id,
    label: info.link.label,
    expiresAt: info.link.expiresAt,
    producerLocked: info.producerLocked,
    client,
    credentials: { username: `coproducer:${info.link.id}`, userId: '', authHash: '', key: '', legacyKey: '' },
  };
}

export function enterReviewMode(session: ReviewSession): void {
  current = session;
  setReviewFloor(true);
  setDeliveryGate(true);
  setMediaSource(reviewMediaSource(session.client));
  if (typeof document !== 'undefined') document.documentElement.classList.add('review-mode');
}

export function isReviewMode(): boolean {
  return current !== null;
}

export function getReviewSession(): ReviewSession | null {
  return current;
}

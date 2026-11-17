/**
 * The app's own view of where co-producer links open (see originRules.ts for
 * the rules). Worked out from the page's address: on icanrunashow.com the
 * review origin is showrunner-theta.vercel.app, and a page on
 * showrunner-theta.vercel.app belongs to icanrunashow.com.
 *
 * VITE_COPRODUCE_ORIGIN and VITE_MAIN_ORIGIN, when set at build time,
 * override both, for the end-to-end tests that serve the two origins as
 * http://127.0.0.1 and http://localhost. A malformed override counts as none,
 * so links fail closed. Production sets neither.
 */
import {
  coproduceConfiguredAt,
  mainOriginAt,
  parseOriginSetting,
  reviewOriginAt,
  type OriginLocation,
} from './originRules';

function setting(value: unknown): string | null {
  try {
    return parseOriginSetting(typeof value === 'string' ? value : undefined);
  } catch {
    return null;
  }
}

function here(): OriginLocation {
  return { origin: location.origin, protocol: location.protocol, hostname: location.hostname };
}

/** The review origin, or '' when review mode runs on the app's own origin. */
export function reviewOrigin(): string {
  return reviewOriginAt(here(), setting(import.meta.env.VITE_COPRODUCE_ORIGIN));
}

/** The main app's origin: where "Go to I Can Run A Show" and leaving co-producer view go. */
export function mainOrigin(): string {
  return mainOriginAt(here(), setting(import.meta.env.VITE_MAIN_ORIGIN));
}

/** A review origin exists and this page is on it. */
export function onReviewOrigin(): boolean {
  const review = reviewOrigin();
  return review !== '' && location.origin === review;
}

/** Links can be made from this page: it has a review origin, or it is on localhost or 127.0.0.1. */
export function coproduceConfigured(): boolean {
  return coproduceConfiguredAt(here(), setting(import.meta.env.VITE_COPRODUCE_ORIGIN));
}

/**
 * Where the tour and the wizards remember things: this device, this account.
 *
 * Deliberately not an account setting. A settings field is a whole-blob save,
 * one of the "Earlier versions" slots and a possible save conflict, and where
 * someone stopped a tour is not worth any of that. So it lives in
 * localStorage under the username, is never sent to the server, and is not in
 * a backup. Losing it costs nothing: the guide just reads as never opened.
 */
import { isReviewMode } from '../coproducer/reviewMode';
import { normalizeUsername } from '../utils/session-vault';
import type { TourProgress } from './tourEngine';
import type { WizardId } from './wizards';

export interface GuideState {
  v: 1;
  /** 'show' is set once, when onboarding finishes on this device. */
  offer: 'unset' | 'show' | 'dismissed';
  tour: TourProgress;
  /** The wizard step the dock is showing. Never restored on a cold start. */
  wizard?: { id: WizardId; stepId: string };
  /** Which row is open on the Help page. */
  openWizard?: WizardId;
  /** Steps ticked by hand, where there is no data to tell from. */
  checked: Partial<Record<WizardId, string[]>>;
  /** Things only this device saw happen. */
  facts: { ranShow?: true };
}

export const EMPTY_GUIDE: GuideState = { v: 1, offer: 'unset', tour: { status: 'new' }, checked: {}, facts: {} };

const KEY_PREFIX = 'showrunner:guide:';

export function guideKey(username: string): string {
  return KEY_PREFIX + normalizeUsername(username);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const OFFERS = ['unset', 'show', 'dismissed'];
const STATUSES = ['new', 'active', 'paused', 'done'];

/** Whatever was stored, as a state the app can trust. Anything unreadable is the empty state. */
function parseGuide(raw: string | null): GuideState {
  if (!raw) return EMPTY_GUIDE;
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed) || parsed.v !== 1) return EMPTY_GUIDE;
  const tour = isRecord(parsed.tour) ? parsed.tour : {};
  const status = typeof tour.status === 'string' && STATUSES.includes(tour.status) ? tour.status as TourProgress['status'] : 'new';
  const checked: GuideState['checked'] = {};
  if (isRecord(parsed.checked)) {
    for (const [id, steps] of Object.entries(parsed.checked)) {
      if (Array.isArray(steps)) checked[id as WizardId] = steps.filter((step): step is string => typeof step === 'string');
    }
  }
  return {
    v: 1,
    offer: typeof parsed.offer === 'string' && OFFERS.includes(parsed.offer) ? parsed.offer as GuideState['offer'] : 'unset',
    tour: {
      // A tour left running is picked up by hand. It never reopens itself.
      status: status === 'active' ? 'paused' : status,
      ...(typeof tour.stepId === 'string' ? { stepId: tour.stepId } : {}),
    },
    ...(typeof parsed.openWizard === 'string' ? { openWizard: parsed.openWizard as WizardId } : {}),
    checked,
    facts: isRecord(parsed.facts) && parsed.facts.ranShow === true ? { ranShow: true } : {},
  };
}

export function readGuide(username: string): GuideState {
  try {
    return parseGuide(localStorage.getItem(guideKey(username)));
  } catch {
    return EMPTY_GUIDE;
  }
}

/** A failed write is ignored: the guide carries on from memory. Never written in co-producer view. */
export function writeGuide(username: string, state: GuideState): void {
  if (isReviewMode()) return;
  try {
    localStorage.setItem(guideKey(username), JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

/**
 * Drop what the guide remembers about an account that has been deleted, so
 * an account made later under the same name starts as never opened.
 */
export function forgetGuide(username: string): void {
  try {
    localStorage.removeItem(guideKey(username));
  } catch {
    /* ignore */
  }
}

/** Change one thing from outside the guide: onboarding marking the offer. */
export function updateGuide(username: string, change: (state: GuideState) => GuideState): void {
  writeGuide(username, change(readGuide(username)));
}

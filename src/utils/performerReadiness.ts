/**
 * Whether a performer's profile is complete enough to work with.
 *
 * Email and social handles describe profile completeness. Contracts are shared
 * by link, so recipients can supply their details when they open the form.
 * Missing contact details never prevent sharing a contract link.
 *
 * Nothing here writes: it reports on what is already saved.
 */

import { toHandle } from './socialPost';
import { isEmail } from './social';
import type { Performer } from '../types';

export type ReadinessGap = 'email' | 'social';

export interface PerformerReadiness {
  /** Contract links can be shared before the recipient supplies an email. */
  canSendContract: boolean;
  /** They can be tagged in the announcement. */
  canTag: boolean;
  /** What is missing, in the order worth chasing it. */
  gaps: ReadinessGap[];
  /** 0–100, for a completeness meter. */
  percent: number;
}

const GAP_LABELS: Record<ReadinessGap, string> = {
  email: 'Email',
  social: 'Social handle',
};

/**
 * Uses the same profile-completeness rule for Rolodex entries and performers.
 */
export function performerReadiness(
  performer: { email?: string; socialMedia?: string },
): PerformerReadiness {
  const canSendContract = true;
  const canTag = toHandle(performer.socialMedia) !== null;

  const gaps: ReadinessGap[] = [];
  if (!isEmail(performer.email)) gaps.push('email');
  if (!canTag) gaps.push('social');

  const filled = 2 - gaps.length;
  return { canSendContract, canTag, gaps, percent: Math.round((filled / 2) * 100) };
}

/** What to show a producer, e.g. "Email, Social handle". */
export function describeGaps(gaps: ReadinessGap[]): string {
  return gaps.map((gap) => GAP_LABELS[gap]).join(', ');
}

/**
 * Everyone on a lineup who is missing something, worst first.
 *
 * Profiles with more missing details come first, then names alphabetically.
 */
export function lineupGaps(performers: Performer[]): {
  performer: Performer;
  readiness: PerformerReadiness;
}[] {
  return performers
    .map((performer) => ({ performer, readiness: performerReadiness(performer) }))
    .filter((entry) => entry.readiness.gaps.length > 0)
    .sort((a, b) => {
      const gapDifference = b.readiness.gaps.length - a.readiness.gaps.length;
      if (gapDifference) return gapDifference;
      return a.performer.name.localeCompare(b.performer.name);
    });
}

/**
 * Whether a performer's profile is complete enough to work with.
 *
 * Two jobs depend on the profile rather than the booking: sending a contract
 * needs somewhere to send it, and announcing the show needs a handle to tag.
 * Both fail quietly — a contract that was never sent looks the same as one that
 * was never signed, and a missing tag is only noticed by the person who was
 * missed. So the gaps are named up front, before doors, while there is still
 * time to ask.
 *
 * Nothing here writes: it reports on what is already saved.
 */

import { toHandle } from './socialPost';
import { isEmail } from './social';
import type { Performer } from '../types';

export type ReadinessGap = 'email' | 'social';

export interface PerformerReadiness {
  /** A contract can be sent: there is an address to send it to. */
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
 * Takes only the two fields it reads, rather than a whole Performer, so a
 * Rolodex entry can be measured by the same rule as someone on a bill. The
 * question — can I contract them, can I tag them — is the same question in
 * both places, and it should not have two answers.
 */
export function performerReadiness(
  performer: { email?: string; socialMedia?: string },
): PerformerReadiness {
  const canSendContract = isEmail(performer.email);
  const canTag = toHandle(performer.socialMedia) !== null;

  const gaps: ReadinessGap[] = [];
  if (!canSendContract) gaps.push('email');
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
 * Sorted so the people who cannot be contracted at all come before the people
 * who merely cannot be tagged — one of those costs you a performer, the other
 * costs you a mention.
 */
export function lineupGaps(performers: Performer[]): {
  performer: Performer;
  readiness: PerformerReadiness;
}[] {
  return performers
    .map((performer) => ({ performer, readiness: performerReadiness(performer) }))
    .filter((entry) => entry.readiness.gaps.length > 0)
    .sort((a, b) => {
      if (a.readiness.canSendContract !== b.readiness.canSendContract) {
        return a.readiness.canSendContract ? 1 : -1;
      }
      return a.performer.name.localeCompare(b.performer.name);
    });
}

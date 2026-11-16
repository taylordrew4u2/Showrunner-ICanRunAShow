// Which plan an account is on, by the one rule GET /api/billing answers with,
// for the server's own checks on what the app holds back from free accounts.
import type { Client } from '@libsql/client';
import { PAID_FEATURES_LOCKED } from '../../src/utils/billing';
import { isBillingConfigured, isPaidStatus } from './stripe';

/**
 * When the Producer features started being held back (the lock shipped in
 * #317), in the users table's own UTC "YYYY-MM-DD HH:MM:SS" form. Accounts
 * made before it were promised a free app and keep every feature without
 * paying: they are founding members, on the Producer plan for good.
 */
export const SUBSCRIPTIONS_STARTED_AT = '2026-10-06 23:31:58';

export function isFoundingMember(createdAt: string | null): boolean {
  if (!createdAt) return false;
  // SQLite writes a space between date and time; tolerate the ISO "T" too so
  // a row written another way can't sort after the cutoff by accident.
  return createdAt.replace('T', ' ').slice(0, 19) < SUBSCRIPTIONS_STARTED_AT;
}

/**
 * Whether the app would show this account a Producer lock: the same three
 * things App.tsx asks (the locks are switched on, Stripe is set up, and the
 * plan /api/billing reports is not Producer), so nothing is held back here
 * that the app would let the producer do.
 */
export async function producerLocked(db: Client, userId: string): Promise<boolean> {
  if (!PAID_FEATURES_LOCKED || !isBillingConfigured()) return false;
  const rows = await db.execute({
    sql: `SELECT users.created_at, subscription.status FROM users
          LEFT JOIN subscription ON subscription.user_id = users.id WHERE users.id = ?`,
    args: [userId],
  });
  const row = rows.rows[0];
  const createdAt = row?.[0] != null ? String(row[0]) : null;
  const status = row?.[1] != null ? String(row[1]) : null;
  return !(isFoundingMember(createdAt) || isPaidStatus(status));
}

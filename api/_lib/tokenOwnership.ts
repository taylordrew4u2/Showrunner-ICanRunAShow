// Who may write under a token that is, by design, in other people's hands.
//
// A signing link is sent to the performer; a viewer link is handed to the
// whole room. Both carry their token in the URL, so "knows the token" is not
// evidence of being the producer — and signup is open, so "has an account" is
// not either. The routes that write under a token used to accept the two
// together, which let anyone a link was forwarded to revoke a contract,
// replace the document behind it, or wipe a show's soundboard mid-show.
//
// Ownership is the account that first wrote under the token. Rows made before
// ownership was recorded have none; the first authenticated write claims
// them, which is the same rule api/live.ts already uses for live_view — the
// producer is the only account writing under their own token at that point.
// Not a route (underscore-prefixed).
import type { Client } from '@libsql/client';

export type Ownership = 'free' | 'mine' | 'other';

async function ownership(db: Client, table: 'sign_request' | 'live_view', token: string, userId: string): Promise<Ownership> {
  const result = await db.execute({ sql: `SELECT user_id FROM ${table} WHERE token = ?`, args: [token] });
  if (result.rows.length === 0 || result.rows[0][0] == null) return 'free';
  return String(result.rows[0][0]) === userId ? 'mine' : 'other';
}

/** A signing or profile link's token: the request row says whose it is. */
export function signTokenOwnership(db: Client, token: string, userId: string): Promise<Ownership> {
  return ownership(db, 'sign_request', token, userId);
}

/** A viewer link's token: the published live state says whose it is. */
export function liveTokenOwnership(db: Client, token: string, userId: string): Promise<Ownership> {
  return ownership(db, 'live_view', token, userId);
}

/**
 * Create or replace a signing request under its owner. False when the token
 * belongs to another account, in which case nothing was written.
 *
 * Deliberately does not clear `signature` / `signed_at`: re-sending the same
 * token must never quietly erase an agreement someone already made.
 */
export async function upsertSignRequest(db: Client, token: string, userId: string, payload: string): Promise<boolean> {
  const result = await db.execute({
    sql: `INSERT INTO sign_request (token, user_id, payload) VALUES (?, ?, ?)
          ON CONFLICT(token) DO UPDATE SET
            payload = excluded.payload,
            user_id = excluded.user_id
          WHERE sign_request.user_id IS NULL OR sign_request.user_id = excluded.user_id`,
    args: [token, userId, payload],
  });
  return result.rowsAffected > 0;
}

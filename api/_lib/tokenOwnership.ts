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
// ownership was recorded have none: they are 'legacy'. A viewer link's row is
// claimed by the next authenticated publish (api/live.ts), because the board
// keeps publishing to the same token and the producer is the one doing it.
// A signing or profile link's row never is: every send makes a fresh token,
// so the producer never writes under an old one again, and the next account
// to try is the one the link was sent to. Not a route (underscore-prefixed).
import type { Client } from '@libsql/client';

/** 'free': no row names the token yet. 'legacy': a row does, but no account. */
export type Ownership = 'free' | 'mine' | 'other' | 'legacy';

async function ownership(db: Client, table: 'sign_request' | 'live_view', token: string, userId: string): Promise<Ownership> {
  const result = await db.execute({ sql: `SELECT user_id FROM ${table} WHERE token = ?`, args: [token] });
  if (result.rows.length === 0) return 'free';
  if (result.rows[0][0] == null) return 'legacy';
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
 * belongs to another account, or to none (a legacy row, which whoever holds
 * the link could otherwise rewrite and claim, shutting its producer out of
 * withdrawing it), in which case nothing was written.
 *
 * Deliberately does not clear `signature` / `signed_at`: re-sending the same
 * token must never quietly erase an agreement someone already made.
 */
export async function upsertSignRequest(db: Client, token: string, userId: string, payload: string): Promise<boolean> {
  const result = await db.execute({
    sql: `INSERT INTO sign_request (token, user_id, payload) VALUES (?, ?, ?)
          ON CONFLICT(token) DO UPDATE SET
            payload = excluded.payload
          WHERE sign_request.user_id = excluded.user_id`,
    args: [token, userId, payload],
  });
  return result.rowsAffected > 0;
}

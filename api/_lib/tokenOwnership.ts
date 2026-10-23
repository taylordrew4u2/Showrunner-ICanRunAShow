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
//
// "First wrote" counts the chunks too. A contract's document is uploaded
// before the request that names it — by every build, including ones still
// cached on phones — and a board can send its audio before its first publish
// lands, so until the link's own row exists, the chunks say whose the token
// is. They used to say nothing: any signed-in account could write under a
// token nobody had claimed, and every fresh token came with storage of its
// own. See _lib/linkStorage.ts for the allowance that replaced that.
import type { Client } from '@libsql/client';

/** 'free': nothing names the token yet. 'legacy': a row does, but no account. */
export type Ownership = 'free' | 'mine' | 'other' | 'legacy';

/**
 * The link's own row names the owner when it names anyone. Otherwise the
 * producer's chunks under the token do: on a token with no row yet, and on a
 * legacy viewer row a board has since sent audio under. Chunks stored before
 * chunks named anyone change nothing, so a token holding only those is as
 * free, or as legacy, as it always was.
 */
async function ownership(
  db: Client,
  table: 'sign_request' | 'live_view',
  chunks: 'sign_doc' | 'live_media',
  token: string,
  userId: string,
): Promise<Ownership> {
  const result = await db.execute({
    sql: `SELECT EXISTS (SELECT 1 FROM ${table} WHERE token = ?),
                 COALESCE(
                   (SELECT user_id FROM ${table} WHERE token = ?),
                   (SELECT user_id FROM ${chunks} WHERE token = ? AND user_id IS NOT NULL LIMIT 1))`,
    args: [token, token, token],
  });
  const [linked, owner] = Array.from(result.rows[0]);
  if (owner == null) return Number(linked) ? 'legacy' : 'free';
  return String(owner) === userId ? 'mine' : 'other';
}

/** A signing or profile link's token: the request row, else the document, says whose it is. */
export function signTokenOwnership(db: Client, token: string, userId: string): Promise<Ownership> {
  return ownership(db, 'sign_request', 'sign_doc', token, userId);
}

/** A viewer link's token: the published live state, else the audio, says whose it is. */
export function liveTokenOwnership(db: Client, token: string, userId: string): Promise<Ownership> {
  return ownership(db, 'live_view', 'live_media', token, userId);
}

/**
 * Create or replace a signing request under its owner. False when the token
 * belongs to another account, or to none (a legacy row, which whoever holds
 * the link could otherwise rewrite and claim, shutting its producer out of
 * withdrawing it), in which case nothing was written.
 *
 * A token with no request yet belongs to whoever uploaded its document. That
 * producer's request goes in; anyone else's is refused rather than taking
 * over a document they did not send.
 *
 * Deliberately does not clear `signature` / `signed_at`: re-sending the same
 * token must never quietly erase an agreement someone already made.
 */
export async function upsertSignRequest(db: Client, token: string, userId: string, payload: string): Promise<boolean> {
  // `user_id != ?` is never true of a chunk that names nobody, so a document
  // stored before chunks named anyone does not stand in the way.
  const result = await db.execute({
    sql: `INSERT INTO sign_request (token, user_id, payload)
          SELECT ?, ?, ?
           WHERE NOT EXISTS (SELECT 1 FROM sign_doc WHERE token = ? AND user_id != ?)
          ON CONFLICT(token) DO UPDATE SET
            payload = excluded.payload
          WHERE sign_request.user_id = excluded.user_id`,
    args: [token, userId, payload, token, userId],
  });
  return result.rowsAffected > 0;
}

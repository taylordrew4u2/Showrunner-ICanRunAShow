// /api/sign — one contract sent to one person for signature, addressed by an
// unguessable token.
//
// `payload` and `signature` arrive already encrypted by the client, so they are
// stored as the opaque strings they are — not JSON-encoded on the way in, which
// would wrap them in quotes the client's decrypt would choke on.
//
// The signer has no account. They hold a link and nothing else, so the server
// cannot hand them plaintext from the producer's vault, and cannot ask them to
// log in either. Same answer as /api/live-media: the producer's browser
// re-encrypts everything under a fresh per-request key, and that key lives only
// in the link's fragment (`#k=…`), which browsers never send to a server.
//
// So both `payload` (what the request is) and `signature` (who agreed, when)
// are ciphertext here. The one thing stored in the clear is `signed_at` — the
// server needs it to enforce that a request is signed exactly once, and the
// producer needs it to see status without decrypting every row.
//
//   GET    ?token=…              → { payload, signedAt, signature } (public)
//   PUT    { token, payload }    → create or replace a request (producer, authed)
//   POST   { token, signature }  → sign, once and only once (public)
//   DELETE ?token=…              → revoke (producer, authed)
import { authorize } from './_lib/auth';
import { ensureSchema, getDb } from './_lib/db';
import { exceedsSize, handleError, json, readJson, tooLarge } from './_lib/http';

// Both blobs are small records of a few fields. Capped well clear of any
// legitimate size, because POST is public: this is what an anonymous writer
// is allowed to put in the row.
const MAX_PAYLOAD_BYTES = 32 * 1024;
const MAX_SIGNATURE_BYTES = 32 * 1024;

function badToken(token: unknown): boolean {
  return typeof token !== 'string' || token.length < 16 || token.length > 128;
}

export default async function handler(req: Request): Promise<Response> {
  try {
    await ensureSchema();
    const db = getDb();

    // ── Public read: the signer opening their link ─────────────────────────
    if (req.method === 'GET') {
      const token = new URL(req.url).searchParams.get('token');
      if (badToken(token)) return json({ error: 'bad_request' }, 400);
      const result = await db.execute({
        sql: `SELECT payload, signature, signed_at FROM sign_request WHERE token = ?`,
        args: [token as string],
      });
      if (result.rows.length === 0) return json({ error: 'not_found' }, 404);
      const row = result.rows[0];
      return json({
        payload: String(row[0]),
        signature: row[1] === null ? null : String(row[1]),
        signedAt: row[2] === null ? null : String(row[2]),
      });
    }

    // ── Public write: signing ──────────────────────────────────────────────
    // Anonymous on purpose — the whole point is that the signer needs no
    // account. `WHERE signed_at IS NULL` is what makes it safe: a request can
    // be signed once, so a replayed or racing POST cannot overwrite the
    // agreement that is already on file.
    if (req.method === 'POST') {
      const { token, signature } = await readJson<{ token: string; signature: string }>(req);
      if (badToken(token) || typeof signature !== 'string' || signature.length === 0) {
        return json({ error: 'bad_request' }, 400);
      }
      if (exceedsSize(signature, MAX_SIGNATURE_BYTES)) return tooLarge();
      const result = await db.execute({
        sql: `UPDATE sign_request
                 SET signature = ?, signed_at = datetime('now')
               WHERE token = ? AND signed_at IS NULL`,
        args: [signature, token],
      });
      if (result.rowsAffected === 0) {
        // Either the request was revoked, or it is already signed. Both are
        // "you cannot sign this", and the signer's page reloads to show which.
        return json({ error: 'not_signable' }, 409);
      }
      return json({ ok: true });
    }

    // ── Producer writes ────────────────────────────────────────────────────
    const userId = await authorize(req);
    if (!userId) return json({ error: 'unauthorized' }, 401);

    if (req.method === 'PUT') {
      const { token, payload } = await readJson<{ token: string; payload: string }>(req);
      if (badToken(token) || typeof payload !== 'string' || payload.length === 0) {
        return json({ error: 'bad_request' }, 400);
      }
      if (exceedsSize(payload, MAX_PAYLOAD_BYTES)) return tooLarge();
      // Deliberately does not clear `signature` / `signed_at`: re-sending the
      // same token must never quietly erase an agreement someone already made.
      await db.execute({
        sql: `INSERT INTO sign_request (token, payload) VALUES (?, ?)
              ON CONFLICT(token) DO UPDATE SET payload = excluded.payload`,
        args: [token, payload],
      });
      return json({ ok: true });
    }

    if (req.method === 'DELETE') {
      const token = new URL(req.url).searchParams.get('token');
      if (badToken(token)) return json({ error: 'bad_request' }, 400);
      await db.execute({ sql: `DELETE FROM sign_request WHERE token = ?`, args: [token as string] });
      await db.execute({ sql: `DELETE FROM sign_doc WHERE token = ?`, args: [token as string] });
      return json({ ok: true });
    }

    return json({ error: 'method_not_allowed' }, 405);
  } catch (err) {
    return handleError(err);
  }
}

export const config = { runtime: 'edge' };

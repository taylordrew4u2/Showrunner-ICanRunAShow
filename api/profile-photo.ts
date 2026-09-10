// /api/profile-photo — the headshot a performer sends back through a profile
// link.
//
// This is the one route where an anonymous stranger writes chunks, so it is
// hemmed in on every side. A write needs a token the producer already made
// (`sign_request` row exists), and is refused once the link has been answered
// (`signed_at` set) — the once-only reply seals the photo with it. A token
// holds at most MAX_CHUNKS chunks, each capped, and a re-sent chunk replaces
// rather than adds, so the most one link can be made to store is a few
// megabytes. The bytes are ciphertext under the link's own key, which lives
// only in the fragment; the server stores a picture it cannot see.
//
// Reading is the producer's, and is authenticated. That is stricter than the
// contract document's public read, and deliberately so: a stranger's photo
// should not be fetchable by anyone holding a URL, even as ciphertext.
//
//   PUT    { token, seq, total, data }    → upsert one chunk (public, unanswered links only)
//   GET    ?token=…&seq=N                 → { data, total } (producer, authed)
//   DELETE ?token=…                       → drop the photo (producer, authed)
import { authorize } from './_lib/auth';
import { ensureSchema, getDb } from './_lib/db';
import { handleError, json, readJson, tooLarge } from './_lib/http';

// Matches the client's slice size before encryption; a 1400px headshot is
// one chunk. Four is headroom, not an invitation.
const MAX_CHUNK_CHARS = 3_500_000;
const MAX_CHUNKS = 4;

function badToken(token: unknown): boolean {
  return typeof token !== 'string' || token.length < 16 || token.length > 128;
}

export default async function handler(req: Request): Promise<Response> {
  try {
    await ensureSchema();
    const db = getDb();

    // ── Anonymous write: the performer sending their photo ─────────────────
    if (req.method === 'PUT') {
      const { token, seq, total, data } = await readJson<{
        token: string; seq: number; total: number; data: string;
      }>(req);
      if (
        badToken(token) ||
        !Number.isInteger(seq) || seq < 0 ||
        !Number.isInteger(total) || total < 1 || total > MAX_CHUNKS || seq >= total ||
        typeof data !== 'string' || data.length === 0
      ) {
        return json({ error: 'bad_request' }, 400);
      }
      if (data.length > MAX_CHUNK_CHARS) return tooLarge();

      // Only a link the producer made, and only while it is still open. A
      // photo arriving after the answer would be a photo nobody asked for.
      const link = await db.execute({
        sql: `SELECT signed_at FROM sign_request WHERE token = ?`,
        args: [token],
      });
      if (link.rows.length === 0) return json({ error: 'not_found' }, 404);
      if (link.rows[0][0] !== null) return json({ error: 'not_open' }, 409);

      await db.execute({
        sql: `INSERT INTO profile_photo (token, seq, total, data) VALUES (?, ?, ?, ?)
              ON CONFLICT(token, seq) DO UPDATE SET data = excluded.data, total = excluded.total`,
        args: [token, seq, total, data],
      });
      return json({ ok: true });
    }

    // ── Producer reads and tidies ──────────────────────────────────────────
    const userId = await authorize(req);
    if (!userId) return json({ error: 'unauthorized' }, 401);

    if (req.method === 'GET') {
      const url = new URL(req.url);
      const token = url.searchParams.get('token');
      const seq = Number(url.searchParams.get('seq'));
      if (badToken(token) || !Number.isInteger(seq) || seq < 0) return json({ error: 'bad_request' }, 400);
      const result = await db.execute({
        sql: `SELECT data, total FROM profile_photo WHERE token = ? AND seq = ?`,
        args: [token as string, seq],
      });
      if (result.rows.length === 0) return json({ error: 'not_found' }, 404);
      return json({ data: String(result.rows[0][0]), total: Number(result.rows[0][1]) });
    }

    if (req.method === 'DELETE') {
      const token = new URL(req.url).searchParams.get('token');
      if (badToken(token)) return json({ error: 'bad_request' }, 400);
      await db.execute({ sql: `DELETE FROM profile_photo WHERE token = ?`, args: [token as string] });
      return json({ ok: true });
    }

    return json({ error: 'method_not_allowed' }, 405);
  } catch (err) {
    return handleError(err);
  }
}

export const config = { runtime: 'edge' };

// /api/live — the live-viewer state an audience reads, keyed by a token.
//
//   GET  ?token=…           → { payload | null }   (public)
//   POST { token, payload } → upsert                (producer, authed)
//
// The token is public by design: it is the link handed to the room. That is
// exactly why it cannot also be the permission to write. Publishing used to be
// anonymous, so anyone holding a viewer link — an audience member, anyone they
// forwarded it to — could overwrite what the room's screen showed mid-show:
// the wrong performer on stage, or any text they liked.
//
// So writing is authenticated and scoped to the account that owns the token,
// while reading stays open to anyone with the link. /api/live-media, which
// carries the audio for the same viewer, was already arranged this way.
import { authorize } from './_lib/auth';
import { ensureSchema, getDb } from './_lib/db';
import { exceedsSize, handleError, json, readJson, tooLarge } from './_lib/http';

// The live payload is a small on-stage/up-next snapshot — cap it well clear of
// any legitimate size.
const MAX_PAYLOAD_BYTES = 64 * 1024;

export default async function handler(req: Request): Promise<Response> {
  try {
    await ensureSchema();
    const db = getDb();

    if (req.method === 'GET') {
      const token = new URL(req.url).searchParams.get('token');
      if (!token) return json({ error: 'bad_request' }, 400);
      const result = await db.execute({
        sql: `SELECT payload FROM live_view WHERE token = ?`,
        args: [token],
      });
      let payload: unknown = null;
      if (result.rows.length > 0) {
        try { payload = JSON.parse(String(result.rows[0][0])); } catch { payload = null; }
      }
      return json({ payload });
    }

    if (req.method === 'POST') {
      const userId = await authorize(req);
      if (!userId) return json({ error: 'unauthorized' }, 401);

      const { token, payload } = await readJson<{ token: string; payload: unknown }>(req);
      if (!token) return json({ error: 'bad_request' }, 400);
      if (exceedsSize(payload, MAX_PAYLOAD_BYTES)) return tooLarge();

      // The WHERE clause on the conflict is the ownership check: a token
      // already published by another account is left alone. `user_id IS NULL`
      // claims a row published before publishing required auth — only the
      // producer whose show it is can be publishing to that token.
      const result = await db.execute({
        sql: `INSERT INTO live_view (token, user_id, payload, updated_at)
              VALUES (?, ?, ?, datetime('now'))
              ON CONFLICT(token) DO UPDATE SET
                user_id = excluded.user_id,
                payload = excluded.payload,
                updated_at = excluded.updated_at
              WHERE live_view.user_id IS NULL OR live_view.user_id = excluded.user_id`,
        args: [token, userId, JSON.stringify(payload)],
      });
      // Nothing written means the row belongs to somebody else. Reported as
      // forbidden rather than a silent success, so a caller cannot mistake a
      // refused publish for a live page that is up to date.
      if (result.rowsAffected === 0) return json({ error: 'forbidden' }, 403);
      return json({ ok: true });
    }

    return json({ error: 'method_not_allowed' }, 405);
  } catch (err) {
    return handleError(err);
  }
}

export const config = { runtime: 'edge' };

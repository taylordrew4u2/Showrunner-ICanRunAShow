// /api/live — public live-viewer state, keyed by an unguessable token.
//   GET  ?token=…           → { payload | null }
//   POST { token, payload } → upsert
import { ensureSchema, getDb } from './_lib/db';
import { exceedsSize, handleError, json, readJson, tooLarge } from './_lib/http';

// The live payload is a small on-stage/up-next snapshot — cap it well clear of
// any legitimate size. This route is public (the viewer token is shared), so
// the cap limits what an anonymous POST can write.
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
      const { token, payload } = await readJson<{ token: string; payload: unknown }>(req);
      if (!token) return json({ error: 'bad_request' }, 400);
      if (exceedsSize(payload, MAX_PAYLOAD_BYTES)) return tooLarge();
      await db.execute({
        sql: `INSERT INTO live_view (token, payload, updated_at) VALUES (?, ?, datetime('now'))
              ON CONFLICT(token) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at`,
        args: [token, JSON.stringify(payload)],
      });
      return json({ ok: true });
    }

    return json({ error: 'method_not_allowed' }, 405);
  } catch (err) {
    return handleError(err);
  }
}

export const config = { runtime: 'edge' };

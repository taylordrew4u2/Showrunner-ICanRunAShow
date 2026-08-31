// /api/sign-doc — the contract PDF a signing link points at.
//
// Same chunked scheme as /api/live-media, and for the same reason: the reader
// is anonymous, so the bytes here are ciphertext under the per-request key from
// the link's fragment. The server stores a document it cannot open. One
// document per token, so there is no id — the token is the address.
//
//   GET    ?token=…&seq=N                 → { data, total } (public)
//   PUT    { token, seq, total, data }    → upsert one chunk (producer, authed)
//   DELETE ?token=…                       → drop the document (producer, authed)
import { authorize } from './_lib/auth';
import { ensureSchema, getDb } from './_lib/db';
import { handleError, json, tooLarge } from './_lib/http';

// Matches /api/media: the client slices at ~1.5M chars before encryption.
const MAX_CHUNK_CHARS = 3_500_000;
// A contract is a document, not a media library. 64 chunks is tens of
// megabytes of PDF — far past any real agreement, and a hard ceiling on what
// one token can be made to hold.
const MAX_CHUNKS = 64;

export default async function handler(req: Request): Promise<Response> {
  try {
    await ensureSchema();
    const db = getDb();

    // ── Public read ────────────────────────────────────────────────────────
    if (req.method === 'GET') {
      const url = new URL(req.url);
      const token = url.searchParams.get('token');
      const seq = Number(url.searchParams.get('seq'));
      if (!token || !Number.isInteger(seq) || seq < 0) return json({ error: 'bad_request' }, 400);
      const result = await db.execute({
        sql: `SELECT data, total FROM sign_doc WHERE token = ? AND seq = ?`,
        args: [token, seq],
      });
      if (result.rows.length === 0) return json({ error: 'not_found' }, 404);
      return json({ data: String(result.rows[0][0]), total: Number(result.rows[0][1]) });
    }

    // ── Producer writes ────────────────────────────────────────────────────
    const userId = await authorize(req);
    if (!userId) return json({ error: 'unauthorized' }, 401);

    if (req.method === 'PUT') {
      const body = (await req.json()) as {
        token?: string;
        seq?: number;
        total?: number;
        data?: string;
      };
      const { token, seq, total, data } = body;
      if (
        typeof token !== 'string' || token.length < 16 || token.length > 128 ||
        typeof seq !== 'number' || !Number.isInteger(seq) || seq < 0 ||
        typeof total !== 'number' || !Number.isInteger(total) || total < 1 || total > MAX_CHUNKS ||
        seq >= total ||
        typeof data !== 'string' || data.length === 0
      ) {
        return json({ error: 'bad_request' }, 400);
      }
      if (data.length > MAX_CHUNK_CHARS) return tooLarge();

      await db.execute({
        sql: `INSERT INTO sign_doc (token, seq, total, data) VALUES (?, ?, ?, ?)
              ON CONFLICT(token, seq) DO UPDATE SET
                data = excluded.data,
                total = excluded.total`,
        args: [token, seq, total, data],
      });
      return json({ ok: true });
    }

    if (req.method === 'DELETE') {
      const token = new URL(req.url).searchParams.get('token');
      if (!token) return json({ error: 'bad_request' }, 400);
      await db.execute({ sql: `DELETE FROM sign_doc WHERE token = ?`, args: [token] });
      return json({ ok: true });
    }

    return json({ error: 'method_not_allowed' }, 405);
  } catch (err) {
    return handleError(err);
  }
}

export const config = { runtime: 'edge' };

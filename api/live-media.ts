// /api/live-media — soundboard audio published to a show's live viewers, so
// the machine plugged into the PA can play the walk-ons instead of only the
// operator's device.
//
// This is the same chunked scheme as /api/media, with one difference that
// drives the whole design: the reader is anonymous. A viewer holds a share
// token and nothing else — no account, no password — so it can't use the
// per-user route, and the server can't hand it plaintext either.
//
// So the operator's browser re-encrypts each track under a fresh per-show key
// and uploads it here. That key lives only in the fragment of the viewer link
// (`#k=…`), which browsers never send to a server. The rows below are
// therefore ciphertext the server has no way to read, exactly like user_media.
//
//   PUT    { token, id, seq, total, data }  → upsert one chunk (operator, authed)
//   GET    ?token=…&id=…&seq=…              → { data, total } (public)
//   DELETE ?token=…                         → drop every chunk for a show (authed)
//
// Writes require a login so a stranger with the token can't push audio into
// someone's show; reads are open, because that's the point of a viewer link.
import { authorize } from './_lib/auth';
import { ensureSchema, getDb } from './_lib/db';
import { handleError, json, tooLarge } from './_lib/http';

// Matches /api/media: the client slices at ~1.5M chars before encryption.
const MAX_CHUNK_CHARS = 3_500_000;
const MAX_CHUNKS = 64;
// A board is a handful of walk-ons, not a library. Caps what one token can
// hold so a shared link can't be turned into free storage.
const MAX_TRACKS_PER_TOKEN = 60;

export default async function handler(req: Request): Promise<Response> {
  try {
    await ensureSchema();
    const db = getDb();

    // ── Public read ────────────────────────────────────────────────────────
    if (req.method === 'GET') {
      const url = new URL(req.url);
      const token = url.searchParams.get('token');
      const id = url.searchParams.get('id');
      const seq = Number(url.searchParams.get('seq'));
      if (!token || !id || !Number.isInteger(seq) || seq < 0) {
        return json({ error: 'bad_request' }, 400);
      }
      const result = await db.execute({
        sql: `SELECT data, total FROM live_media WHERE token = ? AND id = ? AND seq = ?`,
        args: [token, id, seq],
      });
      if (result.rows.length === 0) return json({ error: 'not_found' }, 404);
      return json({ data: String(result.rows[0][0]), total: Number(result.rows[0][1]) });
    }

    // ── Operator writes ────────────────────────────────────────────────────
    const userId = await authorize(req);
    if (!userId) return json({ error: 'unauthorized' }, 401);

    if (req.method === 'PUT') {
      const body = (await req.json()) as {
        token?: string;
        id?: string;
        seq?: number;
        total?: number;
        data?: string;
      };
      const { token, id, seq, total, data } = body;
      if (
        typeof token !== 'string' || token.length < 8 || token.length > 128 ||
        typeof id !== 'string' || id.length < 8 || id.length > 64 ||
        typeof seq !== 'number' || !Number.isInteger(seq) || seq < 0 ||
        typeof total !== 'number' || !Number.isInteger(total) || total < 1 || total > MAX_CHUNKS ||
        seq >= total ||
        typeof data !== 'string' || data.length === 0
      ) {
        return json({ error: 'bad_request' }, 400);
      }
      if (data.length > MAX_CHUNK_CHARS) return tooLarge();

      // Only count distinct tracks on the first chunk — the later chunks of a
      // track already under way must never trip the cap half-uploaded.
      if (seq === 0) {
        const count = await db.execute({
          sql: `SELECT COUNT(DISTINCT id) FROM live_media WHERE token = ? AND id != ?`,
          args: [token, id],
        });
        if (Number(count.rows[0][0]) >= MAX_TRACKS_PER_TOKEN) return tooLarge();
      }

      await db.execute({
        sql: `INSERT INTO live_media (token, id, seq, total, data)
              VALUES (?, ?, ?, ?, ?)
              ON CONFLICT(token, id, seq) DO UPDATE SET
                data = excluded.data,
                total = excluded.total`,
        args: [token, id, seq, total, data],
      });
      return json({ ok: true });
    }

    if (req.method === 'DELETE') {
      const token = new URL(req.url).searchParams.get('token');
      if (!token) return json({ error: 'bad_request' }, 400);
      await db.execute({ sql: `DELETE FROM live_media WHERE token = ?`, args: [token] });
      return json({ ok: true });
    }

    return json({ error: 'method_not_allowed' }, 405);
  } catch (err) {
    return handleError(err);
  }
}

export const config = { runtime: 'edge' };

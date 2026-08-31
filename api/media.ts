// /api/media — encrypted media blobs (walk-on music, etc.), chunked.
//
// Large audio can't ride inside the show payload: the platform caps request
// bodies (~4.5 MB) and the whole show set syncs together. Instead the client
// splits a file's data URL into slices, encrypts each slice with the same
// password-derived key as everything else, and stores them here. The show then
// carries only a tiny `media:<id>#<chunks>` reference. The server never sees
// plaintext.
//
//   PUT    { id, seq, total, data }  → upsert one encrypted chunk
//   GET    ?id=…&seq=…               → { data, total } for one chunk
//   DELETE ?id=…                     → remove all chunks of a media item
//
// Auth: same x-user-id / x-auth headers as the other per-user routes. Rows are
// keyed (user_id, id, seq), so ids can never collide or leak across accounts.
import { authorize } from './_lib/auth';
import { ensureSchema, getDb } from './_lib/db';
import { handleError, json, tooLarge } from './_lib/http';

// One encrypted chunk per request, comfortably under the platform's request
// ceiling (the client slices at ~1.5M chars before encryption).
const MAX_CHUNK_CHARS = 3_500_000;
const MAX_CHUNKS = 64;

export default async function handler(req: Request): Promise<Response> {
  try {
    await ensureSchema();
    const db = getDb();
    const userId = await authorize(req);
    if (!userId) return json({ error: 'unauthorized' }, 401);

    if (req.method === 'PUT') {
      const body = (await req.json()) as {
        id?: string;
        seq?: number;
        total?: number;
        data?: string;
      };
      const { id, seq, total, data } = body;
      if (
        typeof id !== 'string' || id.length < 8 || id.length > 64 ||
        typeof seq !== 'number' || !Number.isInteger(seq) || seq < 0 ||
        typeof total !== 'number' || !Number.isInteger(total) || total < 1 || total > MAX_CHUNKS ||
        seq >= total ||
        typeof data !== 'string' || data.length === 0
      ) {
        return json({ error: 'bad_request' }, 400);
      }
      if (data.length > MAX_CHUNK_CHARS) return tooLarge();

      await db.execute({
        sql: `INSERT INTO user_media (user_id, id, seq, total, data)
              VALUES (?, ?, ?, ?, ?)
              ON CONFLICT(user_id, id, seq) DO UPDATE SET
                data = excluded.data,
                total = excluded.total`,
        args: [userId, id, seq, total, data],
      });
      return json({ ok: true });
    }

    if (req.method === 'GET') {
      const url = new URL(req.url);

      // ?list=1 — every file this account is storing, ids and sizes only.
      //
      // The server cannot tell which of these is still in use: what points at
      // them lives inside the user's encrypted blobs, which only their browser
      // can read. So the sweep is theirs to run — this hands them the
      // inventory, they work out what is unreachable, and they delete it.
      if (url.searchParams.get('list')) {
        const result = await db.execute({
          sql: `SELECT id, COUNT(*) AS chunks, SUM(LENGTH(data)) AS bytes
                  FROM user_media
                 WHERE user_id = ?
                 GROUP BY id`,
          args: [userId],
        });
        const items = result.rows.map((row) => ({
          id: String(row[0]),
          chunks: Number(row[1]),
          bytes: Number(row[2]),
        }));
        return json({ items });
      }

      const id = url.searchParams.get('id');
      const seq = Number(url.searchParams.get('seq'));
      if (!id || !Number.isInteger(seq) || seq < 0) return json({ error: 'bad_request' }, 400);
      const result = await db.execute({
        sql: `SELECT data, total FROM user_media WHERE user_id = ? AND id = ? AND seq = ?`,
        args: [userId, id, seq],
      });
      if (result.rows.length === 0) return json({ error: 'not_found' }, 404);
      return json({ data: String(result.rows[0][0]), total: Number(result.rows[0][1]) });
    }

    if (req.method === 'DELETE') {
      const url = new URL(req.url);
      const id = url.searchParams.get('id');
      if (!id) return json({ error: 'bad_request' }, 400);
      await db.execute({
        sql: `DELETE FROM user_media WHERE user_id = ? AND id = ?`,
        args: [userId, id],
      });
      return json({ ok: true });
    }

    return json({ error: 'method_not_allowed' }, 405);
  } catch (err) {
    return handleError(err);
  }
}

export const config = { runtime: 'edge' };

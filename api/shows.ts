// /api/shows — encrypted show blobs for a user.
//   GET                    → load all rows (headers: x-user-id, x-auth)
//   GET ?history=1         → { snapshots: [{ at, count }] } — every kept earlier save
//   GET ?at=<backed_up_at> → { shows } as they were in that earlier save
//   PUT                    → apply named changes with their expected previous hash
// Auth: x-auth (client-computed password hash) must match the stored hash.
import { applyShowChanges } from './_lib/showWrites';
import { authorize } from './_lib/auth';
import { ensureSchema, getDb } from './_lib/db';
import { handleError, json, readJson } from './_lib/http';

export default async function handler(req: Request): Promise<Response> {
  try {
    await ensureSchema();
    const db = getDb();
    const userId = await authorize(req);
    if (!userId) return json({ error: 'unauthorized' }, 401);

    if (req.method === 'GET') {
      const url = new URL(req.url);
      if (url.searchParams.get('history')) {
        const result = await db.execute({
          sql: `SELECT backed_up_at, count(*) FROM user_shows_backup
                WHERE user_id = ? GROUP BY backed_up_at ORDER BY backed_up_at DESC`,
          args: [userId],
        });
        return json({
          snapshots: result.rows.map((row) => ({ at: String(row[0]), count: Number(row[1]) })),
        });
      }
      const at = url.searchParams.get('at');
      const result = await db.execute(
        at
          ? {
              sql: `SELECT id, encrypted_data FROM user_shows_backup WHERE user_id = ? AND backed_up_at = ?`,
              args: [userId, at],
            }
          : {
              sql: `SELECT id, encrypted_data FROM user_shows WHERE user_id = ? ORDER BY updated_at DESC`,
              args: [userId],
            },
      );
      if (at && result.rows.length === 0) return json({ error: 'not_found' }, 404);
      const shows = result.rows.map((row) => ({
        id: String(row[0]),
        encryptedData: String(row[1]),
      }));
      return json({ shows });
    }

    if (req.method === 'PUT') {
      const body = await readJson<{ changes?: unknown }>(req);
      // Old builds sent a replacement list. Refuse it rather than letting an
      // already-open tab erase shows that it has never seen.
      if (!Array.isArray(body.changes)) return json({ error: 'client_update_required' }, 428);
      return await applyShowChanges(db, userId, body.changes);
    }

    return json({ error: 'method_not_allowed' }, 405);
  } catch (err) {
    return handleError(err);
  }
}

export const config = { runtime: 'edge' };

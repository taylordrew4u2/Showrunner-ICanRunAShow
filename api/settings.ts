// /api/settings — a single encrypted settings blob per user.
//   GET                      → load (headers: x-user-id, x-auth)
//   GET ?history=1           → { snapshots: [{ at }] } — every kept earlier save
//   GET ?at=<backed_up_at>   → { encryptedData } of that earlier save
//   PUT { encryptedData }    → save; the previous blob is kept as a snapshot
//   PUT { encryptedData, park: true } → keep as a snapshot only, live row untouched
import { authorize } from './_lib/auth';
import { ensureSchema, getDb } from './_lib/db';
import { handleError, json, readJson } from './_lib/http';
import { parkSettingsSnapshot, snapshotSettings } from './_lib/snapshots';

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
          sql: `SELECT backed_up_at FROM user_settings_backup WHERE user_id = ? ORDER BY backed_up_at DESC`,
          args: [userId],
        });
        return json({ snapshots: result.rows.map((row) => ({ at: String(row[0]) })) });
      }
      const at = url.searchParams.get('at');
      if (at) {
        const result = await db.execute({
          sql: `SELECT encrypted_data FROM user_settings_backup WHERE user_id = ? AND backed_up_at = ?`,
          args: [userId, at],
        });
        if (result.rows.length === 0) return json({ error: 'not_found' }, 404);
        return json({ encryptedData: String(result.rows[0][0]) });
      }
      const result = await db.execute({
        sql: `SELECT encrypted_data FROM user_settings WHERE user_id = ?`,
        args: [userId],
      });
      const encryptedData = result.rows.length > 0 ? String(result.rows[0][0]) : null;
      return json({ encryptedData });
    }

    if (req.method === 'PUT') {
      const { encryptedData, park } = await readJson<{ encryptedData: string; park?: boolean }>(req);
      if (typeof encryptedData !== 'string' || encryptedData.length === 0) {
        return json({ error: 'bad_request' }, 400);
      }
      if (park) {
        // A park the server could not store must not read as stored: the
        // client throws away its only copy of this blob on success.
        const parked = await parkSettingsSnapshot(db, userId, encryptedData);
        return parked ? json({ ok: true }) : json({ error: 'not_stored' }, 503);
      }
      // The copy being replaced is kept before anything is written, so the
      // replacement can be undone — which was not true of any settings save
      // before this.
      await snapshotSettings(db, userId);
      await db.execute({
        sql: `INSERT INTO user_settings (user_id, encrypted_data, updated_at)
              VALUES (?, ?, datetime('now'))
              ON CONFLICT(user_id) DO UPDATE SET
                encrypted_data = excluded.encrypted_data,
                updated_at = excluded.updated_at`,
        args: [userId, encryptedData],
      });
      return json({ ok: true });
    }

    return json({ error: 'method_not_allowed' }, 405);
  } catch (err) {
    return handleError(err);
  }
}

export const config = { runtime: 'edge' };

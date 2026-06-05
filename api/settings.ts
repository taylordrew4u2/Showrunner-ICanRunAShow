// /api/settings — a single encrypted settings blob per user.
//   GET → load (headers: x-user-id, x-auth)
//   PUT → save (body: { encryptedData })
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
      const result = await db.execute({
        sql: `SELECT encrypted_data FROM user_settings WHERE user_id = ?`,
        args: [userId],
      });
      const encryptedData = result.rows.length > 0 ? String(result.rows[0][0]) : null;
      return json({ encryptedData });
    }

    if (req.method === 'PUT') {
      const { encryptedData } = await readJson<{ encryptedData: string }>(req);
      if (typeof encryptedData !== 'string') return json({ error: 'bad_request' }, 400);
      await db.execute({
        sql: `INSERT OR REPLACE INTO user_settings (user_id, encrypted_data) VALUES (?, ?)`,
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

// POST /api/auth — signup / login.
// Body: { action: 'signup' | 'login', userId, passwordHash }
// The browser derives userId and passwordHash; the raw password never reaches
// the server.
import { ensureSchema, getDb } from './_lib/db';
import { handleError, json, readJson } from './_lib/http';

interface AuthBody {
  action: 'signup' | 'login';
  userId: string;
  passwordHash: string;
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  try {
    const { action, userId, passwordHash } = await readJson<AuthBody>(req);
    if (!userId || !passwordHash) return json({ error: 'bad_request' }, 400);

    await ensureSchema();
    const db = getDb();

    if (action === 'signup') {
      const existing = await db.execute({ sql: `SELECT id FROM users WHERE id = ?`, args: [userId] });
      if (existing.rows.length > 0) return json({ error: 'account_exists' }, 409);
      await db.execute({
        sql: `INSERT INTO users (id, password_hash) VALUES (?, ?)`,
        args: [userId, passwordHash],
      });
      return json({ ok: true });
    }

    if (action === 'login') {
      const result = await db.execute({
        sql: `SELECT password_hash FROM users WHERE id = ?`,
        args: [userId],
      });
      const ok = result.rows.length > 0 && String(result.rows[0][0]) === passwordHash;
      return json({ ok });
    }

    return json({ error: 'bad_request' }, 400);
  } catch (err) {
    return handleError(err);
  }
}

export const config = { runtime: 'edge' };

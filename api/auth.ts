// POST /api/auth — signup / login.
// Body: { action: 'signup' | 'login', userId, passwordHash }
// The browser derives userId and passwordHash; the raw password never reaches
// the server. We store a salted, slow PBKDF2 hash of the passwordHash (never the
// passwordHash itself) — see _lib/credentials.
import { ensureSchema, getDb } from './_lib/db';
import { handleError, json, readJson } from './_lib/http';
import { hashCredential, verifyCredential, type StoredCredential } from './_lib/credentials';
import { clientAddress, rateLimit, rateLimitPeek } from './_lib/ratelimit';

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

    // Throttle brute force: 10 failed attempts per account per address per 5
    // minutes. Per address, and failures only — counting every attempt by
    // account alone let anyone who knew a username lock its producer out
    // from anywhere, and the right password from a new phone was refused.
    const address = clientAddress(req);
    const failures = `auth:${userId}:${address}`;
    if (!(await rateLimitPeek(db, failures, 10, 300)).allowed) return json({ error: 'too_many_requests' }, 429);

    if (action === 'signup') {
      // Accounts are free to make. One address making dozens an hour is not a
      // producer signing up; it is somebody filling the users table.
      if (!(await rateLimit(db, `signup:${address}`, 20, 3600)).allowed) return json({ error: 'too_many_requests' }, 429);
      const existing = await db.execute({ sql: `SELECT id FROM users WHERE id = ?`, args: [userId] });
      if (existing.rows.length > 0) return json({ error: 'account_exists' }, 409);
      const { salt, hash } = await hashCredential(passwordHash);
      await db.execute({
        sql: `INSERT INTO users (id, password_hash, auth_salt, auth_version) VALUES (?, ?, ?, 2)`,
        args: [userId, hash, salt],
      });
      return json({ ok: true });
    }

    if (action === 'login') {
      const result = await db.execute({
        sql: `SELECT password_hash, auth_salt, auth_version FROM users WHERE id = ?`,
        args: [userId],
      });
      if (result.rows.length === 0) {
        await rateLimit(db, failures, 10, 300);
        return json({ ok: false });
      }
      const row = result.rows[0];
      const stored: StoredCredential = {
        passwordHash: String(row[0]),
        authSalt: row[1] != null ? String(row[1]) : null,
        authVersion: Number(row[2] ?? 1),
      };
      const { ok, upgrade } = await verifyCredential(stored, passwordHash);
      if (!ok) await rateLimit(db, failures, 10, 300);
      if (ok && upgrade) {
        await db.execute({
          sql: `UPDATE users SET password_hash = ?, auth_salt = ?, auth_version = 2 WHERE id = ?`,
          args: [upgrade.hash, upgrade.salt, userId],
        });
      }
      return json({ ok });
    }

    return json({ error: 'bad_request' }, 400);
  } catch (err) {
    return handleError(err);
  }
}

export const config = { runtime: 'edge' };

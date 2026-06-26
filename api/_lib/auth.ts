// Authorizes a request by matching the `x-user-id` + `x-auth` headers against
// the stored credential. The browser computes both client-side (the raw
// password / encryption key never leave the device). Returns the userId when
// authorized, or null. Not a route (underscore-prefixed).
import { ensureSchema, getDb } from './db';
import { verifyCredential, type StoredCredential } from './credentials';

export async function authorize(req: Request): Promise<string | null> {
  const userId = req.headers.get('x-user-id');
  const auth = req.headers.get('x-auth');
  if (!userId || !auth) return null;
  await ensureSchema();
  const db = getDb();
  const result = await db.execute({
    sql: `SELECT password_hash, auth_salt, auth_version FROM users WHERE id = ?`,
    args: [userId],
  });
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  const stored: StoredCredential = {
    passwordHash: String(row[0]),
    authSalt: row[1] != null ? String(row[1]) : null,
    authVersion: Number(row[2] ?? 1),
  };
  const { ok, upgrade } = await verifyCredential(stored, auth);
  if (!ok) return null;
  // Transparently upgrade a legacy row to a salted slow hash on first use.
  if (upgrade) {
    await db.execute({
      sql: `UPDATE users SET password_hash = ?, auth_salt = ?, auth_version = 2 WHERE id = ?`,
      args: [upgrade.hash, upgrade.salt, userId],
    });
  }
  return userId;
}

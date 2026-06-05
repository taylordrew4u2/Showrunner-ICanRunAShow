// Authorizes a request by matching the `x-user-id` + `x-auth` headers against
// the stored password hash. The browser computes both client-side (the raw
// password / encryption key never leave the device). Returns the userId when
// authorized, or null. Not a route (underscore-prefixed).
import { ensureSchema, getDb } from './db';

export async function authorize(req: Request): Promise<string | null> {
  const userId = req.headers.get('x-user-id');
  const auth = req.headers.get('x-auth');
  if (!userId || !auth) return null;
  await ensureSchema();
  const db = getDb();
  const result = await db.execute({
    sql: `SELECT password_hash FROM users WHERE id = ?`,
    args: [userId],
  });
  if (result.rows.length === 0 || String(result.rows[0][0]) !== auth) return null;
  return userId;
}

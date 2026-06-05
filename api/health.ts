// GET /api/health — diagnostic. Reports whether the DB env is configured and
// whether a trivial query succeeds. Always 200 with a JSON report (no secrets),
// so you can open it directly in the browser to check the connection.
import { ensureSchema, getDb, isConfigured } from './_lib/db';
import { json } from './_lib/http';

export default async function handler(): Promise<Response> {
  if (!isConfigured()) {
    return json({ ok: false, configured: false, hint: 'TURSO_DATABASE_URL is not set for this deployment.' });
  }
  try {
    await ensureSchema();
    const db = getDb();
    await db.execute('SELECT 1');
    return json({ ok: true, configured: true, db: 'reachable' });
  } catch (err) {
    return json({
      ok: false,
      configured: true,
      db: 'error',
      error: err instanceof Error ? { name: err.name, message: err.message } : String(err),
    });
  }
}

export const config = { runtime: 'edge' };

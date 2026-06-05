// /api/shows — encrypted show blobs for a user.
//   GET → load all rows (headers: x-user-id, x-auth)
//   PUT → replace all rows (body: { shows: [{ id, encryptedData }] })
// Auth: x-auth (client-computed password hash) must match the stored hash.
import type { Client } from '@libsql/client';
import { authorize } from './_lib/auth';
import { ensureSchema, getDb } from './_lib/db';
import { handleError, json, readJson } from './_lib/http';

interface EncryptedRow {
  id: string;
  encryptedData: string;
}

async function restoreFromBackup(db: Client, userId: string): Promise<void> {
  const latest = await db.execute({
    sql: `SELECT backed_up_at FROM user_shows_backup WHERE user_id = ? ORDER BY backed_up_at DESC LIMIT 1`,
    args: [userId],
  });
  if (latest.rows.length === 0) return;
  const backedUpAt = String(latest.rows[0][0]);
  await db.batch(
    [
      { sql: `DELETE FROM user_shows WHERE user_id = ?`, args: [userId] },
      {
        sql: `INSERT INTO user_shows (id, user_id, encrypted_data)
              SELECT id, user_id, encrypted_data FROM user_shows_backup
              WHERE user_id = ? AND backed_up_at = ?`,
        args: [userId, backedUpAt],
      },
    ],
    'write',
  );
}

export default async function handler(req: Request): Promise<Response> {
  try {
    await ensureSchema();
    const db = getDb();
    const userId = await authorize(req);
    if (!userId) return json({ error: 'unauthorized' }, 401);

    if (req.method === 'GET') {
      const result = await db.execute({
        sql: `SELECT id, encrypted_data FROM user_shows WHERE user_id = ? ORDER BY updated_at DESC`,
        args: [userId],
      });
      const shows = result.rows.map((row) => ({
        id: String(row[0]),
        encryptedData: String(row[1]),
      }));
      return json({ shows });
    }

    if (req.method === 'PUT') {
      const body = await readJson<{ shows: EncryptedRow[] }>(req);
      const incoming = Array.isArray(body.shows) ? body.shows : [];

      const existing = await db.execute({
        sql: `SELECT count(*) as cnt FROM user_shows WHERE user_id = ?`,
        args: [userId],
      });
      const existingCount = Number(existing.rows[0][0]);

      // Never wipe existing shows with an empty array.
      if (incoming.length === 0 && existingCount > 0) {
        return json({ ok: false, skipped: true });
      }

      if (existingCount > 0) {
        // Snapshot current rows, then keep only the 3 most recent per show.
        await db.execute({
          sql: `INSERT INTO user_shows_backup (id, user_id, encrypted_data)
                SELECT id, user_id, encrypted_data FROM user_shows WHERE user_id = ?`,
          args: [userId],
        });
        await db.execute({
          sql: `DELETE FROM user_shows_backup
                WHERE user_id = ? AND rowid NOT IN (
                  SELECT rowid FROM user_shows_backup
                  WHERE user_id = ? ORDER BY backed_up_at DESC LIMIT ?
                )`,
          args: [userId, userId, existingCount * 3],
        });
      }

      const statements = [
        { sql: `DELETE FROM user_shows WHERE user_id = ?`, args: [userId] as (string | number)[] },
        ...incoming.map((s) => ({
          sql: `INSERT INTO user_shows (id, user_id, encrypted_data) VALUES (?, ?, ?)`,
          args: [s.id, userId, s.encryptedData] as (string | number)[],
        })),
      ];
      await db.batch(statements, 'write');

      // Verify, and roll back from the snapshot if the count is wrong.
      const verification = await db.execute({
        sql: `SELECT count(*) as cnt FROM user_shows WHERE user_id = ?`,
        args: [userId],
      });
      const savedCount = Number(verification.rows[0][0]);
      if (savedCount !== incoming.length) {
        await restoreFromBackup(db, userId);
        return json({ ok: false, restored: true }, 500);
      }
      return json({ ok: true });
    }

    return json({ error: 'method_not_allowed' }, 405);
  } catch (err) {
    return handleError(err);
  }
}

export const config = { runtime: 'edge' };

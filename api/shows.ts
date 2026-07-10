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
      const body = await readJson<{
        shows?: EncryptedRow[];
        deleteAll?: boolean;
        // Chunked sync: the client splits a large save across several
        // requests because the platform caps request bodies (~4.5 MB).
        partial?: boolean;
        snapshot?: boolean; // take a backup before the first chunk
        keepIds?: string[]; // final chunk: prune rows not in the synced set
      }>(req);
      const incoming = Array.isArray(body.shows) ? body.shows : [];

      if (body.partial) {
        if (body.snapshot) {
          const existing = await db.execute({
            sql: `SELECT count(*) as cnt FROM user_shows WHERE user_id = ?`,
            args: [userId],
          });
          if (Number(existing.rows[0][0]) > 0) {
            await db.execute({
              sql: `INSERT INTO user_shows_backup (id, user_id, encrypted_data)
                    SELECT id, user_id, encrypted_data FROM user_shows WHERE user_id = ?`,
              args: [userId],
            });
          }
        }

        if (incoming.length > 0) {
          // Upsert scoped to the owner: a conflicting id owned by another
          // user is a no-op, never an overwrite.
          await db.batch(
            incoming.map((s) => ({
              sql: `INSERT INTO user_shows (id, user_id, encrypted_data)
                    VALUES (?, ?, ?)
                    ON CONFLICT(id) DO UPDATE SET
                      encrypted_data = excluded.encrypted_data,
                      updated_at = datetime('now')
                    WHERE user_shows.user_id = excluded.user_id`,
              args: [s.id, userId, s.encryptedData] as (string | number)[],
            })),
            'write',
          );
        }

        if (Array.isArray(body.keepIds)) {
          // Final chunk: remove rows that are no longer in the user's data
          // (deletions), then verify the synced set is complete.
          if (body.keepIds.length === 0) {
            return json({ error: 'empty_without_delete_all', skipped: true }, 409);
          }
          const placeholders = body.keepIds.map(() => '?').join(',');
          await db.execute({
            sql: `DELETE FROM user_shows WHERE user_id = ? AND id NOT IN (${placeholders})`,
            args: [userId, ...body.keepIds],
          });
          const verification = await db.execute({
            sql: `SELECT count(*) as cnt FROM user_shows WHERE user_id = ?`,
            args: [userId],
          });
          if (Number(verification.rows[0][0]) !== body.keepIds.length) {
            await restoreFromBackup(db, userId);
            return json({ ok: false, restored: true }, 500);
          }
        }
        return json({ ok: true });
      }

      const existing = await db.execute({
        sql: `SELECT count(*) as cnt FROM user_shows WHERE user_id = ?`,
        args: [userId],
      });
      const existingCount = Number(existing.rows[0][0]);

      // Never wipe existing shows with an empty array unless the client says
      // it's intentional (the user deleted every show). Without the flag an
      // empty save is treated as a bug and refused — but signal it as an error
      // (409) rather than a silent 200, so the client never mistakes a skipped
      // save for a persisted one and lets deletions silently resurrect.
      if (incoming.length === 0 && existingCount > 0 && !body.deleteAll) {
        return json({ error: 'empty_without_delete_all', skipped: true }, 409);
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

// /api/shows — encrypted show blobs for a user.
//   GET  → load all rows (headers: x-user-id, x-auth)
//   PUT  → replace all rows  (body: { shows: [{ id, encryptedData }] })
// Auth: the x-auth header (client-computed password hash) must match the stored
// hash. The server only ever sees opaque ciphertext.
import type { PrismaClient } from '@prisma/client';
import { authorize } from './_lib/auth';
import { ensureSchema, getPrisma } from './_lib/db';
import { handleError, json, readJson } from './_lib/http';

interface EncryptedRow {
  id: string;
  encryptedData: string;
}

async function restoreFromBackup(prisma: PrismaClient, userId: string): Promise<void> {
  const latest = await prisma.userShowBackup.findFirst({
    where: { userId },
    orderBy: { backedUpAt: 'desc' },
    select: { backedUpAt: true },
  });
  if (!latest) return;
  await prisma.$transaction([
    prisma.userShow.deleteMany({ where: { userId } }),
    prisma.$executeRawUnsafe(
      `INSERT INTO user_shows (id, user_id, encrypted_data)
       SELECT id, user_id, encrypted_data FROM user_shows_backup
       WHERE user_id = ? AND backed_up_at = ?`,
      userId,
      latest.backedUpAt,
    ),
  ]);
}

export default async function handler(req: Request): Promise<Response> {
  try {
    await ensureSchema();
    const prisma = getPrisma();
    const userId = await authorize(req);
    if (!userId) return json({ error: 'unauthorized' }, 401);

    if (req.method === 'GET') {
      const rows = await prisma.userShow.findMany({
        where: { userId },
        orderBy: { updatedAt: 'desc' },
        select: { id: true, encryptedData: true },
      });
      return json({ shows: rows });
    }

    if (req.method === 'PUT') {
      const body = await readJson<{ shows: EncryptedRow[] }>(req);
      const incoming = Array.isArray(body.shows) ? body.shows : [];

      const existingCount = await prisma.userShow.count({ where: { userId } });
      // Never wipe existing shows with an empty array.
      if (incoming.length === 0 && existingCount > 0) {
        return json({ ok: false, skipped: true });
      }

      if (existingCount > 0) {
        // Snapshot current rows, then keep only the 3 most recent per show.
        await prisma.$executeRawUnsafe(
          `INSERT INTO user_shows_backup (id, user_id, encrypted_data)
           SELECT id, user_id, encrypted_data FROM user_shows WHERE user_id = ?`,
          userId,
        );
        await prisma.$executeRawUnsafe(
          `DELETE FROM user_shows_backup
           WHERE user_id = ? AND rowid NOT IN (
             SELECT rowid FROM user_shows_backup
             WHERE user_id = ? ORDER BY backed_up_at DESC LIMIT ?
           )`,
          userId,
          userId,
          existingCount * 3,
        );
      }

      await prisma.$transaction([
        prisma.userShow.deleteMany({ where: { userId } }),
        ...(incoming.length > 0
          ? [
              prisma.userShow.createMany({
                data: incoming.map((s) => ({
                  id: s.id,
                  userId,
                  encryptedData: s.encryptedData,
                })),
              }),
            ]
          : []),
      ]);

      // Verify, and roll back from the snapshot if the count is wrong.
      const savedCount = await prisma.userShow.count({ where: { userId } });
      if (savedCount !== incoming.length) {
        await restoreFromBackup(prisma, userId);
        return json({ ok: false, restored: true }, 500);
      }
      return json({ ok: true });
    }

    return json({ error: 'method_not_allowed' }, 405);
  } catch (err) {
    return handleError(err);
  }
}

// What the server keeps of a producer's past saves, and for how long.
//
// Every save replaces the row it saves over, so the only history an account
// has is what is copied aside first. The old rule kept the three most recent
// copies of each show and nothing of the settings at all — and the settings
// blob is where the Rolodex, the contracts and every signed record live. Three
// copies sounds like history until you notice the app saves on every edit: a
// wrong paste and two more keystrokes, and the version before the paste is
// gone. A run of saves must never be able to flush the past.
//
// So retention is by time as well as by count: the most recent saves are all
// kept, and past those, the first save of each day for a month. Recovering a
// contact deleted last Tuesday is the case this exists for.
import type { Client, Transaction } from '@libsql/client';

/** How many of the latest snapshots survive regardless of age. */
export const KEEP_RECENT = 12;
/** One snapshot per day is kept back this far. */
export const KEEP_DAYS = 30;

/**
 * Prune one user's snapshots in `table` to the retention above. A snapshot is
 * every row sharing one `backed_up_at`; rows of the same save are kept or
 * dropped together, which is what makes a shows snapshot restorable as a set.
 */
export async function pruneSnapshots(db: Pick<Client, 'execute'> & { batch: Transaction['batch'] }, table: string, userId: string): Promise<void> {
  // The recent-snapshots exception applies to the age rule too. Without it, a
  // producer who works through January and does not open the app again until
  // mid-February loses every January snapshot on their first save that day —
  // all twelve recent ones included — and is left with a history of exactly
  // the save that destroyed it. "The latest twelve, regardless of age" has to
  // mean regardless of age.
  const keepRecent = `backed_up_at IN (
      SELECT DISTINCT backed_up_at FROM ${table}
      WHERE user_id = ? ORDER BY backed_up_at DESC LIMIT ${KEEP_RECENT}
    )`;
  const keepDaily = `backed_up_at IN (
      SELECT MIN(backed_up_at) FROM ${table}
      WHERE user_id = ? GROUP BY date(backed_up_at)
    )`;

  await db.batch(
    [
      {
        sql: `DELETE FROM ${table}
              WHERE user_id = ?
                AND backed_up_at < datetime('now', '-${KEEP_DAYS} days')
                AND NOT ${keepRecent}`,
        args: [userId, userId],
      },
      {
        sql: `DELETE FROM ${table}
              WHERE user_id = ?
                AND NOT ${keepRecent}
                AND NOT ${keepDaily}`,
        args: [userId, userId, userId],
      },
    ],
  );
}

/** A monotonic millisecond timestamp keeps rapid saves as separate, complete
 * versions. Called inside the write transaction for ordinary saves. */
async function nextSnapshotAt(db: Pick<Client, 'execute'>, table: string, userId: string): Promise<string> {
  const result = await db.execute({ sql: `SELECT MAX(backed_up_at) FROM ${table} WHERE user_id = ?`, args: [userId] });
  const previous = result.rows[0]?.[0];
  const last = previous ? Date.parse(String(previous).replace(' ', 'T') + 'Z') : 0;
  return new Date(Math.max(Date.now(), Number.isFinite(last) ? last + 1 : 0)).toISOString().replace('T', ' ').replace('Z', '');
}

export async function snapshotShows(db: Pick<Client, 'execute'> & { batch: Transaction['batch'] }, userId: string): Promise<void> {
  const at = await nextSnapshotAt(db, 'user_shows_backup', userId);
  await db.execute({
    sql: `INSERT INTO user_shows_backup (id, user_id, encrypted_data, backed_up_at)
          SELECT id, user_id, encrypted_data, ? FROM user_shows WHERE user_id = ?`, args: [at, userId],
  });
  await pruneSnapshots(db, 'user_shows_backup', userId);
}

export async function snapshotSettings(db: Pick<Client, 'execute'> & { batch: Transaction['batch'] }, userId: string): Promise<void> {
  const at = await nextSnapshotAt(db, 'user_settings_backup', userId);
  await db.execute({
    sql: `INSERT INTO user_settings_backup (user_id, encrypted_data, backed_up_at)
          SELECT user_id, encrypted_data, ? FROM user_settings WHERE user_id = ?`, args: [at, userId],
  });
  await pruneSnapshots(db, 'user_settings_backup', userId);
}

/**
 * Park a blob the client is holding as a snapshot of its own, without touching
 * the live row. This is where a device's stale unsaved copy goes instead of
 * the bin: too old to apply over what the account has since become, but not
 * nothing.
 */
export async function parkSettingsSnapshot(
  db: Pick<Client, 'execute'> & { batch: Transaction['batch'] },
  userId: string,
  encryptedData: string,
): Promise<boolean> {
  // `backed_up_at` has one-second resolution, so a snapshot taken by any other
  // write in the same second takes this row's place and OR IGNORE drops it
  // silently. The caller deletes its only copy of this blob on success, so a
  // discarded write reported as `{ok:true}` is how the held copy is lost —
  // exactly what parking exists to prevent. Try the next second instead, and
  // say so if it still will not land.
  for (let offset = 0; offset < 5; offset++) {
    const result = await db.execute({
      sql: `INSERT OR IGNORE INTO user_settings_backup (user_id, encrypted_data, backed_up_at)
            VALUES (?, ?, datetime('now', ?))`,
      args: [userId, encryptedData, `+${offset} seconds`],
    });
    if (result.rowsAffected > 0) {
      await pruneSnapshots(db, 'user_settings_backup', userId);
      return true;
    }
  }
  return false;
}

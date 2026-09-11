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
import type { Client } from '@libsql/client';

/** How many of the latest snapshots survive regardless of age. */
export const KEEP_RECENT = 12;
/** One snapshot per day is kept back this far. */
export const KEEP_DAYS = 30;

/**
 * Prune one user's snapshots in `table` to the retention above. A snapshot is
 * every row sharing one `backed_up_at`; rows of the same save are kept or
 * dropped together, which is what makes a shows snapshot restorable as a set.
 */
export async function pruneSnapshots(db: Client, table: string, userId: string): Promise<void> {
  await db.batch(
    [
      {
        sql: `DELETE FROM ${table}
              WHERE user_id = ? AND backed_up_at < datetime('now', '-${KEEP_DAYS} days')`,
        args: [userId],
      },
      {
        sql: `DELETE FROM ${table}
              WHERE user_id = ?
                AND backed_up_at NOT IN (
                  SELECT DISTINCT backed_up_at FROM ${table}
                  WHERE user_id = ? ORDER BY backed_up_at DESC LIMIT ${KEEP_RECENT}
                )
                AND backed_up_at NOT IN (
                  SELECT MIN(backed_up_at) FROM ${table}
                  WHERE user_id = ? GROUP BY date(backed_up_at)
                )`,
        args: [userId, userId, userId],
      },
    ],
    'write',
  );
}

/**
 * Copy the current shows aside before a save replaces them. `OR IGNORE`
 * because `backed_up_at` has one-second resolution and two saves inside the
 * same second are the same snapshot, not a constraint failure that fails the
 * save.
 */
export async function snapshotShows(db: Client, userId: string): Promise<void> {
  await db.execute({
    sql: `INSERT OR IGNORE INTO user_shows_backup (id, user_id, encrypted_data)
          SELECT id, user_id, encrypted_data FROM user_shows WHERE user_id = ?`,
    args: [userId],
  });
  await pruneSnapshots(db, 'user_shows_backup', userId);
}

/** Copy the current settings blob aside before a save replaces it. */
export async function snapshotSettings(db: Client, userId: string): Promise<void> {
  await db.execute({
    sql: `INSERT OR IGNORE INTO user_settings_backup (user_id, encrypted_data)
          SELECT user_id, encrypted_data FROM user_settings WHERE user_id = ?`,
    args: [userId],
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
  db: Client,
  userId: string,
  encryptedData: string,
): Promise<void> {
  await db.execute({
    sql: `INSERT OR IGNORE INTO user_settings_backup (user_id, encrypted_data) VALUES (?, ?)`,
    args: [userId, encryptedData],
  });
  await pruneSnapshots(db, 'user_settings_backup', userId);
}

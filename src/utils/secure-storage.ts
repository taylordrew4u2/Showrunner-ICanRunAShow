import type { Show, AppSettings } from "../types";
import { DEFAULT_SETTINGS } from "../types";
import {
  encryptData,
  decryptData,
  deriveUserId,
  hashPassword,
} from "./encryption";
import { getClient, ensureSchema } from "./db";

/**
 * Secure storage that encrypts data and syncs with Turso backend
 * Uses password-derived keys for all users
 */

function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

function getUserId(username: string): string {
  return deriveUserId(normalizeUsername(username));
}

/**
 * Create a new account
 */
export async function createAccount(
  username: string,
  password: string,
): Promise<void> {
  const userId = getUserId(username);
  const passwordHash = hashPassword(password);

  await ensureSchema();
  const db = getClient();
  const existing = await db.execute(`SELECT id FROM users WHERE id = ?`, [
    userId,
  ]);

  if (existing.rows.length > 0) {
    throw new Error("ACCOUNT_EXISTS");
  }

  await db.execute({
    sql: `
      INSERT INTO users (id, password_hash)
      VALUES (?, ?)
    `,
    args: [userId, passwordHash],
  });
}

/**
 * Verify account credentials
 */
export async function authenticateUser(
  username: string,
  password: string,
): Promise<boolean> {
  const userId = getUserId(username);
  const passwordHash = hashPassword(password);

  await ensureSchema();
  const db = getClient();
  const result = await db.execute(
    `SELECT password_hash FROM users WHERE id = ?`,
    [userId],
  );

  if (result.rows.length === 0) {
    return false;
  }

  const storedHash = result.rows[0][0] as string;
  return storedHash === passwordHash;
}

/**
 * Load encrypted shows from backend and decrypt
 */
export async function loadEncryptedShows(
  username: string,
  password: string,
): Promise<Show[]> {
  const userId = getUserId(username);

  await ensureSchema();
  const db = getClient();
  const result = await db.execute(
    `SELECT encrypted_data FROM user_shows WHERE user_id = ? ORDER BY updated_at DESC`,
    [userId],
  );

  return result.rows.map((row) => {
    const encrypted = row[0] as string;
    return decryptData<Show>(encrypted, password);
  });
}

/**
 * Save shows to backend (encrypted)
 * Backs up existing data before overwriting so it can be recovered.
 */
export async function saveEncryptedShows(
  shows: Show[],
  username: string,
  password: string,
): Promise<void> {
  const userId = getUserId(username);

  await ensureSchema();
  const db = getClient();

  // Count existing rows for this user
  const existing = await db.execute(
    `SELECT count(*) as cnt FROM user_shows WHERE user_id = ?`,
    [userId],
  );
  const existingCount = Number(existing.rows[0][0]);

  // Never wipe existing shows with an empty array
  if (shows.length === 0 && existingCount > 0) {
    console.warn(
      `Skipping save: refusing to delete ${existingCount} existing show(s) with an empty array.`,
    );
    return;
  }

  // Backup current rows before deleting (keeps last 3 snapshots per show)
  if (existingCount > 0) {
    await db.execute({
      sql: `INSERT INTO user_shows_backup (id, user_id, encrypted_data)
            SELECT id, user_id, encrypted_data FROM user_shows WHERE user_id = ?`,
      args: [userId],
    });

    // Prune old backups — keep only the 3 most recent per show
    await db.execute({
      sql: `DELETE FROM user_shows_backup
            WHERE user_id = ? AND rowid NOT IN (
              SELECT rowid FROM user_shows_backup
              WHERE user_id = ?
              ORDER BY backed_up_at DESC
              LIMIT ? 
            )`,
      args: [userId, userId, String(existingCount * 3)],
    });
  }

  const statements: Array<{ sql: string; args: string[] }> = [
    { sql: `DELETE FROM user_shows WHERE user_id = ?`, args: [userId] },
  ];

  for (const show of shows) {
    const encrypted = encryptData(show, password);
    statements.push({
      sql: `INSERT INTO user_shows (id, user_id, encrypted_data) VALUES (?, ?, ?)`,
      args: [show.id, userId, encrypted],
    });
  }

  await db.batch(statements, "write");

  // Verify the write succeeded — if row count doesn't match, restore from backup
  const verification = await db.execute(
    `SELECT count(*) as cnt FROM user_shows WHERE user_id = ?`,
    [userId],
  );
  const savedCount = Number(verification.rows[0][0]);
  if (savedCount !== shows.length) {
    console.error(
      `Save verification failed: expected ${shows.length} rows, found ${savedCount}. Restoring from backup.`,
    );
    await restoreFromBackup(userId);
  }
}

/**
 * Restore shows from the most recent backup snapshot
 */
async function restoreFromBackup(userId: string): Promise<void> {
  const db = getClient();

  // Get the most recent backup timestamp for this user
  const latestBackup = await db.execute({
    sql: `SELECT backed_up_at FROM user_shows_backup
          WHERE user_id = ?
          ORDER BY backed_up_at DESC LIMIT 1`,
    args: [userId],
  });
  if (latestBackup.rows.length === 0) return;

  const backedUpAt = latestBackup.rows[0][0] as string;

  await db.batch([
    { sql: `DELETE FROM user_shows WHERE user_id = ?`, args: [userId] },
    {
      sql: `INSERT INTO user_shows (id, user_id, encrypted_data)
            SELECT id, user_id, encrypted_data
            FROM user_shows_backup
            WHERE user_id = ? AND backed_up_at = ?`,
      args: [userId, backedUpAt],
    },
  ], "write");
}

/**
 * Export all user data as a downloadable JSON blob (unencrypted).
 * Returns a Blob URL the caller can use for a download link.
 */
export async function exportUserData(
  username: string,
  password: string,
): Promise<string> {
  const shows = await loadEncryptedShows(username, password);
  const settings = await loadEncryptedSettings(username, password);
  const payload = JSON.stringify({ shows, settings, exportedAt: new Date().toISOString() }, null, 2);
  const blob = new Blob([payload], { type: "application/json" });
  return URL.createObjectURL(blob);
}

/**
 * Load encrypted settings from backend
 */
export async function loadEncryptedSettings(
  username: string,
  password: string,
): Promise<AppSettings> {
  const userId = getUserId(username);

  await ensureSchema();
  const db = getClient();
  const result = await db.execute(
    `SELECT encrypted_data FROM user_settings WHERE user_id = ?`,
    [userId],
  );

  if (result.rows.length === 0) {
    return DEFAULT_SETTINGS;
  }

  const encrypted = result.rows[0][0] as string;
  const settings = decryptData<AppSettings>(encrypted, password);

  // Migrate old settings format
  return migrateSettings(settings);
}

/**
 * Migrate old settings format to new format
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function migrateSettings(settings: any): AppSettings {
  // Handle old format with producerNames string
  if (settings.producerNames && !settings.producers) {
    const names = settings.producerNames
      .split(",")
      .map((n: string) => n.trim())
      .filter(Boolean);
    settings.producers = names.map((name: string) => ({
      id: Math.random().toString(36).slice(2),
      name,
      role: "Producer",
    }));
    delete settings.producerNames;
  }

  // Ensure new fields exist
  if (!settings.producers) settings.producers = [];
  if (typeof settings.brandBudget !== "number") settings.brandBudget = 0;
  if (typeof settings.totalSpent !== "number") settings.totalSpent = 0;
  if (!Array.isArray(settings.trash)) settings.trash = [];
  if (!Array.isArray(settings.potentialComics)) settings.potentialComics = [];

  return settings as AppSettings;
}

/**
 * Save encrypted settings to backend
 */
export async function saveEncryptedSettings(
  settings: AppSettings,
  username: string,
  password: string,
): Promise<void> {
  const userId = getUserId(username);

  await ensureSchema();
  const db = getClient();
  const encrypted = encryptData(settings, password);
  await db.execute(
    `
      INSERT OR REPLACE INTO user_settings (user_id, encrypted_data)
      VALUES (?, ?)
    `,
    [userId, encrypted],
  );
}

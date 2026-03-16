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
 */
export async function saveEncryptedShows(
  shows: Show[],
  username: string,
  password: string,
): Promise<void> {
  const userId = getUserId(username);

  await ensureSchema();
  const db = getClient();

  // Safety check: don't wipe existing shows if the array is empty
  if (shows.length === 0) {
    const existing = await db.execute(
      `SELECT count(*) as cnt FROM user_shows WHERE user_id = ?`,
      [userId],
    );
    const count = Number(existing.rows[0][0]);
    if (count > 0) {
      console.warn(
        `Skipping save: refusing to delete ${count} existing show(s) with an empty array.`,
      );
      return;
    }
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

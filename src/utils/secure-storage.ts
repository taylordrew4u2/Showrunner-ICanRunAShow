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

const LOCAL_USERS_KEY = "showrunner_local_users";
const LOCAL_SHOWS_KEY = "showrunner_local_shows";
const LOCAL_SETTINGS_KEY = "showrunner_local_settings";

let _isOfflineMode = false;

/**
 * Check if running in local-only fallback mode (remote DB unavailable)
 */
export function isOfflineMode(): boolean {
  return _isOfflineMode;
}

function setOfflineMode(value: boolean): void {
  _isOfflineMode = value;
}

type LocalUsers = Record<string, string>;
type LocalShows = Record<string, string[]>;
type LocalSettings = Record<string, string>;

function readLocalJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeLocalJson<T>(key: string, value: T): void {
  localStorage.setItem(key, JSON.stringify(value));
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

  try {
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
  } catch (error) {
    if (error instanceof Error && error.message === "ACCOUNT_EXISTS") {
      throw error;
    }

    console.warn(
      "Remote account creation failed, using local fallback:",
      error,
    );
    setOfflineMode(true);

    const users = readLocalJson<LocalUsers>(LOCAL_USERS_KEY, {});
    if (users[userId]) {
      throw new Error("ACCOUNT_EXISTS");
    }
    users[userId] = passwordHash;
    writeLocalJson(LOCAL_USERS_KEY, users);
  }
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

  try {
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
  } catch (error) {
    console.warn("Remote authentication failed, using local fallback:", error);
    setOfflineMode(true);
    const users = readLocalJson<LocalUsers>(LOCAL_USERS_KEY, {});
    return users[userId] === passwordHash;
  }
}

/**
 * Load encrypted shows from backend and decrypt
 */
export async function loadEncryptedShows(
  username: string,
  password: string,
): Promise<Show[]> {
  const userId = getUserId(username);

  try {
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
  } catch (error) {
    console.warn("Remote show load failed, using local fallback:", error);
    setOfflineMode(true);
    const byUser = readLocalJson<LocalShows>(LOCAL_SHOWS_KEY, {});
    const encryptedShows = byUser[userId] ?? [];
    try {
      return encryptedShows.map((encrypted) =>
        decryptData<Show>(encrypted, password),
      );
    } catch {
      return [];
    }
  }
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

  try {
    await ensureSchema();
    const db = getClient();
    // Delete old shows for this user
    await db.execute(`DELETE FROM user_shows WHERE user_id = ?`, [userId]);

    // Insert encrypted shows
    for (const show of shows) {
      const encrypted = encryptData(show, password);
      await db.execute(
        `
          INSERT INTO user_shows (id, user_id, encrypted_data)
          VALUES (?, ?, ?)
        `,
        [show.id, userId, encrypted],
      );
    }
  } catch (error) {
    console.warn("Remote show save failed, using local fallback:", error);
    setOfflineMode(true);
    const byUser = readLocalJson<LocalShows>(LOCAL_SHOWS_KEY, {});
    byUser[userId] = shows.map((show) => encryptData(show, password));
    writeLocalJson(LOCAL_SHOWS_KEY, byUser);
  }
}

/**
 * Load encrypted settings from backend
 */
export async function loadEncryptedSettings(
  username: string,
  password: string,
): Promise<AppSettings> {
  const userId = getUserId(username);

  try {
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
  } catch (error) {
    console.warn("Remote settings load failed, using local fallback:", error);
    setOfflineMode(true);
    const byUser = readLocalJson<LocalSettings>(LOCAL_SETTINGS_KEY, {});
    const encrypted = byUser[userId];
    if (!encrypted) {
      return DEFAULT_SETTINGS;
    }
    const settings = decryptData<AppSettings>(encrypted, password);
    return migrateSettings(settings);
  }
}

/**
 * Migrate old settings format to new format
 */
function migrateSettings(settings: any): AppSettings {
  // Handle old format with producerNames string
  if (settings.producerNames && !settings.producers) {
    const names = settings.producerNames.split(',').map((n: string) => n.trim()).filter(Boolean);
    settings.producers = names.map((name: string) => ({
      id: Math.random().toString(36).slice(2),
      name,
      role: 'Producer',
    }));
    delete settings.producerNames;
  }
  
  // Ensure new fields exist
  if (!settings.producers) settings.producers = [];
  if (typeof settings.brandBudget !== 'number') settings.brandBudget = 0;
  if (typeof settings.totalSpent !== 'number') settings.totalSpent = 0;
  
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

  try {
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
  } catch (error) {
    console.warn("Remote settings save failed, using local fallback:", error);
    setOfflineMode(true);
    const byUser = readLocalJson<LocalSettings>(LOCAL_SETTINGS_KEY, {});
    byUser[userId] = encryptData(settings, password);
    writeLocalJson(LOCAL_SETTINGS_KEY, byUser);
  }
}

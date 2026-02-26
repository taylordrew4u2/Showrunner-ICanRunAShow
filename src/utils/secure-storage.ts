import type { Show, AppSettings } from "../types";
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
  await ensureSchema();
  const db = getClient();
  const userId = getUserId(username);
  const passwordHash = hashPassword(password);

  try {
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
    console.error("Failed to create user:", error);
    throw error;
  }
}

/**
 * Verify account credentials
 */
export async function authenticateUser(
  username: string,
  password: string,
): Promise<boolean> {
  await ensureSchema();
  const db = getClient();
  const userId = getUserId(username);
  const passwordHash = hashPassword(password);

  try {
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
    console.error("Failed to verify account:", error);
    return false;
  }
}

/**
 * Load encrypted shows from backend and decrypt
 */
export async function loadEncryptedShows(
  username: string,
  password: string,
): Promise<Show[]> {
  await ensureSchema();
  const db = getClient();
  const userId = getUserId(username);

  try {
    const result = await db.execute(
      `SELECT encrypted_data FROM user_shows WHERE user_id = ? ORDER BY updated_at DESC`,
      [userId],
    );

    return result.rows.map((row: any) => {
      const encrypted = row[0] as string;
      return decryptData<Show>(encrypted, password);
    });
  } catch (error) {
    console.error("Failed to load encrypted shows:", error);
    return [];
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
  await ensureSchema();
  const db = getClient();
  const userId = getUserId(username);

  try {
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
    console.error("Failed to save encrypted shows:", error);
    throw error;
  }
}

/**
 * Load encrypted settings from backend
 */
export async function loadEncryptedSettings(
  username: string,
  password: string,
): Promise<AppSettings> {
  await ensureSchema();
  const db = getClient();
  const userId = getUserId(username);

  try {
    const result = await db.execute(
      `SELECT encrypted_data FROM user_settings WHERE user_id = ?`,
      [userId],
    );

    if (result.rows.length === 0) {
      return {
        brandName: "Show Producer",
        producerNames: "",
        rules: "",
      };
    }

    const encrypted = result.rows[0][0] as string;
    return decryptData<AppSettings>(encrypted, password);
  } catch (error) {
    console.error("Failed to load encrypted settings:", error);
    return {
      brandName: "Show Producer",
      producerNames: "",
      rules: "",
    };
  }
}

/**
 * Save encrypted settings to backend
 */
export async function saveEncryptedSettings(
  settings: AppSettings,
  username: string,
  password: string,
): Promise<void> {
  await ensureSchema();
  const db = getClient();
  const userId = getUserId(username);

  try {
    const encrypted = encryptData(settings, password);
    await db.execute(
      `
        INSERT OR REPLACE INTO user_settings (user_id, encrypted_data)
        VALUES (?, ?)
      `,
      [userId, encrypted],
    );
  } catch (error) {
    console.error("Failed to save encrypted settings:", error);
    throw error;
  }
}

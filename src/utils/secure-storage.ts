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

/**
 * Initialize user in database (called on first login)
 */
export async function initializeUser(password: string): Promise<void> {
  await ensureSchema();
  const db = getClient();
  const userId = deriveUserId(password);
  const passwordHash = hashPassword(password);

  try {
    // Ensure user exists
    await db.execute({
      sql: `
        INSERT OR IGNORE INTO users (id, password_hash)
        VALUES (?, ?)
      `,
      args: [userId, passwordHash],
    });
  } catch (error) {
    console.error("Failed to initialize user:", error);
    throw error;
  }
}

/**
 * Load encrypted shows from backend and decrypt
 */
export async function loadEncryptedShows(password: string): Promise<Show[]> {
  await ensureSchema();
  const db = getClient();
  const userId = deriveUserId(password);

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
  password: string,
): Promise<void> {
  await ensureSchema();
  const db = getClient();
  const userId = deriveUserId(password);

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
  password: string,
): Promise<AppSettings> {
  await ensureSchema();
  const db = getClient();
  const userId = deriveUserId(password);

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
  password: string,
): Promise<void> {
  await ensureSchema();
  const db = getClient();
  const userId = deriveUserId(password);

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

/**
 * Verify user password against stored hash
 */
export async function verifyUserPassword(password: string): Promise<boolean> {
  await ensureSchema();
  const db = getClient();
  const userId = deriveUserId(password);
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
    console.error("Failed to verify password:", error);
    return false;
  }
}

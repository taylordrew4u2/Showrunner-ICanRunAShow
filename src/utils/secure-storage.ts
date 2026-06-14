import type { Show, AppSettings } from "../types";
import { DEFAULT_SETTINGS } from "../types";
import {
  encryptData,
  encryptWithKey,
  decryptData,
  decryptWithKey,
  deriveKey,
  deriveUserId,
  hashPassword,
} from "./encryption";
import { api, type ApiError } from "./api";

/**
 * Secure storage. All data is encrypted in the browser (the password-derived
 * key never leaves the device); the server API only ever stores/returns opaque
 * ciphertext. The browser sends a derived userId + password hash for routing
 * and authorization, never the raw password.
 */

function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

function getUserId(username: string): string {
  return deriveUserId(normalizeUsername(username));
}

// Auth headers for the per-user routes.
function auth(username: string, password: string) {
  return { authUserId: getUserId(username), authHash: hashPassword(password) };
}

/**
 * Create a new account.
 */
export async function createAccount(
  username: string,
  password: string,
): Promise<void> {
  try {
    await api.post("/api/auth", {
      action: "signup",
      userId: getUserId(username),
      passwordHash: hashPassword(password),
    });
  } catch (err) {
    if ((err as ApiError).status === 409) throw new Error("ACCOUNT_EXISTS");
    throw err;
  }
}

/**
 * Verify account credentials.
 */
export async function authenticateUser(
  username: string,
  password: string,
): Promise<boolean> {
  const res = await api.post<{ ok: boolean }>("/api/auth", {
    action: "login",
    userId: getUserId(username),
    passwordHash: hashPassword(password),
  });
  return res.ok;
}

/**
 * Load encrypted shows from the backend and decrypt them client-side.
 */
export async function loadEncryptedShows(
  username: string,
  password: string,
): Promise<Show[]> {
  const { shows } = await api.get<{ shows: { id: string; encryptedData: string }[] }>(
    "/api/shows",
    auth(username, password),
  );
  // Derive the key once and reuse it for every row — PBKDF2 is deliberately slow.
  const key = deriveKey(password);
  return shows.map((row) => decryptWithKey<Show>(row.encryptedData, key));
}

/**
 * Encrypt shows client-side and save them. The server handles backup + verify
 * and refuses to wipe existing data with an empty array.
 */
export async function saveEncryptedShows(
  shows: Show[],
  username: string,
  password: string,
): Promise<void> {
  // Derive the key once for the whole batch (PBKDF2 is slow).
  const key = deriveKey(password);
  const payload = shows.map((show) => ({ id: show.id, encryptedData: encryptWithKey(show, key) }));
  await api.put("/api/shows", { shows: payload }, auth(username, password));
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
 * Load encrypted settings from the backend.
 */
export async function loadEncryptedSettings(
  username: string,
  password: string,
): Promise<AppSettings> {
  const { encryptedData } = await api.get<{ encryptedData: string | null }>(
    "/api/settings",
    auth(username, password),
  );
  if (!encryptedData) return DEFAULT_SETTINGS;
  const settings = decryptData<AppSettings>(encryptedData, password);
  // Migrate old settings format
  return migrateSettings(settings);
}

/**
 * Migrate old settings format to new format
 */
type LegacySettings = Partial<AppSettings> & {
  producerNames?: string;
  producers?: AppSettings['producers'];
  brandBudget?: number;
  totalSpent?: number;
  trash?: AppSettings['trash'];
};

function migrateSettings(settings: LegacySettings): AppSettings {
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
  if (!Array.isArray(settings.showTypes)) settings.showTypes = [];
  // Settings that already exist on the server belong to an established account —
  // don't force these users through onboarding, only brand-new signups.
  if (typeof settings.onboarded !== "boolean") settings.onboarded = true;

  return settings as AppSettings;
}

/**
 * Save encrypted settings to the backend.
 */
export async function saveEncryptedSettings(
  settings: AppSettings,
  username: string,
  password: string,
): Promise<void> {
  const encryptedData = encryptData(settings, password);
  await api.put("/api/settings", { encryptedData }, auth(username, password));
}

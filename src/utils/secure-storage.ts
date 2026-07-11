import type { Show, AppSettings } from "../types";
import { DEFAULT_SETTINGS } from "../types";
import {
  encryptData,
  encryptWithKey,
  decryptData,
  decryptWithKeys,
  deriveKey,
  deriveKeys,
  deriveUserId,
  hashPassword,
} from "./encryption";
import { api, type ApiError } from "./api";
import { stripShowMediaForTrash, MAX_TRASH_ITEMS } from "./trash";
import { describeLargestMedia } from "./showSize";

/**
 * Secure storage. All data is encrypted in the browser (the password-derived
 * key never leaves the device); the server API only ever stores/returns opaque
 * ciphertext. The browser sends a derived userId + password hash for routing
 * and authorization, never the raw password.
 */

/**
 * Thrown when an encrypted blob is too large for the server to accept in a
 * single request. The hosting platform rejects request bodies over ~4.5 MB
 * (HTTP 413), so we detect it before sending and surface an actionable message
 * instead of retrying a request that can never succeed.
 */
export class PayloadTooLargeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PayloadTooLargeError';
  }
}

// Stay comfortably under the platform's ~4.5 MB request-body limit (headers +
// JSON envelope eat into it). Media is embedded as base64 inside the encrypted
// blob, so a couple of uploaded files can push a save over this on their own.
const MAX_SAVE_BYTES = 4_300_000;

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
  // Derive the keys once and reuse them for every row — PBKDF2 is deliberately
  // slow. decryptWithKeys tries the current key, then the legacy key, so shows
  // saved before the KDF upgrade still decrypt (and re-encrypt on next save).
  const keys = deriveKeys(password);
  return shows.map((row) => decryptWithKeys<Show>(row.encryptedData, keys));
}

/**
 * Per-show ciphertext cache. AES over a show with embedded media is expensive
 * and runs on the main thread, so we avoid re-encrypting shows that haven't
 * changed. The app updates state immutably, so an unchanged show keeps the same
 * object reference and hits this cache; only edited shows are re-encrypted.
 * A WeakMap lets dropped shows be garbage-collected automatically.
 */
const showCipherCache = new WeakMap<Show, { key: string; cipher: string }>();

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
  const payload = shows.map((show) => {
    const cached = showCipherCache.get(show);
    if (cached && cached.key === key) {
      return { id: show.id, encryptedData: cached.cipher };
    }
    const cipher = encryptWithKey(show, key);
    showCipherCache.set(show, { key, cipher });
    return { id: show.id, encryptedData: cipher };
  });
  // An empty list is a deliberate "delete everything" from the app (saves only
  // run after the initial load), so tell the server it's intentional — without
  // the flag it refuses empty saves as a safety net against bugs.
  const deleteAll = shows.length === 0;
  const a = auth(username, password);
  const body = JSON.stringify({ shows: payload, deleteAll });
  if (body.length <= MAX_SAVE_BYTES) {
    await api.put("/api/shows", { shows: payload, deleteAll }, a);
    return;
  }

  // The whole set doesn't fit in one request, so sync in chunks — the request
  // ceiling then applies per show rather than to the entire account.
  const ENVELOPE = 4000; // JSON wrapper + headers margin per request
  const perRequestLimit = MAX_SAVE_BYTES - ENVELOPE;

  // A single show that can't fit even alone can never sync — tell the user
  // exactly which files inside it are the problem.
  const oversized = payload.filter((row) => row.encryptedData.length > perRequestLimit);
  if (oversized.length > 0) {
    const details = oversized.map((row) => {
      const show = shows.find((s) => s.id === row.id);
      if (!show) return "an unknown show";
      const files = describeLargestMedia(show);
      return `"${show.name}"${files ? ` — biggest files: ${files}` : ""}`;
    });
    throw new PayloadTooLargeError(
      `One of your shows is too large to save even by itself: ${details.join("; ")}. Remove or shrink those walk-on tracks.`,
    );
  }

  // Greedy-pack rows into batches under the per-request ceiling.
  const batches: typeof payload[] = [];
  let current: typeof payload = [];
  let size = 0;
  for (const row of payload) {
    const rowSize = row.encryptedData.length + row.id.length + 64;
    if (current.length > 0 && size + rowSize > perRequestLimit) {
      batches.push(current);
      current = [];
      size = 0;
    }
    current.push(row);
    size += rowSize;
  }
  if (current.length > 0) batches.push(current);

  // Upsert each batch (the server snapshots a backup before the first), then
  // prune deletions and verify completeness in a final request.
  for (let i = 0; i < batches.length; i++) {
    await api.put("/api/shows", { partial: true, snapshot: i === 0, shows: batches[i] }, a);
  }
  await api.put("/api/shows", { partial: true, keepIds: payload.map((row) => row.id) }, a);
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
 * Public entry point for settings healing/migration. Local pending backups
 * bypass loadEncryptedSettings, so App runs them through this before use —
 * otherwise a backup written before the size caps existed (bloated trash,
 * oversized rolodex audio) would keep the account permanently unsavable.
 */
export function healSettings(settings: AppSettings): AppSettings {
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
  // Heal accounts whose trash was written before media stripping existed:
  // full show copies (embedded audio) in trash can push the settings
  // blob over the request-size ceiling and block every settings save.
  settings.trash = settings.trash.slice(0, MAX_TRASH_ITEMS).map((item) =>
    item && item.data ? { ...item, data: stripShowMediaForTrash(item.data) } : item,
  );
  // Same healing for rolodex walk-on tracks uploaded before the size cap:
  // a single large embedded audio file makes the settings blob unsavable.
  // ~3M chars of base64 ≈ a 2.2 MB file — anything bigger can never persist.
  const MAX_EMBED_CHARS = 3_000_000;
  settings.potentialComics = (settings.potentialComics || []).map((comic) =>
    comic.walkOnMusic &&
    comic.walkOnMusic.startsWith("data:") &&
    comic.walkOnMusic.length > MAX_EMBED_CHARS
      ? { ...comic, walkOnMusic: undefined }
      : comic,
  );
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
  // Same platform request-size ceiling as shows — never fire a doomed request.
  if (encryptedData.length > MAX_SAVE_BYTES) {
    throw new PayloadTooLargeError(
      "Your settings are too large to save — usually an over-full trash or a large embedded walk-on track. Empty the trash to fix it.",
    );
  }
  await api.put("/api/settings", { encryptedData }, auth(username, password));
}

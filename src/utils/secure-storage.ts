import type { Show, AppSettings } from "../types";
import { DEFAULT_SETTINGS } from "../types";
import { encryptWithKey, decryptWithKeys, deriveUserId, hashPassword } from "./encryption";
import type { SessionCredentials } from "./session-vault";
import { api, type ApiError } from "./api";
import { stripShowMediaForTrash, MAX_TRASH_ITEMS } from "./trash";
import { describeLargestMedia } from "./showSize";
import { healShow } from "./showHealing";

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

// Auth headers for the per-user routes. Both values were derived at sign-in,
// so nothing here needs (or has) the raw password.
function auth(creds: SessionCredentials) {
  return { authUserId: creds.userId, authHash: creds.authHash };
}

/** Every key to try when reading, newest first (see decryptWithKeys). */
function readKeys(creds: SessionCredentials): string[] {
  return [creds.key, creds.legacyKey];
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

/** One row exactly as the server stores it: an id and an opaque blob. */
export interface EncryptedShowRow {
  id: string;
  encryptedData: string;
}

export interface LoadedShows {
  /** Every row this device could read. */
  shows: Show[];
  /**
   * Rows it couldn't, kept as the ciphertext that came back. They're handed
   * straight back to the next save so a row we can't read is never a row we
   * silently delete.
   */
  unreadable: EncryptedShowRow[];
}

/**
 * Load encrypted shows from the backend and decrypt them client-side.
 *
 * Row by row, deliberately. This used to be a single `.map`, which meant one
 * corrupt or unreadable blob threw before the second row was even attempted and
 * the account rendered as "couldn't load your shows" with an empty list — every
 * other show lost to one bad one. Now a row that won't decrypt is set aside and
 * everything else loads.
 */
export async function loadEncryptedShows(creds: SessionCredentials): Promise<LoadedShows> {
  const { shows } = await api.get<{ shows: EncryptedShowRow[] }>("/api/shows", auth(creds));
  // Keys were derived once at sign-in — PBKDF2 is deliberately slow, so it must
  // not run per row. decryptWithKeys tries the current key, then the legacy key,
  // so shows saved before the KDF upgrade still decrypt (and re-encrypt on the
  // next save).
  const keys = readKeys(creds);
  const readable: Show[] = [];
  const unreadable: EncryptedShowRow[] = [];

  for (const row of shows) {
    let show: Show | null = null;
    try {
      show = healShow(decryptWithKeys<unknown>(row.encryptedData, keys));
    } catch {
      show = null; // wrong key, truncated blob, non-JSON plaintext
    }
    if (show) readable.push(show);
    else unreadable.push(row);
  }

  return { shows: readable, unreadable };
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
  creds: SessionCredentials,
  /**
   * Rows loadEncryptedShows couldn't decrypt. Every save replaces the whole
   * set, so these have to be written back verbatim — otherwise a row this
   * device merely failed to *read* gets deleted the moment anything else is
   * edited. Untouched ciphertext in, untouched ciphertext out.
   */
  unreadable: EncryptedShowRow[] = [],
): Promise<void> {
  const key = creds.key;
  const encrypted = shows.map((show) => {
    const cached = showCipherCache.get(show);
    if (cached && cached.key === key) {
      return { id: show.id, encryptedData: cached.cipher };
    }
    const cipher = encryptWithKey(show, key);
    showCipherCache.set(show, { key, cipher });
    return { id: show.id, encryptedData: cipher };
  });
  // A row that has since become readable (and is now in `shows`) wins over the
  // carried copy, so an id can never appear twice — the id column is a primary
  // key, and a duplicate would fail the whole write.
  const known = new Set(shows.map((show) => show.id));
  const carried = unreadable.filter((row) => !known.has(row.id));
  const payload = [...encrypted, ...carried];
  // An empty list is a deliberate "delete everything" from the app (saves only
  // run after the initial load), so tell the server it's intentional — without
  // the flag it refuses empty saves as a safety net against bugs. Carried rows
  // count: with one of those still to write, this isn't an empty save.
  const deleteAll = payload.length === 0;
  const a = auth(creds);
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
      if (!show) return "a show this device couldn't open";
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
export async function exportUserData(creds: SessionCredentials): Promise<string> {
  const { shows, unreadable } = await loadEncryptedShows(creds);
  const settings = await loadEncryptedSettings(creds);
  const payload = JSON.stringify(
    {
      shows,
      settings,
      // Rows this device couldn't decrypt, exported as the ciphertext they are.
      // This file is the user's own copy of their account — quietly leaving
      // rows out of it is the one place that omission really costs something.
      // The key is absent entirely when there's nothing to report.
      ...(unreadable.length > 0 ? { unreadableShows: unreadable } : {}),
      exportedAt: new Date().toISOString(),
    },
    null,
    2,
  );
  const blob = new Blob([payload], { type: "application/json" });
  return URL.createObjectURL(blob);
}

/**
 * Load encrypted settings from the backend.
 */
export async function loadEncryptedSettings(creds: SessionCredentials): Promise<AppSettings> {
  const { encryptedData } = await api.get<{ encryptedData: string | null }>(
    "/api/settings",
    auth(creds),
  );
  if (!encryptedData) return DEFAULT_SETTINGS;
  const settings = decryptWithKeys<AppSettings>(encryptedData, readKeys(creds));
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
  if (!Array.isArray(settings.emailList)) settings.emailList = [];
  if (!Array.isArray(settings.scheduleTemplates)) settings.scheduleTemplates = [];
  // Templates only ever hold plain text and numbers. Re-stripping on load
  // keeps that true even for a blob written by an older or newer build — audio
  // in here would count against the settings size ceiling and could make the
  // whole account unsavable.
  settings.scheduleTemplates = settings.scheduleTemplates.map((tpl) => ({
    ...tpl,
    items: (tpl.items || []).map((item) => ({
      time: item.time ?? "",
      description: item.description ?? "",
      performer: item.performer || undefined,
      durationMin: item.durationMin,
    })),
  }));
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
  creds: SessionCredentials,
): Promise<void> {
  const encryptedData = encryptWithKey(settings, creds.key);
  // Same platform request-size ceiling as shows — never fire a doomed request.
  if (encryptedData.length > MAX_SAVE_BYTES) {
    throw new PayloadTooLargeError(
      "Your settings are too large to save — usually an over-full trash or a large embedded walk-on track. Empty the trash to fix it.",
    );
  }
  await api.put("/api/settings", { encryptedData }, auth(creds));
}

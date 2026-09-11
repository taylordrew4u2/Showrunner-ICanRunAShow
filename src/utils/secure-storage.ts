import CryptoJS from "crypto-js";
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
  const loaded = decryptShowRows(shows, creds);
  const readable = new Map(loaded.shows.map(show => [show.id, JSON.stringify(show)]));
  showBaselines.set(creds, new Map(shows.map(row => [row.id, {
    cipher: row.encryptedData, plain: readable.get(row.id),
  }])));
  return loaded;
}

function decryptShowRows(shows: EncryptedShowRow[], creds: SessionCredentials): LoadedShows {
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

interface SavedRow { cipher: string; plain?: string }
const showBaselines = new WeakMap<SessionCredentials, Map<string, SavedRow>>();
const showCipherCache = new WeakMap<Show, { key: string; cipher: string }>();

/** Save only changes against the version this tab actually loaded. */
export async function saveEncryptedShows(
  shows: Show[], creds: SessionCredentials, unreadable: EncryptedShowRow[] = [],
): Promise<void> {
  const baseline = showBaselines.get(creds);
  if (!baseline) throw new Error('Load the account before saving shows.');
  const desired = new Map<string, SavedRow>();
  for (const show of shows) {
    const plain = JSON.stringify(show);
    const previous = baseline.get(show.id);
    if (previous?.plain === plain) { desired.set(show.id, previous); continue; }
    let cached = showCipherCache.get(show);
    if (!cached || cached.key !== creds.key) {
      cached = { key: creds.key, cipher: encryptWithKey(show, creds.key) };
      showCipherCache.set(show, cached);
    }
    desired.set(show.id, { cipher: cached.cipher, plain });
  }
  for (const row of unreadable) {
    if (!desired.has(row.id)) desired.set(row.id, { cipher: row.encryptedData });
  }
  const changes = [];
  for (const id of new Set([...baseline.keys(), ...desired.keys()])) {
    const previous = baseline.get(id);
    const next = desired.get(id);
    if (previous?.cipher === next?.cipher) continue;
    changes.push({ id, expectedHash: previous ? CryptoJS.SHA256(previous.cipher).toString() : null,
      encryptedData: next?.cipher ?? null });
  }
  // Independent batches only touch named rows; there is no destructive final
  // "prune everything missing" request. A failed batch can be safely retried.
  let batch: typeof changes = [];
  let bytes = 32;
  const batches: (typeof changes)[] = [];
  for (const change of changes) {
    const size = new TextEncoder().encode(JSON.stringify(change)).length + 1;
    if (size + 32 > MAX_SAVE_BYTES) {
      const show = shows.find(s => s.id === change.id);
      throw new PayloadTooLargeError(`One show is too large to save: ${show?.name ?? change.id}. ${show ? describeLargestMedia(show) : ''}`);
    }
    if (bytes + size > MAX_SAVE_BYTES) { batches.push(batch); batch = []; bytes = 32; }
    batch.push(change); bytes += size;
  }
  if (batch.length) batches.push(batch);
  for (const changes of batches) {
    await api.put('/api/shows', { changes }, auth(creds));
    for (const change of changes) {
      const saved = desired.get(change.id);
      if (saved) baseline.set(change.id, saved); else baseline.delete(change.id);
    }
  }
}

/**
 * Export all user data as a downloadable JSON blob (unencrypted).
 * Returns a Blob URL the caller can use for a download link.
 */
export async function exportUserData(
  creds: SessionCredentials,
  local?: LoadedShows & { settings: AppSettings },
): Promise<string> {
  const data = local ?? await (async () => {
    const rows = await api.get<{ shows: EncryptedShowRow[] }>("/api/shows", auth(creds));
    return { ...decryptShowRows(rows.shows, creds), settings: await loadEncryptedSettings(creds) };
  })();
  const { shows, unreadable, settings } = data;
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

/**
 * One earlier save the server still holds. `shows` snapshots are the whole
 * list as it stood; `settings` snapshots are the Rolodex, contracts, music
 * library and the rest, as they stood. See api/_lib/snapshots.ts for how
 * long each is kept.
 */
export interface Snapshot {
  kind: "shows" | "settings";
  /** The server's `backed_up_at`, in SQLite's `YYYY-MM-DD HH:MM:SS` UTC form. */
  at: string;
  /** Rows in a shows snapshot; absent for settings. */
  count?: number;
}

/** Every earlier save of either kind, newest first. */
export async function listSnapshots(creds: SessionCredentials): Promise<Snapshot[]> {
  const a = auth(creds);
  const [shows, settings] = await Promise.all([
    api.get<{ snapshots: { at: string; count: number }[] }>("/api/shows?history=1", a),
    api.get<{ snapshots: { at: string }[] }>("/api/settings?history=1", a),
  ]);
  const all: Snapshot[] = [
    ...shows.snapshots.map((s) => ({ kind: "shows" as const, at: s.at, count: s.count })),
    ...settings.snapshots.map((s) => ({ kind: "settings" as const, at: s.at })),
  ];
  return all.sort((x, y) => (x.at < y.at ? 1 : x.at > y.at ? -1 : 0));
}

/** The shows exactly as one earlier save held them. */
export async function loadShowsSnapshot(
  creds: SessionCredentials,
  at: string,
): Promise<LoadedShows> {
  const { shows } = await api.get<{ shows: EncryptedShowRow[] }>(
    `/api/shows?at=${encodeURIComponent(at)}`,
    auth(creds),
  );
  return decryptShowRows(shows, creds);
}

/** The settings exactly as one earlier save held them. */
export async function loadSettingsSnapshot(
  creds: SessionCredentials,
  at: string,
): Promise<AppSettings> {
  const { encryptedData } = await api.get<{ encryptedData: string }>(
    `/api/settings?at=${encodeURIComponent(at)}`,
    auth(creds),
  );
  return migrateSettings(decryptWithKeys<AppSettings>(encryptedData, readKeys(creds)));
}

/**
 * Keep a copy of these settings on the account without making them current.
 * For a device's held copy that is too old to trust over what the account has
 * since become: it goes into the same list as every other earlier version,
 * where it can be looked at and brought back on purpose, instead of the bin.
 */
export async function parkSettingsSnapshot(
  settings: AppSettings,
  creds: SessionCredentials,
): Promise<void> {
  const encryptedData = encryptWithKey(settings, creds.key);
  // Throws rather than resolving quietly. The caller drops its held copy once
  // this resolves, and a blob too large to save is precisely the blob that
  // held copy was written for — returning here deleted the only copy of a
  // producer's Rolodex and contracts a week after the save that failed.
  if (encryptedData.length > MAX_SAVE_BYTES) {
    throw new PayloadTooLargeError(
      "Those settings are too large to keep a copy of on your account. Empty the trash to fix it.",
    );
  }
  await api.put("/api/settings", { encryptedData, park: true }, auth(creds));
}

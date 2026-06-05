import { createClient, type Client } from "@libsql/client";

// ─── Turso Client (Vite web app) ─────────────────────────────────────────────
// Credentials are read from build-time env vars (VITE_*). For local dev,
// set them in .env.local — see .env.example for the required keys. Without
// them, the app surfaces a clear error rather than connecting to a stub.

const TURSO_DATABASE_URL = import.meta.env.VITE_TURSO_DATABASE_URL as string | undefined;
const TURSO_AUTH_TOKEN = import.meta.env.VITE_TURSO_AUTH_TOKEN as string | undefined;

let _client: Client | null = null;

export function getClient(): Client {
  if (!_client) {
    if (!TURSO_DATABASE_URL || !TURSO_AUTH_TOKEN) {
      throw new Error(
        "Turso credentials missing. Set VITE_TURSO_DATABASE_URL and " +
          "VITE_TURSO_AUTH_TOKEN in your environment (.env.local for dev, " +
          "Vercel env vars for production).",
      );
    }
    _client = createClient({
      url: TURSO_DATABASE_URL,
      authToken: TURSO_AUTH_TOKEN,
    });
  }
  return _client;
}

// ─── Schema bootstrap (idempotent) ───────────────────────────────────────────

let _initialised = false;

export async function ensureSchema(): Promise<void> {
  if (_initialised) return;
  const db = getClient();
  await db.batch([
    `CREATE TABLE IF NOT EXISTS users (
       id             TEXT PRIMARY KEY,
       password_hash  TEXT NOT NULL,
       salt           TEXT,
       kdf_iterations INTEGER,
       created_at     TEXT NOT NULL DEFAULT (datetime('now'))
     )`,
    `CREATE TABLE IF NOT EXISTS user_shows (
       id         TEXT PRIMARY KEY,
       user_id    TEXT NOT NULL,
       encrypted_data TEXT NOT NULL,
       created_at TEXT NOT NULL DEFAULT (datetime('now')),
       updated_at TEXT NOT NULL DEFAULT (datetime('now')),
       FOREIGN KEY (user_id) REFERENCES users(id)
     )`,
    `CREATE TABLE IF NOT EXISTS user_settings (
       user_id TEXT PRIMARY KEY,
       encrypted_data TEXT NOT NULL,
       updated_at TEXT NOT NULL DEFAULT (datetime('now')),
       FOREIGN KEY (user_id) REFERENCES users(id)
     )`,
    `CREATE TABLE IF NOT EXISTS user_shows_backup (
       id             TEXT NOT NULL,
       user_id        TEXT NOT NULL,
       encrypted_data TEXT NOT NULL,
       backed_up_at   TEXT NOT NULL DEFAULT (datetime('now')),
       PRIMARY KEY (id, backed_up_at)
     )`,
    `CREATE TABLE IF NOT EXISTS live_view (
       token      TEXT PRIMARY KEY,
       payload    TEXT NOT NULL,
       updated_at TEXT NOT NULL DEFAULT (datetime('now'))
     )`,
    `CREATE TABLE IF NOT EXISTS artist_signup (
       token      TEXT PRIMARY KEY,
       payload    TEXT NOT NULL,
       updated_at TEXT NOT NULL DEFAULT (datetime('now'))
     )`,
    `CREATE TABLE IF NOT EXISTS artist_signup_entries (
       id            TEXT PRIMARY KEY,
       token         TEXT NOT NULL,
       name          TEXT NOT NULL,
       phone         TEXT,
       email         TEXT,
       image_number  INTEGER,
       color         TEXT,
       completed     INTEGER DEFAULT 0,
       created_at    TEXT NOT NULL DEFAULT (datetime('now'))
     )`,
  ]);
  // Add email column for existing installs (no-op if it already exists).
  try {
    await db.execute(`ALTER TABLE artist_signup_entries ADD COLUMN email TEXT`);
  } catch { /* column already exists */ }
  // Per-user KDF columns for existing installs (no-op if they already exist).
  // Existing rows keep NULL salt → the legacy key-derivation path applies.
  try {
    await db.execute(`ALTER TABLE users ADD COLUMN salt TEXT`);
  } catch { /* column already exists */ }
  try {
    await db.execute(`ALTER TABLE users ADD COLUMN kdf_iterations INTEGER`);
  } catch { /* column already exists */ }
  _initialised = true;
}

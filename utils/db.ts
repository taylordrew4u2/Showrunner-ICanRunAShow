import { createClient, type Client } from "@libsql/client/web";

// ─── Turso Client (Expo / React Native) ──────────────────────────────────────

const TURSO_DATABASE_URL = process.env.EXPO_PUBLIC_TURSO_DATABASE_URL || "";

const TURSO_AUTH_TOKEN = process.env.EXPO_PUBLIC_TURSO_AUTH_TOKEN || "";

let _client: Client | null = null;

export function getClient(): Client {
  if (!_client) {
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
    `CREATE TABLE IF NOT EXISTS user_shows (
       id         TEXT PRIMARY KEY,
       user_id    TEXT NOT NULL,
       encrypted_data TEXT NOT NULL,
       created_at TEXT NOT NULL DEFAULT (datetime('now')),
       updated_at TEXT NOT NULL DEFAULT (datetime('now')),
       FOREIGN KEY (user_id) REFERENCES users(id)
     )`,
    `CREATE TABLE IF NOT EXISTS users (
       id            TEXT PRIMARY KEY,
       password_hash TEXT NOT NULL,
       created_at    TEXT NOT NULL DEFAULT (datetime('now'))
     )`,
    `CREATE TABLE IF NOT EXISTS user_settings (
       user_id TEXT PRIMARY KEY,
       encrypted_data TEXT NOT NULL,
       updated_at TEXT NOT NULL DEFAULT (datetime('now')),
       FOREIGN KEY (user_id) REFERENCES users(id)
     )`,
  ]);
  _initialised = true;
}

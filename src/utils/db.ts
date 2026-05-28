import { createClient, type Client } from "@libsql/client";

// ─── Turso Client (Vite web app) ─────────────────────────────────────────────

const TURSO_DATABASE_URL = import.meta.env.VITE_TURSO_DATABASE_URL || "libsql://database-bistre-horizon-vercel-icfg-bcu7zzamdox9nbdpkugsrnzd.aws-us-east-1.turso.io";

const TURSO_AUTH_TOKEN = import.meta.env.VITE_TURSO_AUTH_TOKEN || "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJpYXQiOjE3NzIwNDYyMTYsImlkIjoiMDE5Yzk2MmYtNmEwMS03ODI3LTk3Y2QtNjFmYWY3ZGE1OGYyIiwicmlkIjoiM2JhMzVkZDItMWIwOS00ZjlkLWJkN2QtNmI4NzUwMzQzOThmIn0.8kRrdjTNeV1OTBxs8qCjg_STs4OwV_gMzWfusfpHSsaFya8txL1G7i8wJZsDeLoy78d1HoUxg0NdcosvAhWrAQ";

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
    `CREATE TABLE IF NOT EXISTS users (
       id            TEXT PRIMARY KEY,
       password_hash TEXT NOT NULL,
       created_at    TEXT NOT NULL DEFAULT (datetime('now'))
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
       image_number  INTEGER,
       color         TEXT,
       completed     INTEGER DEFAULT 0,
       created_at    TEXT NOT NULL DEFAULT (datetime('now'))
     )`,
  ]);
  _initialised = true;
}

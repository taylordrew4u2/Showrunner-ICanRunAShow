// Server-side database layer. Files under api/_lib are NOT routes (Vercel
// excludes underscore-prefixed paths). Uses @libsql/client directly against
// Turso — no ORM engine to bundle, which makes it reliable on Vercel's Node
// runtime. The connection lives ONLY in server env vars; it never ships to the
// browser. The app's data is encrypted client-side, so these tables only ever
// hold opaque ciphertext blobs.
// `/web` = the fetch-based client (no Node-native deps) — works on Vercel's
// edge runtime, the same client the app used from the browser.
import { createClient, type Client } from '@libsql/client/web';

const TURSO_DATABASE_URL = process.env.TURSO_DATABASE_URL;
const TURSO_AUTH_TOKEN = process.env.TURSO_AUTH_TOKEN;

/** Thrown when the DB connection env vars are missing. Routes turn this into a 503. */
export class ServerNotConfiguredError extends Error {
  constructor() {
    super(
      'Database not configured. Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN in the server environment.',
    );
    this.name = 'ServerNotConfiguredError';
  }
}

export function isConfigured(): boolean {
  return !!TURSO_DATABASE_URL;
}

// Reuse the client across warm invocations.
let _client: Client | null = null;

export function getDb(): Client {
  if (!TURSO_DATABASE_URL) throw new ServerNotConfiguredError();
  if (!_client) {
    _client = createClient({ url: TURSO_DATABASE_URL, authToken: TURSO_AUTH_TOKEN });
  }
  return _client;
}

// Idempotent schema bootstrap — proven DDL, run once per warm instance.
const DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS users (
     id            TEXT PRIMARY KEY,
     password_hash TEXT NOT NULL,
     auth_salt     TEXT,
     auth_version  INTEGER NOT NULL DEFAULT 1,
     created_at    TEXT NOT NULL DEFAULT (datetime('now'))
   )`,
  `CREATE TABLE IF NOT EXISTS rate_limit (
     bucket       TEXT PRIMARY KEY,
     count        INTEGER NOT NULL DEFAULT 0,
     window_start TEXT NOT NULL DEFAULT (datetime('now'))
   )`,
  `CREATE TABLE IF NOT EXISTS user_shows (
     id         TEXT PRIMARY KEY,
     user_id    TEXT NOT NULL,
     encrypted_data TEXT NOT NULL,
     created_at TEXT NOT NULL DEFAULT (datetime('now')),
     updated_at TEXT NOT NULL DEFAULT (datetime('now'))
   )`,
  `CREATE TABLE IF NOT EXISTS user_settings (
     user_id TEXT PRIMARY KEY,
     encrypted_data TEXT NOT NULL,
     updated_at TEXT NOT NULL DEFAULT (datetime('now'))
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
];

// Columns added after the original `users` table shipped. CREATE TABLE IF NOT
// EXISTS won't add them to an existing table, so ALTER each in — ignoring the
// "duplicate column" error when it's already there (SQLite has no idempotent
// ADD COLUMN). Existing rows keep auth_version = 1 and upgrade on next login.
const MIGRATIONS: string[] = [
  `ALTER TABLE users ADD COLUMN auth_salt TEXT`,
  `ALTER TABLE users ADD COLUMN auth_version INTEGER NOT NULL DEFAULT 1`,
];

async function runMigrations(db: Client): Promise<void> {
  for (const sql of MIGRATIONS) {
    try {
      await db.execute(sql);
    } catch (err) {
      if (!/duplicate column/i.test(String(err))) throw err;
    }
  }
}

let _schemaReady: Promise<void> | null = null;

export function ensureSchema(): Promise<void> {
  if (!_schemaReady) {
    const db = getDb();
    _schemaReady = db
      .batch(DDL, 'write')
      .then(() => runMigrations(db))
      .catch((err) => {
        _schemaReady = null; // allow a later retry on a fresh request
        throw err;
      });
  }
  return _schemaReady;
}

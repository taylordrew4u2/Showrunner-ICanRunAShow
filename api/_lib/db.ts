// Server-side database layer. Files under api/_lib are NOT turned into routes
// (the leading underscore is excluded by Vercel). Prisma talks to Turso (libSQL)
// using a connection that lives ONLY in server env vars — it never ships to the
// browser. The app's data is encrypted client-side, so these tables only ever
// hold opaque ciphertext blobs.
import { PrismaClient } from '@prisma/client';
import { PrismaLibSQL } from '@prisma/adapter-libsql';

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
let _prisma: PrismaClient | null = null;

export function getPrisma(): PrismaClient {
  if (!TURSO_DATABASE_URL) throw new ServerNotConfiguredError();
  if (!_prisma) {
    const adapter = new PrismaLibSQL({
      url: TURSO_DATABASE_URL,
      authToken: TURSO_AUTH_TOKEN,
    });
    _prisma = new PrismaClient({ adapter });
  }
  return _prisma;
}

// Idempotent schema bootstrap — proven DDL, run once per warm instance. Using
// raw `CREATE TABLE IF NOT EXISTS` avoids Prisma migrate friction against Turso.
const DDL: string[] = [
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

let _schemaReady: Promise<void> | null = null;

export function ensureSchema(): Promise<void> {
  if (!_schemaReady) {
    const prisma = getPrisma();
    _schemaReady = (async () => {
      for (const stmt of DDL) {
        await prisma.$executeRawUnsafe(stmt);
      }
    })().catch((err) => {
      _schemaReady = null; // allow a later retry on a fresh request
      throw err;
    });
  }
  return _schemaReady;
}

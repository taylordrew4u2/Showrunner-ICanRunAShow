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
  // `auth_version` is how the server wraps the stored verifier;
  // `client_hash_version` is which client credential it wraps. See
  // _lib/credentials.ts.
  `CREATE TABLE IF NOT EXISTS users (
     id                  TEXT PRIMARY KEY,
     password_hash       TEXT NOT NULL,
     auth_salt           TEXT,
     auth_version        INTEGER NOT NULL DEFAULT 1,
     client_hash_version INTEGER NOT NULL DEFAULT 1,
     created_at          TEXT NOT NULL DEFAULT (datetime('now'))
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
  // `parked` marks a row that is a device's only copy of unsaved work rather
  // than a copy of a save — see parkSettingsSnapshot. Retention leaves those
  // alone; an ordinary run of saves must not be able to flush one. Both
  // backup tables carry the column so retention is one rule; only settings
  // are parked today.
  `CREATE TABLE IF NOT EXISTS user_shows_backup (
     id             TEXT NOT NULL,
     user_id        TEXT NOT NULL,
     encrypted_data TEXT NOT NULL,
     backed_up_at   TEXT NOT NULL DEFAULT (datetime('now')),
     parked         INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY (id, backed_up_at)
   )`,
  // The settings blob carries the Rolodex, the contracts and every signed
  // record, and used to be overwritten in place with no copy kept anywhere.
  // Snapshotted on every save now, same as shows — see _lib/snapshots.ts.
  `CREATE TABLE IF NOT EXISTS user_settings_backup (
     user_id        TEXT NOT NULL,
     encrypted_data TEXT NOT NULL,
     backed_up_at   TEXT NOT NULL DEFAULT (datetime('now')),
     parked         INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY (user_id, backed_up_at)
   )`,
  // `user_id` is who may publish to this token. The token itself is handed to
  // the audience, so it cannot also be the permission to write — see api/live.ts.
  `CREATE TABLE IF NOT EXISTS live_view (
     token      TEXT PRIMARY KEY,
     user_id    TEXT,
     payload    TEXT NOT NULL,
     updated_at TEXT NOT NULL DEFAULT (datetime('now'))
   )`,
  `CREATE TABLE IF NOT EXISTS user_media (
     user_id    TEXT NOT NULL,
     id         TEXT NOT NULL,
     seq        INTEGER NOT NULL,
     total      INTEGER NOT NULL,
     data       TEXT NOT NULL,
     created_at TEXT NOT NULL DEFAULT (datetime('now')),
     PRIMARY KEY (user_id, id, seq)
   )`,
  // Soundboard audio published to a show's live viewers, so the machine
  // plugged into the PA can play the walk-ons. Keyed by the viewer token
  // rather than a user, because the reader is anonymous. Still ciphertext:
  // it's encrypted under a per-show key that only ever exists in the viewer
  // link's fragment, so the server holds bytes it cannot read.
  // A contract sent to one person for signature, addressed by an unguessable
  // token. `payload` and `signature` are both ciphertext under a per-request
  // key that only ever exists in the link's fragment and in the producer's own
  // encrypted settings — the server stores the fact that a signature happened
  // and when, and can read nothing else about it.
  //
  // `bytes` is the signature's size, which counts against the producer who
  // made the link — see _lib/linkStorage.ts.
  `CREATE TABLE IF NOT EXISTS sign_request (
     token      TEXT PRIMARY KEY,
     user_id    TEXT,
     payload    TEXT NOT NULL,
     signature  TEXT,
     signed_at  TEXT,
     created_at TEXT NOT NULL DEFAULT (datetime('now')),
     bytes      INTEGER
   )`,
  // The contract PDF itself, re-encrypted under that same per-request key and
  // chunked exactly like live_media. One document per token.
  //
  // Each of the three chunk tables below names the account its chunks count
  // against (`user_id`) and how big each one is (`bytes`), so every link an
  // account hands out draws on one allowance — see _lib/linkStorage.ts.
  `CREATE TABLE IF NOT EXISTS sign_doc (
     token      TEXT NOT NULL,
     seq        INTEGER NOT NULL,
     total      INTEGER NOT NULL,
     data       TEXT NOT NULL,
     created_at TEXT NOT NULL DEFAULT (datetime('now')),
     user_id    TEXT,
     bytes      INTEGER,
     PRIMARY KEY (token, seq)
   )`,
  // A headshot sent back through a profile link. Written anonymously by the
  // performer — the one place a stranger may write chunks — and only while the
  // link is still unanswered; the once-only reply seals it. Ciphertext under
  // the link's own key, like everything else addressed by a token. `user_id`
  // is the producer who made the link, not the stranger who wrote the chunk.
  `CREATE TABLE IF NOT EXISTS profile_photo (
     token      TEXT NOT NULL,
     seq        INTEGER NOT NULL,
     total      INTEGER NOT NULL,
     data       TEXT NOT NULL,
     created_at TEXT NOT NULL DEFAULT (datetime('now')),
     user_id    TEXT,
     bytes      INTEGER,
     PRIMARY KEY (token, seq)
   )`,
  `CREATE TABLE IF NOT EXISTS live_media (
     token      TEXT NOT NULL,
     id         TEXT NOT NULL,
     seq        INTEGER NOT NULL,
     total      INTEGER NOT NULL,
     data       TEXT NOT NULL,
     created_at TEXT NOT NULL DEFAULT (datetime('now')),
     user_id    TEXT,
     bytes      INTEGER,
     PRIMARY KEY (token, id, seq)
   )`,
  // One row per account that has ever started a Stripe checkout. Stripe is
  // the source of truth; this is the last state its webhook reported, so the
  // app can answer "is this account paid?" without calling Stripe per request.
  // `cancel_at` is when a cancelled subscription that is still active stops.
  `CREATE TABLE IF NOT EXISTS subscription (
     user_id            TEXT PRIMARY KEY,
     customer_id        TEXT,
     subscription_id    TEXT,
     status             TEXT,
     current_period_end INTEGER,
     cancel_at          INTEGER,
     updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
   )`,
];

// Columns added after the original `users` table shipped. CREATE TABLE IF NOT
// EXISTS won't add them to an existing table, so ALTER each in — ignoring the
// "duplicate column" error when it's already there (SQLite has no idempotent
// ADD COLUMN). Existing rows keep auth_version = 1 and upgrade on next login.
const MIGRATIONS: string[] = [
  `ALTER TABLE users ADD COLUMN auth_salt TEXT`,
  `ALTER TABLE users ADD COLUMN auth_version INTEGER NOT NULL DEFAULT 1`,
  // Rows published before publishing required auth have no owner. They are
  // claimed by the first authenticated publish to the same token, which is the
  // producer whose show it is — nobody else has the token in a state where
  // they could publish it. See api/live.ts.
  `ALTER TABLE live_view ADD COLUMN user_id TEXT`,
  // Signing and profile links made before this name no account, and unlike
  // a viewer link nobody may claim one: the producer never writes under an
  // old token again, so the next account to try is whoever was sent it.
  // See api/_lib/tokenOwnership.ts.
  `ALTER TABLE sign_request ADD COLUMN user_id TEXT`,
  // Parked copies were ordinary rows before, and were pruned like them.
  `ALTER TABLE user_settings_backup ADD COLUMN parked INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE user_shows_backup ADD COLUMN parked INTEGER NOT NULL DEFAULT 0`,
  // Cancelling in the portal leaves a subscription active to the end of its
  // period, and the plan card said "Renews" over it until then.
  `ALTER TABLE subscription ADD COLUMN cancel_at INTEGER`,
  // Every verifier stored before this column wraps the original SHA-256 client
  // hash, which is what the default says. Each moves to the per-account
  // credential at its account's next sign-in.
  `ALTER TABLE users ADD COLUMN client_hash_version INTEGER NOT NULL DEFAULT 1`,
  // Every token used to get its own cap, and a fresh token is free to mint, so
  // the caps added up to no limit at all. Chunks stored before these columns
  // name no account and count against nobody — see _lib/linkStorage.ts.
  `ALTER TABLE sign_doc ADD COLUMN user_id TEXT`,
  `ALTER TABLE sign_doc ADD COLUMN bytes INTEGER`,
  `ALTER TABLE live_media ADD COLUMN user_id TEXT`,
  `ALTER TABLE live_media ADD COLUMN bytes INTEGER`,
  `ALTER TABLE profile_photo ADD COLUMN user_id TEXT`,
  `ALTER TABLE profile_photo ADD COLUMN bytes INTEGER`,
  // The allowance is added up on every chunk written, so it has to come from
  // an index of the account's own chunks, never from the chunks themselves.
  // Here rather than with the tables: on a database from before, the columns
  // only exist once the ALTERs above have run. IF NOT EXISTS keeps it safe to
  // repeat like the rest.
  `CREATE INDEX IF NOT EXISTS sign_doc_by_user ON sign_doc (user_id, token, seq, bytes)`,
  `CREATE INDEX IF NOT EXISTS live_media_by_user ON live_media (user_id, token, id, seq, bytes)`,
  `CREATE INDEX IF NOT EXISTS profile_photo_by_user ON profile_photo (user_id, token, seq, bytes)`,
  // Whose a token is gets asked the other way round: by token, on every live
  // publish and on every chunk written under a link with no row yet (see
  // _lib/tokenOwnership.ts). A row keeps `user_id` after the chunk's data —
  // ADD COLUMN can only put it there — so reading it from the row reads
  // through megabytes of ciphertext to reach it: a whole board's worth on
  // every cue the board published.
  `CREATE INDEX IF NOT EXISTS sign_doc_by_token ON sign_doc (token, user_id)`,
  `CREATE INDEX IF NOT EXISTS live_media_by_token ON live_media (token, user_id)`,
  // The link rows count too: a signing or profile link, and a viewer link,
  // each take a place among an account's links, and a signature's size
  // counts against the producer who made the link. Signatures stored before
  // this column count for nothing. `user_id` sits after the payload and the
  // signature on a row from before owners were recorded, so the allowance
  // reads these indexes, never the rows.
  `ALTER TABLE sign_request ADD COLUMN bytes INTEGER`,
  `CREATE INDEX IF NOT EXISTS sign_request_by_user ON sign_request (user_id, token, bytes)`,
  `CREATE INDEX IF NOT EXISTS live_view_by_user ON live_view (user_id, token)`,
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

/**
 * Create every table and add the columns that came later. Safe to repeat.
 * Exported so the server tests run against the real schema and migrations —
 * the account-deletion test in particular notices a table added later that
 * deletion does not know about.
 */
export async function applySchema(db: Client): Promise<void> {
  await db.batch(DDL, 'write');
  await runMigrations(db);
}

let _schemaReady: Promise<void> | null = null;

export function ensureSchema(): Promise<void> {
  if (!_schemaReady) {
    _schemaReady = applySchema(getDb()).catch((err) => {
      _schemaReady = null; // allow a later retry on a fresh request
      throw err;
    });
  }
  return _schemaReady;
}

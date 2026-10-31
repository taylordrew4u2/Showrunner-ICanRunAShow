// POST /api/auth — signup / login.
// Body: { action: 'signup' | 'login', userId, authKey?, passwordHash? }
// The browser derives userId and the credentials; the raw password never
// reaches the server. authKey is the per-account credential a current build
// sends; passwordHash is the old SHA-256 one, sent by builds from before it and,
// once, by a current build moving an old account over. We store a salted, slow
// PBKDF2 hash of the credential (never the credential itself) — see
// _lib/credentials.
import { ensureSchema, getDb } from './_lib/db';
import { handleError, json, readJson } from './_lib/http';
import { hashCredential, verifySignIn, type StoredCredential } from './_lib/credentials';
import { clientAddress, rateLimit, rateLimitPeek, rateLimitRefund } from './_lib/ratelimit';

interface AuthBody {
  action: 'signup' | 'login';
  userId: string;
  authKey?: unknown;
  passwordHash?: unknown;
}

// The account id and both credentials are hex digests the browser derives
// (32 and 64 characters). Anything longer is not from the app, and the account
// name goes into a rate-limit bucket's key: a made-up name of any size became
// a row kept for good.
const MAX_CREDENTIAL_CHARS = 128;

function badCredential(value: unknown): boolean {
  return typeof value !== 'string' || value.length === 0 || value.length > MAX_CREDENTIAL_CHARS;
}

/**
 * A credential as sent: undefined when it was left out, null when it was sent
 * but is not one (the request is refused), else the string.
 */
const credential = (value: unknown): string | undefined | null =>
  value === undefined ? undefined : badCredential(value) ? null : (value as string);

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  try {
    const body = await readJson<AuthBody>(req);
    const { action, userId } = body;
    const sentKey = credential(body.authKey);
    const sentHash = credential(body.passwordHash);
    // Either credential may be left out, but one that is sent must look like
    // one, and at least one must come.
    if (badCredential(userId) || sentKey === null || sentHash === null) return json({ error: 'bad_request' }, 400);
    const authKey = sentKey;
    const passwordHash = sentHash;
    const newest = authKey ?? passwordHash;
    if (!newest) return json({ error: 'bad_request' }, 400);

    await ensureSchema();
    const db = getDb();

    // Throttle brute force: 10 failed attempts per account per address per 5
    // minutes. Per address, and failures only — counting every attempt by
    // account alone let anyone who knew a username lock its producer out
    // from anywhere, and the right password from a new phone was refused.
    //
    // A sign-in spends a try before the slow check and gets it back if the
    // check passes. Looking before and writing after a failure let through
    // every guess that arrived before the first failures were written: sixty
    // at once from one address were all checked.
    const address = clientAddress(req);
    const failures = `auth:${userId}:${address}`;
    const room = action === 'login'
      ? await rateLimit(db, failures, 10, 300)
      : await rateLimitPeek(db, failures, 10, 300);
    if (!room.allowed) return json({ error: 'too_many_requests' }, 429);

    if (action === 'signup') {
      // Accounts are free to make. One address making dozens an hour is not a
      // producer signing up; it is somebody filling the users table.
      if (!(await rateLimit(db, `signup:${address}`, 20, 3600)).allowed) return json({ error: 'too_many_requests' }, 429);
      const existing = await db.execute({ sql: `SELECT id FROM users WHERE id = ?`, args: [userId] });
      if (existing.rows.length > 0) return json({ error: 'account_exists' }, 409);
      // A current build signs up with the per-account credential. A build
      // still cached from before it sends only the old hash, and the account
      // is filed as v1 so that it moves over at its first sign-in from a
      // current build. Filed as v2, that sign-in could never match it.
      const clientVersion = authKey ? 2 : 1;
      const { salt, hash } = await hashCredential(newest);
      await db.execute({
        sql: `INSERT INTO users (id, password_hash, auth_salt, auth_version, client_hash_version) VALUES (?, ?, ?, 2, ?)`,
        args: [userId, hash, salt, clientVersion],
      });
      return json({ ok: true });
    }

    if (action === 'login') {
      const result = await db.execute({
        sql: `SELECT password_hash, auth_salt, auth_version, client_hash_version FROM users WHERE id = ?`,
        args: [userId],
      });
      // Counted already, as a failed attempt.
      if (result.rows.length === 0) return json({ ok: false });
      const row = result.rows[0];
      const stored: StoredCredential = {
        passwordHash: String(row[0]),
        authSalt: row[1] != null ? String(row[1]) : null,
        authVersion: Number(row[2] ?? 1),
        clientVersion: Number(row[3] ?? 1),
      };
      const { ok, missing, store } = await verifySignIn(stored, { authKey, passwordHash });
      // Nothing was tested, so neither answer counts as a failed attempt. A
      // build from before the per-account key, still cached on some device,
      // would otherwise spend the producer's ten tries with the right password.
      if (missing) await rateLimitRefund(db, failures);
      if (missing === 'passwordHash') return json({ ok: false, legacy: true });
      // That build's sign-in form reads a plain "no" as "Invalid username or
      // password", which told a producer typing the right password that it was
      // wrong — and a password cannot be recovered. An error reads "Failed to
      // sign in. Please try again" there instead, which is true: the same
      // password works once the app has reloaded into the current build.
      if (missing) return json({ error: 'update_required' }, 426);
      if (ok) await rateLimitRefund(db, failures);
      if (ok && store) {
        // Only over the verifier just checked. A request that replaced it in
        // the meantime checked the same password, so the account still opens
        // with it (at worst this device is asked to sign in once more).
        // Writing over it could leave a v1 verifier marked v2, which nothing
        // would ever open again.
        await db.execute({
          sql: `UPDATE users SET password_hash = ?, auth_salt = ?, auth_version = 2, client_hash_version = ?
                WHERE id = ? AND password_hash = ?`,
          args: [store.hash, store.salt, store.clientVersion, userId, stored.passwordHash],
        });
      }
      return json({ ok });
    }

    return json({ error: 'bad_request' }, 400);
  } catch (err) {
    return handleError(err);
  }
}

export const config = { runtime: 'edge' };

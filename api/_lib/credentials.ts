// Server-side credential hashing. Not a route (underscore-prefixed).
//
// The browser sends a client credential (x-auth, and authKey / passwordHash at
// sign-in). Historically that exact value was ALSO what we stored in the
// `users` table, which meant a database leak handed an attacker both a directly
// replayable bearer credential AND a fast hash that cracks to the real password
// offline. We now store a *salted, slow* PBKDF2 hash of that client credential
// with a per-user random salt, so a leaked row is neither replayable nor cheap
// to crack. Verification is constant-time. Legacy rows (auth_version 1) are
// verified the old way and transparently upgraded on the next successful auth.
//
// Which client credential a row wraps is a separate question, recorded in
// `client_hash_version`. Version 1 is the original SHA-256 of the password with
// a global salt; whoever saw it on the wire could crack it at SHA-256 speed.
// Version 2 is PBKDF2 of the password with a per-account salt (see
// src/utils/encryption deriveAuthKey). A v1 row moves to v2 at its next
// sign-in from a current build, and from then on only v2 opens it.
//
// Uses the Web Crypto API (available on Vercel's edge runtime) — native PBKDF2
// is fast enough to run on every authorized request.

const ITERATIONS = 210_000; // PBKDF2-SHA256; native, ~tens of ms on edge.
const KEYLEN_BYTES = 32;
const SALT_BYTES = 16;

const encoder = new TextEncoder();

function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return hex;
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

/**
 * Slow-hash a client-sent hash with PBKDF2-SHA256. Generates a fresh random
 * salt when one isn't supplied (signup / upgrade); reuses the stored salt when
 * verifying an existing row.
 */
async function pbkdf2(clientHash: string, salt: Uint8Array): Promise<string> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(clientHash) as BufferSource,
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    KEYLEN_BYTES * 8,
  );
  return bytesToHex(new Uint8Array(bits));
}

/** Produce a fresh {salt, hash} pair for a new or upgraded credential. */
export async function hashCredential(clientHash: string): Promise<{ salt: string; hash: string }> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await pbkdf2(clientHash, salt);
  return { salt: bytesToHex(salt), hash };
}

/** Constant-time string comparison (avoids leaking match length via timing). */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

export interface StoredCredential {
  passwordHash: string;
  authSalt: string | null;
  authVersion: number;
  /** Which client credential the verifier wraps: 1 = the SHA-256 hash, 2 = the per-account key. */
  clientVersion: number;
}

export interface VerifyResult {
  ok: boolean;
  /** Present when a legacy row matched and should be re-stored as a slow hash. */
  upgrade?: { salt: string; hash: string };
}

/**
 * Verify a client-sent hash against a stored credential, constant-time.
 * Legacy (version 1) rows verify against the raw stored hash and, on success,
 * return an `upgrade` the caller should persist (salt + slow hash, version 2).
 */
export async function verifyCredential(
  stored: StoredCredential,
  clientHash: string,
): Promise<VerifyResult> {
  if (stored.authVersion >= 2 && stored.authSalt) {
    const candidate = await pbkdf2(clientHash, hexToBytes(stored.authSalt));
    return { ok: timingSafeEqual(candidate, stored.passwordHash) };
  }
  // Legacy v1: the stored value IS the client hash.
  if (!timingSafeEqual(stored.passwordHash, clientHash)) return { ok: false };
  return { ok: true, upgrade: await hashCredential(clientHash) };
}

/** What a sign-in carries. A current build sends authKey; a build from before it sent only passwordHash. */
export interface SignInCredentials {
  /** v2: PBKDF2 of the password, salted per account. */
  authKey?: string;
  /** v1: the SHA-256 hash. Only needed to move a v1 account over. */
  passwordHash?: string;
}

export interface SignInResult {
  ok: boolean;
  /**
   * The sign-in did not carry the credential this account takes, so nothing
   * about the password was tested, and it is not a failed guess. 'passwordHash':
   * a v1 account signed in to by a current build, which sends again with the
   * old hash. 'authKey': a v2 account signed in to by a build from before it,
   * which has nothing else to send.
   */
  missing?: 'authKey' | 'passwordHash';
  /** A verifier to store in place of the one that matched, and the client version it wraps. */
  store?: { salt: string; hash: string; clientVersion: number };
}

/**
 * Check a sign-in against the stored credential, and say what to store when it
 * should change.
 *
 * A v2 account is checked against authKey alone. The v1 hash no longer opens it,
 * even beside a right authKey. A v1 account is checked against the v1 hash. When
 * that matches and an authKey came with it, the authKey is stored in its place.
 * The server cannot tell whether the two came from the same password, so it
 * trusts the browser that has just proved the old one.
 */
export async function verifySignIn(
  stored: StoredCredential,
  sent: SignInCredentials,
): Promise<SignInResult> {
  if (stored.clientVersion >= 2) {
    if (!sent.authKey) return { ok: false, missing: 'authKey' };
    const { ok, upgrade } = await verifyCredential(stored, sent.authKey);
    return ok && upgrade ? { ok, store: { ...upgrade, clientVersion: 2 } } : { ok };
  }
  if (!sent.passwordHash) return { ok: false, missing: 'passwordHash' };
  const { ok, upgrade } = await verifyCredential(stored, sent.passwordHash);
  if (!ok) return { ok: false };
  if (sent.authKey) return { ok: true, store: { ...(await hashCredential(sent.authKey)), clientVersion: 2 } };
  return upgrade ? { ok: true, store: { ...upgrade, clientVersion: 1 } } : { ok: true };
}

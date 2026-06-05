import CryptoJS from "crypto-js";

// Legacy, app-wide salt. Retained ONLY so accounts created before per-user
// salts keep deriving the same key/hash and can still decrypt their data.
const PASSWORD_SALT = "showrunner-salt-2024";
const LEGACY_ITERATIONS = 1000;

// Defaults for newly-created accounts: a per-user random salt + a much higher
// PBKDF2 iteration count over SHA-256. Stored per user so it can be tuned
// later without breaking existing accounts.
export const NEW_KDF_ITERATIONS = 100_000;

export interface KdfParams {
  salt: string; // per-user random salt (hex)
  iterations: number; // PBKDF2 iteration count
}

/** Generate a random per-user salt (128-bit, hex-encoded). */
export function generateSalt(): string {
  return CryptoJS.lib.WordArray.random(16).toString();
}

/**
 * Derive a stable user ID from an account identifier. Unchanged on purpose —
 * this keys every user's rows, so it must stay identical across versions.
 */
export function deriveUserId(identifier: string): string {
  return CryptoJS.SHA256(identifier + PASSWORD_SALT)
    .toString()
    .substring(0, 32);
}

// PBKDF2 is deliberately slow; memoize per (password, params) so repeated
// saves in a session don't re-run the full derivation each time.
const keyCache = new Map<string, string>();

function cacheId(password: string, params?: KdfParams): string {
  return params ? `v2:${params.iterations}:${params.salt}:${password}` : `v1:${password}`;
}

/**
 * Derive an AES key from a password. With `params` (new accounts) it uses the
 * per-user salt + iteration count over SHA-256; without them it reproduces the
 * legacy derivation so pre-existing data still decrypts.
 */
export function deriveKey(password: string, params?: KdfParams): string {
  const id = cacheId(password, params);
  const cached = keyCache.get(id);
  if (cached) return cached;

  const key = params
    ? CryptoJS.PBKDF2(password, params.salt, {
        keySize: 256 / 32,
        iterations: params.iterations,
        hasher: CryptoJS.algo.SHA256,
      }).toString()
    : CryptoJS.PBKDF2(password, PASSWORD_SALT, {
        keySize: 256 / 32,
        iterations: LEGACY_ITERATIONS,
      }).toString();

  keyCache.set(id, key);
  return key;
}

/**
 * Encrypt data with a password-derived key.
 */
export function encryptData(data: unknown, password: string, params?: KdfParams): string {
  return encryptWithKey(data, deriveKey(password, params));
}

/**
 * Decrypt data with a password-derived key.
 */
export function decryptData<T>(encrypted: string, password: string, params?: KdfParams): T {
  return decryptWithKey<T>(encrypted, deriveKey(password, params));
}

/**
 * Encrypt with an already-derived key. Use when processing many records with
 * the same password so PBKDF2 only runs once (deriveKey is intentionally slow).
 */
export function encryptWithKey(data: unknown, key: string): string {
  return CryptoJS.AES.encrypt(JSON.stringify(data), key).toString();
}

/**
 * Decrypt with an already-derived key (see encryptWithKey).
 */
export function decryptWithKey<T>(encrypted: string, key: string): T {
  const decrypted = CryptoJS.AES.decrypt(encrypted, key).toString(CryptoJS.enc.Utf8);
  return JSON.parse(decrypted) as T;
}

/**
 * Hash a password for authentication. New accounts pass their per-user salt;
 * legacy accounts (no salt) fall back to the app-wide salt.
 */
export function hashPassword(password: string, salt?: string): string {
  return CryptoJS.SHA256(password + (salt ?? PASSWORD_SALT)).toString();
}

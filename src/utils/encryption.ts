import CryptoJS from "crypto-js";

const PASSWORD_SALT = "showrunner-salt-2024";

// Encryption-key derivation (v2): PBKDF2-SHA256 with a 100× higher work factor
// than the original (1,000 → 100,000 iterations) and SHA-256 instead of the
// crypto-js default SHA-1. This is a large hardening over the original key while
// staying responsive in pure-JS crypto-js (it runs once per login, then the key
// is reused). Reaching OWASP's 600k target would require migrating to native
// WebCrypto/Argon2 — tracked as a follow-up.
//
// We keep the legacy (v1) derivation so data encrypted before this change still
// decrypts: reads try v2 first and fall back to v1; the next save re-encrypts
// with v2. No round-trip can lose data.
const KDF_V2 = {
  keySize: 256 / 32,
  iterations: 100_000,
  hasher: CryptoJS.algo.SHA256,
} as const;
const KDF_V1 = { keySize: 256 / 32, iterations: 1000 } as const; // original: SHA-1, 1k

/**
 * Derive a stable user ID from account identifier.
 * Used to organize data by user in the database. UNCHANGED across versions —
 * it is the primary key for every row, so it must stay stable.
 */
export function deriveUserId(identifier: string): string {
  return CryptoJS.SHA256(identifier + PASSWORD_SALT)
    .toString()
    .substring(0, 32);
}

/**
 * Derive the current (v2) encryption key from a password. Used to encrypt new
 * data and as the first decryption attempt.
 */
export function deriveKey(password: string): string {
  return CryptoJS.PBKDF2(password, PASSWORD_SALT, KDF_V2).toString();
}

/** Derive the legacy (v1) key — only used as a decryption fallback. */
function deriveLegacyKey(password: string): string {
  return CryptoJS.PBKDF2(password, PASSWORD_SALT, KDF_V1).toString();
}

/**
 * Every key to try when decrypting, newest first. Derive once per password and
 * reuse across a batch (PBKDF2 is deliberately slow).
 */
export function deriveKeys(password: string): string[] {
  return [deriveKey(password), deriveLegacyKey(password)];
}

/**
 * Encrypt data with password-derived key (always the current v2 key).
 */
export function encryptData(data: unknown, password: string): string {
  return encryptWithKey(data, deriveKey(password));
}

/**
 * Decrypt data with a password — tries the current key, then the legacy key.
 */
export function decryptData<T>(encrypted: string, password: string): T {
  return decryptWithKeys<T>(encrypted, deriveKeys(password));
}

/**
 * Encrypt with an already-derived key. Use when processing many records with
 * the same password so PBKDF2 only runs once (deriveKey is intentionally slow).
 */
export function encryptWithKey(data: unknown, key: string): string {
  return CryptoJS.AES.encrypt(JSON.stringify(data), key).toString();
}

/**
 * Decrypt with a single already-derived key (see encryptWithKey).
 */
export function decryptWithKey<T>(encrypted: string, key: string): T {
  return decryptWithKeys<T>(encrypted, [key]);
}

/**
 * Decrypt with the first key that yields valid plaintext. Lets reads transparently
 * fall back from the current key to the legacy key for not-yet-re-encrypted data.
 */
export function decryptWithKeys<T>(encrypted: string, keys: string[]): T {
  let lastError: unknown;
  for (const key of keys) {
    try {
      const decrypted = CryptoJS.AES.decrypt(encrypted, key).toString(CryptoJS.enc.Utf8);
      if (!decrypted) throw new Error("empty plaintext");
      return JSON.parse(decrypted) as T;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("decryption failed");
}

/**
 * Verify password by checking against stored hash. This is the client-side hash
 * the browser sends as its credential; the server additionally slow-hashes it
 * before storage (see api/_lib/credentials).
 */
export function hashPassword(password: string): string {
  return CryptoJS.SHA256(password + PASSWORD_SALT).toString();
}

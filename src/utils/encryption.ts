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

// PBKDF2 at 100k iterations takes hundreds of ms of main-thread time, and the
// same password is used for every save in a session — cache the derived keys
// (in memory only; never persisted) so the cost is paid once per login.
const keyCache = new Map<string, string>();
const legacyKeyCache = new Map<string, string>();

/**
 * Derive the current (v2) encryption key from a password. Used to encrypt new
 * data and as the first decryption attempt.
 */
export function deriveKey(password: string): string {
  let key = keyCache.get(password);
  if (!key) {
    key = CryptoJS.PBKDF2(password, PASSWORD_SALT, KDF_V2).toString();
    keyCache.set(password, key);
  }
  return key;
}

/** Derive the legacy (v1) key — only used as a decryption fallback. */
function deriveLegacyKey(password: string): string {
  let key = legacyKeyCache.get(password);
  if (!key) {
    key = CryptoJS.PBKDF2(password, PASSWORD_SALT, KDF_V1).toString();
    legacyKeyCache.set(password, key);
  }
  return key;
}

/**
 * Every key to try when decrypting, newest first. Derive once per password and
 * reuse across a batch (PBKDF2 is deliberately slow).
 */
export function deriveKeys(password: string): string[] {
  return [deriveKey(password), deriveLegacyKey(password)];
}

/**
 * Everything a session needs to read and write data, derived in one go at
 * sign-in. Deriving here — rather than holding the password and deriving on
 * demand — is what lets the session be persisted without the password in it.
 */
export function deriveSessionKeys(password: string): { key: string; legacyKey: string } {
  return { key: deriveKey(password), legacyKey: deriveLegacyKey(password) };
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
 * The legacy (v1) credential: one SHA-256 of the password and the global salt.
 *
 * It used to go to the server on every request. Anyone who saw one request
 * could test guesses against it at raw SHA-256 speed, billions a second, and a
 * password found that way also gives the data key. It is no longer sent as a
 * session's credential (see deriveAuthKey). Sign-in still sends it, once, for an
 * account that has not moved to the new credential yet: the server checks it
 * against the stored verifier and replaces that verifier with the new one.
 */
export function hashPassword(password: string): string {
  return CryptoJS.SHA256(password + PASSWORD_SALT).toString();
}

// The account credential (v2). The salt is per account and carries a label
// that nothing else uses, so its output is independent of the data key and of
// v1 even though the same password goes into all three. A guess against it
// costs 210,000 PBKDF2 rounds, more than a guess against the data key's
// 100,000, so seeing the credential is never a cheaper way to the password
// than holding the ciphertext.
const AUTH_SALT_LABEL = 'icanrunashow-auth-v2:';
const AUTH_ITERATIONS = 210_000;

// Sign-in derives this to check the password and then again for the session
// it starts. Cached in memory so the cost is paid once, like keyCache.
const authKeyCache = new Map<string, string>();

/**
 * The credential a session sends as x-auth: PBKDF2-SHA256 of the password,
 * salted with the account's userId. The server stores only a slow hash of it
 * (api/_lib/credentials). Changing anything here changes every credential and
 * locks every account out, so the parameters are pinned by a test.
 */
export async function deriveAuthKey(password: string, userId: string): Promise<string> {
  const salt = AUTH_SALT_LABEL + userId;
  const cacheKey = `${salt}\n${password}`;
  const cached = authKeyCache.get(cacheKey);
  if (cached) return cached;
  let key: string;
  if (globalThis.crypto?.subtle) {
    const encoder = new TextEncoder();
    const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt: encoder.encode(salt), iterations: AUTH_ITERATIONS, hash: 'SHA-256' },
      material,
      256,
    );
    key = Array.from(new Uint8Array(bits), (b) => b.toString(16).padStart(2, '0')).join('');
  } else {
    // Browsers hide WebCrypto on a page that is not served securely, such as
    // the dev server opened over the LAN from a phone. The same derivation in
    // crypto-js takes seconds, which is better than a sign-in that can't work.
    key = CryptoJS.PBKDF2(password, salt, {
      keySize: 256 / 32,
      iterations: AUTH_ITERATIONS,
      hasher: CryptoJS.algo.SHA256,
    }).toString();
  }
  authKeyCache.set(cacheKey, key);
  return key;
}

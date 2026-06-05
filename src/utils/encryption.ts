import CryptoJS from "crypto-js";

const PASSWORD_SALT = "showrunner-salt-2024";

/**
 * Derive a stable user ID from account identifier
 * Used to organize data by user in the database
 */
export function deriveUserId(identifier: string): string {
  return CryptoJS.SHA256(identifier + PASSWORD_SALT)
    .toString()
    .substring(0, 32);
}

/**
 * Derive encryption key from password
 * Used to encrypt/decrypt user data
 */
export function deriveKey(password: string): string {
  return CryptoJS.PBKDF2(password, PASSWORD_SALT, {
    keySize: 256 / 32,
    iterations: 1000,
  }).toString();
}

/**
 * Encrypt data with password-derived key
 */
export function encryptData(data: unknown, password: string): string {
  return encryptWithKey(data, deriveKey(password));
}

/**
 * Decrypt data with password-derived key
 */
export function decryptData<T>(encrypted: string, password: string): T {
  return decryptWithKey<T>(encrypted, deriveKey(password));
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
 * Verify password by checking against stored hash
 */
export function hashPassword(password: string): string {
  return CryptoJS.SHA256(password + PASSWORD_SALT).toString();
}

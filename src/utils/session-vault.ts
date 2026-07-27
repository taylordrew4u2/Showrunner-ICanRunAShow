import { deriveUserId, deriveSessionKeys, hashPassword } from './encryption';

/**
 * Where a signed-in session lives between visits.
 *
 * The app used to keep `{ username, password }` in localStorage as plain JSON.
 * That was the weakest link in an otherwise end-to-end-encrypted app: any
 * script running on the page could read it, and because people reuse
 * passwords, what leaked wasn't only this app's data.
 *
 * Two things changed:
 *
 * 1. The raw password is never persisted. It's used once, at sign-in, to derive
 *    the encryption keys and the auth hash — and those derived values are what
 *    get stored. A leak now costs the user this app's data instead of the
 *    password they also use for their email.
 *
 * 2. What is stored is encrypted with a **non-extractable** AES-GCM key held in
 *    IndexedDB. The browser will use that key on our behalf but will not hand
 *    its bytes to JavaScript, so reading localStorage yields ciphertext that
 *    can't be carried off and decrypted somewhere else.
 *
 * Layer 2 is a real but partial defence: script running on this page can still
 * ask the browser to decrypt. It raises the cost from "read one string" to
 * "stay resident on the page and drive the crypto API", which is the most a
 * browser app can do about same-origin script. The stronger protection is not
 * running third-party script next to this data in the first place — see
 * `ads.ts`.
 */
export interface SessionCredentials {
  username: string;
  /** Row key for this account's data. Derived from the username. */
  userId: string;
  /** The credential sent to the server. Derived from the password. */
  authHash: string;
  /** Current (v2) data-encryption key. */
  key: string;
  /** Previous (v1) key, kept so pre-upgrade rows still decrypt. */
  legacyKey: string;
}

/** Pre-hardening record: `{ username, password }` in the clear. */
const LEGACY_KEY = 'showrunner_session';
const SESSION_KEY = 'showrunner:session:v2';

const DB_NAME = 'showrunner-vault';
const DB_STORE = 'keys';
const WRAP_KEY_ID = 'session-wrap';

interface StoredSession {
  /** False when IndexedDB was unavailable and we had to store this unwrapped. */
  wrapped: boolean;
  iv?: string;
  data: string;
}

/**
 * Whether a session is on disk, answered synchronously.
 *
 * Restoring is async now, and the app needs to know before its first paint
 * whether one is coming — otherwise it flashes an empty, interactive shows
 * list, and anything created in that window is lost when the real data lands.
 */
export function hasStoredSession(): boolean {
  try {
    return !!(localStorage.getItem(SESSION_KEY) || localStorage.getItem(LEGACY_KEY));
  } catch {
    return false;
  }
}

/** Everything derivable from a password, computed once so it need not be kept. */
export function credentialsFrom(username: string, password: string): SessionCredentials {
  const normalized = username.trim().toLowerCase();
  const { key, legacyKey } = deriveSessionKeys(password);
  return {
    username,
    userId: deriveUserId(normalized),
    authHash: hashPassword(password),
    key,
    legacyKey,
  };
}

// ── The wrapping key ────────────────────────────────────────────────────────

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function idbGet(db: IDBDatabase, id: string): Promise<CryptoKey | undefined> {
  return new Promise((resolve, reject) => {
    const request = db.transaction(DB_STORE, 'readonly').objectStore(DB_STORE).get(id);
    request.onsuccess = () => resolve(request.result as CryptoKey | undefined);
    request.onerror = () => reject(request.error);
  });
}

function idbPut(db: IDBDatabase, id: string, value: CryptoKey): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).put(value, id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Fetch the wrapping key, creating it on first use.
 *
 * `create: false` is for reads — if the key is gone (cleared site data, a new
 * browser profile) we must not mint a fresh one, because a new key can't
 * decrypt the old record and would turn a recoverable "sign in again" into a
 * confusing silent failure.
 */
async function getWrapKey(create: boolean): Promise<CryptoKey | null> {
  if (typeof indexedDB === 'undefined' || !crypto?.subtle) return null;
  try {
    const db = await openDb();
    const existing = await idbGet(db, WRAP_KEY_ID);
    if (existing) return existing;
    if (!create) return null;
    // extractable: false is the whole point — the browser will encrypt and
    // decrypt with this key but will never give its bytes to script.
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
      'encrypt',
      'decrypt',
    ]);
    await idbPut(db, WRAP_KEY_ID, key);
    return key;
  } catch {
    // Private browsing, disabled storage, a blocked upgrade — fall back to an
    // unwrapped record rather than locking the user out of their own app.
    return null;
  }
}

async function deleteWrapKey(): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  try {
    const db = await openDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(DB_STORE, 'readwrite');
      tx.objectStore(DB_STORE).delete(WRAP_KEY_ID);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    /* nothing to clean up */
  }
}

// ── Encoding ────────────────────────────────────────────────────────────────

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Returns an ArrayBuffer — WebCrypto's BufferSource wants a plain one. */
function fromBase64(value: string): ArrayBuffer {
  const binary = atob(value);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return buffer;
}

// ── Read / write ────────────────────────────────────────────────────────────

export async function saveSession(creds: SessionCredentials): Promise<void> {
  const plaintext = JSON.stringify(creds);
  const wrapKey = await getWrapKey(true);

  let record: StoredSession;
  if (wrapKey) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      wrapKey,
      new TextEncoder().encode(plaintext),
    );
    record = { wrapped: true, iv: toBase64(iv), data: toBase64(new Uint8Array(encrypted)) };
  } else {
    // No wrapping available. Still strictly better than before — this record
    // holds derived keys, never the password.
    record = { wrapped: false, data: plaintext };
  }

  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(record));
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    /* storage full or blocked — the session simply won't survive a reload */
  }
}

/**
 * Restore the signed-in session, migrating a pre-hardening record if that's
 * what's on disk. Returns null when there's nothing to restore or the record
 * can no longer be read — both mean "show the sign-in screen".
 */
export async function loadSession(): Promise<SessionCredentials | null> {
  // Migrate first: an old plaintext record is a liability every moment it sits
  // there, so convert it and delete it before doing anything else.
  const legacy = readLegacySession();
  if (legacy) {
    const creds = credentialsFrom(legacy.username, legacy.password);
    await saveSession(creds);
    return creds;
  }

  let record: StoredSession;
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    record = JSON.parse(raw) as StoredSession;
  } catch {
    return null;
  }

  try {
    if (!record.wrapped) return JSON.parse(record.data) as SessionCredentials;
    const wrapKey = await getWrapKey(false);
    if (!wrapKey || !record.iv) {
      // The key is gone but the record isn't. Nothing can read this again.
      clearSession();
      return null;
    }
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(record.iv) },
      wrapKey,
      fromBase64(record.data),
    );
    return JSON.parse(new TextDecoder().decode(decrypted)) as SessionCredentials;
  } catch {
    clearSession();
    return null;
  }
}

function readLegacySession(): { username: string; password: string } | null {
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { username?: string; password?: string };
    if (!parsed?.username || !parsed?.password) {
      localStorage.removeItem(LEGACY_KEY);
      return null;
    }
    return { username: parsed.username, password: parsed.password };
  } catch {
    return null;
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    /* ignore */
  }
  void deleteWrapKey();
}

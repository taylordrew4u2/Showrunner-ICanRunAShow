// Sealing delegated data keys under a credential the server never stores.
//
// Two features hand the server an account's derived data keys: an AI
// assistant's connection (chatgptAuth.ts) and a co-producer link
// (coproducerAuth.ts). Each keeps only a hash of its credential, and seals
// the keys with AES-GCM under a key derived from the raw credential by HKDF
// under a label of its own, so a copy of the database alone opens nothing,
// and a seal made for one feature never opens as the other. Not a route
// (underscore-prefixed).

const encoder = new TextEncoder();

export interface DelegatedKeys { key: string; legacyKey?: string }

export function b64url(bytes: Uint8Array): string {
  // In pieces, so a long ciphertext never becomes one huge argument list.
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export function unb64url(value: string): Uint8Array {
  return Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0));
}

/** 32 random bytes, base64url, 43 chars. */
export function randomToken(): string { return b64url(crypto.getRandomValues(new Uint8Array(32))); }

export async function pkceChallenge(verifier: string): Promise<string> {
  return b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(verifier))));
}

async function wrappingKey(token: string, info: string): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', encoder.encode(token), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: encoder.encode(info) }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

function gcm(iv: Uint8Array, additionalData?: string): AesGcmParams {
  return {
    name: 'AES-GCM',
    iv: iv as Uint8Array<ArrayBuffer>,
    ...(additionalData === undefined ? {} : { additionalData: encoder.encode(additionalData) }),
  };
}

/**
 * `${version}.${b64url(iv)}.${b64url(ciphertext)}`, AES-GCM-256 under
 * HKDF-SHA256(raw token, salt empty, info). `additionalData`, when given, is
 * passed to both encrypt and decrypt (UTF-8), so the blob opens only for the
 * same string.
 */
export async function sealKeys(keys: DelegatedKeys, token: string, info: string, version: string, additionalData?: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(gcm(iv, additionalData), await wrappingKey(token, info), encoder.encode(JSON.stringify(keys)));
  return `${version}.${b64url(iv)}.${b64url(new Uint8Array(cipher))}`;
}

/** Throws on a wrong version prefix, token, label or additional data. */
export async function unsealKeys(value: string, token: string, info: string, version: string, additionalData?: string): Promise<DelegatedKeys> {
  const parts = value.split('.');
  if (parts.length !== 3 || parts[0] !== version) throw new Error('Unreadable sealed keys.');
  const text = await crypto.subtle.decrypt(gcm(unb64url(parts[1]), additionalData), await wrappingKey(token, info), unb64url(parts[2]) as Uint8Array<ArrayBuffer>);
  return JSON.parse(new TextDecoder().decode(text)) as DelegatedKeys;
}

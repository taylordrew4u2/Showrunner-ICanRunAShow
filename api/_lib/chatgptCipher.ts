// The app's existing CryptoJS AES passphrase format is OpenSSL-compatible:
// base64("Salted__" || salt[8] || AES-256-CBC(PKCS7(JSON))). The passphrase
// here is already a password-derived session key; this does not derive one
// from a password. Keep that wire format while using the Edge WebCrypto API.
// MD5 is used only by that legacy format's EVP_BytesToKey key/IV expansion.

const encoder = new TextEncoder();
const header = encoder.encode('Salted__');
const rotations = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];
const constants = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000) | 0);

/** RFC 1321 MD5, required only to decode the application's existing format. */
function md5(input: Uint8Array): Uint8Array<ArrayBuffer> {
  const padded = new Uint8Array(Math.ceil((input.length + 9) / 64) * 64);
  padded.set(input);
  padded[input.length] = 0x80;
  const data = new DataView(padded.buffer);
  data.setUint32(padded.length - 8, (input.length * 8) >>> 0, true);
  data.setUint32(padded.length - 4, Math.floor(input.length / 0x20000000), true);
  let a0 = 0x67452301;
  let b0 = 0xefcdab89 | 0;
  let c0 = 0x98badcfe | 0;
  let d0 = 0x10325476;
  for (let offset = 0; offset < padded.length; offset += 64) {
    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;
    for (let i = 0; i < 64; i++) {
      let f: number;
      let word: number;
      if (i < 16) { f = (b & c) | (~b & d); word = i; }
      else if (i < 32) { f = (d & b) | (~d & c); word = (5 * i + 1) % 16; }
      else if (i < 48) { f = b ^ c ^ d; word = (3 * i + 5) % 16; }
      else { f = c ^ (b | ~d); word = (7 * i) % 16; }
      const sum = (a + f + constants[i] + data.getUint32(offset + word * 4, true)) | 0;
      const rotated = (sum << rotations[i]) | (sum >>> (32 - rotations[i]));
      a = d;
      d = c;
      c = b;
      b = (b + rotated) | 0;
    }
    a0 = (a0 + a) | 0;
    b0 = (b0 + b) | 0;
    c0 = (c0 + c) | 0;
    d0 = (d0 + d) | 0;
  }
  const result = new Uint8Array(16);
  const view = new DataView(result.buffer);
  [a0, b0, c0, d0].forEach((word, index) => view.setInt32(index * 4, word, true));
  return result;
}

const SESSION_KEY = /^[a-f0-9]{64}$/i;
// A signing or profile link's own key: 32 random bytes, base64url, the same
// passphrase the app makes for each link (generateSignKey in
// src/utils/contracts.ts). It travels only in the link's fragment.
const LINK_KEY = /^[A-Za-z0-9_-]{43}$/;

function expand(passphrase: string, salt: Uint8Array, format = SESSION_KEY) {
  if (!format.test(passphrase)) throw new Error('Invalid session key.');
  const password = encoder.encode(passphrase);
  const expanded = new Uint8Array(48);
  let previous = new Uint8Array(0);
  for (let offset = 0; offset < expanded.length; offset += 16) {
    const input = new Uint8Array(previous.length + password.length + salt.length);
    input.set(previous);
    input.set(password, previous.length);
    input.set(salt, previous.length + password.length);
    previous = md5(input);
    expanded.set(previous, offset);
  }
  return { key: expanded.slice(0, 32), iv: expanded.slice(32, 48) };
}

function base64(bytes: Uint8Array): string {
  // Avoid spreading a large show into a function's argument list.
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return btoa(binary);
}

function parse(ciphertext: string): Uint8Array<ArrayBuffer> {
  if (typeof ciphertext !== 'string' || ciphertext.length < 44 || ciphertext.length > 20 * 1024 * 1024 ||
    ciphertext.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(ciphertext)) {
    throw new Error('Malformed encrypted show.');
  }
  const binary = atob(ciphertext);
  if (btoa(binary) !== ciphertext) throw new Error('Malformed encrypted show.');
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  if (bytes.length < 32 || (bytes.length - 16) % 16 !== 0 || header.some((value, index) => bytes[index] !== value)) {
    throw new Error('Malformed encrypted show.');
  }
  return bytes;
}

export function encryptShow(data: unknown, sessionKey: string): Promise<string> {
  return encrypt(data, sessionKey, SESSION_KEY);
}

/** What a link's holder decrypts with the key in its fragment (encryptWithKey in the app). */
export function encryptForLink(data: unknown, linkKey: string): Promise<string> {
  return encrypt(data, linkKey, LINK_KEY);
}

async function encrypt(data: unknown, passphrase: string, format: RegExp): Promise<string> {
  const text = JSON.stringify(data);
  if (text === undefined) throw new Error('Show data must be JSON.');
  const salt = crypto.getRandomValues(new Uint8Array(8));
  const expanded = expand(passphrase, salt, format);
  const key = await crypto.subtle.importKey('raw', expanded.key, 'AES-CBC', false, ['encrypt']);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-CBC', iv: expanded.iv }, key, encoder.encode(text)));
  const result = new Uint8Array(16 + cipher.length);
  result.set(header);
  result.set(salt, 8);
  result.set(cipher, 16);
  return base64(result);
}

export function decryptShow<T>(ciphertext: string, sessionKeys: string[]): Promise<T> {
  return decrypt<T>(ciphertext, sessionKeys, SESSION_KEY);
}

/** Decrypt what was encrypted under a signing or profile link's own key (LINK_KEY format). */
export function decryptForLink<T>(ciphertext: string, linkKey: string): Promise<T> {
  return decrypt<T>(ciphertext, [linkKey], LINK_KEY);
}

async function decrypt<T>(ciphertext: string, passphrases: string[], format: RegExp): Promise<T> {
  const bytes = parse(ciphertext);
  const salt = bytes.slice(8, 16);
  for (const passphrase of passphrases) {
    try {
      const expanded = expand(passphrase, salt, format);
      const key = await crypto.subtle.importKey('raw', expanded.key, 'AES-CBC', false, ['decrypt']);
      const plain = await crypto.subtle.decrypt({ name: 'AES-CBC', iv: expanded.iv }, key, bytes.slice(16));
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plain)) as T;
    } catch {
      // Older shows can still be encrypted under the session's legacy key.
    }
  }
  throw new Error('Show decryption failed.');
}

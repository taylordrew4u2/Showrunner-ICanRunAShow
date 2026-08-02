// Client side of /api/media: large uploads (walk-on music) live outside the
// show/settings payloads as encrypted chunks, and the data model carries only
// a tiny reference string. Same end-to-end encryption as everything else —
// chunks are AES-encrypted with the session's data key before upload.
import { api } from './api';
import { encryptWithKey, decryptWithKey } from './encryption';
import type { SessionCredentials } from './session-vault';
import { readFileAsDataURL } from './media';

/** Reference format stored in show/settings fields: `media:<uuid>#<chunkCount>` */
const REF_PREFIX = 'media:';

export function isMediaRef(value?: string | null): value is string {
  return !!value && value.startsWith(REF_PREFIX);
}

export function parseMediaRef(ref: string): { id: string; total: number } | null {
  if (!isMediaRef(ref)) return null;
  const [id, totalStr] = ref.slice(REF_PREFIX.length).split('#');
  const total = Number(totalStr);
  if (!id || !Number.isInteger(total) || total < 1) return null;
  return { id, total };
}

// Slice size of the (base64 data URL) plaintext per chunk. Encryption grows it
// ~1.4×; 1.5M chars → ~2.1M chars ciphertext per request, safely under the
// server's per-request ceiling.
const SLICE_CHARS = 1_500_000;

/** Split a string into fixed-size slices (exported for tests). */
export function splitIntoChunks(text: string, sliceChars = SLICE_CHARS): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += sliceChars) {
    chunks.push(text.slice(i, i + sliceChars));
  }
  return chunks;
}

// The store needs the session credentials for auth headers + the encryption
// key. App sets them at login/restore and clears them at logout. These are the
// values derived at sign-in — the raw password is never held here.
let creds: SessionCredentials | null = null;

export function initMediaStore(session: SessionCredentials): void {
  creds = session;
}

export function clearMediaStore(): void {
  creds = null;
  urlCache.clear();
}

/**
 * The signed-in session, for callers that need to upload alongside the media
 * store — publishing a show's audio to its live viewers, say. Null when signed
 * out. Same values set at login; the raw password is never held here.
 */
export function getMediaCredentials(): SessionCredentials | null {
  return creds;
}

function authOpts() {
  if (!creds) throw new Error('Media store not initialized (no session)');
  return { authUserId: creds.userId, authHash: creds.authHash };
}

/**
 * Upload a file to the media store. Returns the `media:` reference to put in
 * the data model. Chunks upload sequentially so each request stays small.
 */
export async function uploadMedia(file: File): Promise<string> {
  if (!creds) throw new Error('Media store not initialized (no session)');
  const dataUrl = await readFileAsDataURL(file);
  const key = creds.key;
  const id = crypto.randomUUID();
  const chunks = splitIntoChunks(dataUrl);
  const a = authOpts();
  for (let seq = 0; seq < chunks.length; seq++) {
    await api.put('/api/media', { id, seq, total: chunks.length, data: encryptWithKey(chunks[seq], key) }, a);
  }
  const ref = `${REF_PREFIX}${id}#${chunks.length}`;
  urlCache.set(ref, dataUrl); // already have the plaintext — warm the cache
  return ref;
}

// Resolved data URLs, keyed by reference. In-memory only.
const urlCache = new Map<string, string>();
// De-dupe concurrent resolutions of the same reference.
const inFlight = new Map<string, Promise<string | null>>();

/**
 * Resolve a `media:` reference back to a playable data URL (fetch chunks,
 * decrypt, reassemble). Returns the input unchanged if it isn't a media
 * reference (plain data URLs and http links pass through), or null when the
 * media can't be fetched.
 */
export async function resolveMediaUrl(src: string): Promise<string | null> {
  if (!isMediaRef(src)) return src;
  const cached = urlCache.get(src);
  if (cached) return cached;
  const existing = inFlight.get(src);
  if (existing) return existing;

  const promise = (async () => {
    const parsed = parseMediaRef(src);
    if (!parsed || !creds) return null;
    const key = creds.key;
    const a = authOpts();
    try {
      const parts: string[] = new Array(parsed.total);
      for (let seq = 0; seq < parsed.total; seq++) {
        const res = await api.get<{ data: string }>(`/api/media?id=${encodeURIComponent(parsed.id)}&seq=${seq}`, a);
        parts[seq] = decryptWithKey<string>(res.data, key);
      }
      const dataUrl = parts.join('');
      urlCache.set(src, dataUrl);
      return dataUrl;
    } catch (err) {
      console.warn('mediaStore: failed to resolve', err);
      return null;
    } finally {
      inFlight.delete(src);
    }
  })();
  inFlight.set(src, promise);
  return promise;
}

/** Best-effort delete of a media item (e.g. when a track is replaced). */
export function deleteMedia(ref: string): void {
  const parsed = parseMediaRef(ref);
  if (!parsed || !creds) return;
  api.del(`/api/media?id=${encodeURIComponent(parsed.id)}`, authOpts()).catch(() => {
    /* orphaned chunks are harmless; a later cleanup can collect them */
  });
}

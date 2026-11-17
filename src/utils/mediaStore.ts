// Client side of /api/media: large uploads (walk-on music) live outside the
// show/settings payloads as encrypted chunks, and the data model carries only
// a tiny reference string. Same end-to-end encryption as everything else —
// chunks are AES-encrypted with the session's data key before upload.
import { api, withNetworkRetry } from './api';
import { encryptWithKey, decryptWithKey } from './encryption';
import type { SessionCredentials } from './session-vault';
import { readFileAsDataURL } from './media';
import { createBudgetedCache } from './budgetedCache';
import type { StageChunkBody } from '../coproducer/types';
import { ALLOWED_MEDIA_TYPES, sniffMediaType } from '../coproducer/schema';
import { ReviewModeBlockedError } from '../coproducer/errors';

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

/**
 * How long one chunk gets to travel.
 *
 * The fetch wrapper's default deadline suits a small request. A chunk is
 * around two megabytes of ciphertext, and a track's chunks all travel at
 * once, sharing whatever the venue's connection gives — so on a slow one
 * every chunk ran out of time together, the whole download failed, and the
 * soundboard reported the headliner's track as broken while shorter ones
 * played. The retries in useMediaUrl and the audio engine hit the same wall.
 * Two minutes is the same allowance a signer's headshot gets going uphill.
 */
export const MEDIA_CHUNK_TIMEOUT_MS = 120_000;

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

// ── Co-producer view ────────────────────────────────────────────────────────
//
// A co-producer sees the owner's files and proposes new ones, but never
// writes to the owner's media store. Their files are read as plaintext slices
// the server has already decrypted, and an upload is staged on the server
// beside a request instead of stored: it reaches the account only if the
// owner approves the change that carries it. enterReviewMode installs the
// source; this module never imports review mode itself.

/** Where co-producer view reads and stages files. */
export interface ReviewMediaSource {
  /** One plaintext slice of a data URL. */
  chunk(id: string, seq: number): Promise<string>;
  /** Stage one plaintext slice of a new file. */
  stage(body: StageChunkBody): Promise<void>;
}

let reviewSource: ReviewMediaSource | null = null;

/** Installed once by enterReviewMode. While set, uploads stage, reads use it and deletes do nothing. */
export function setMediaSource(source: ReviewMediaSource | null): void {
  reviewSource = source;
  urlCache.clear();
}

/** Files staged from this page for a request still to be sent, by media id. */
const stagedIds = new Set<string>();

export function stagedMediaIdSet(): ReadonlySet<string> {
  return stagedIds;
}

let stagingCount = 0;
const stagingListeners = new Set<() => void>();

/** How many uploads are staging right now. Sending and discarding a change wait for none. */
export function stagingInFlight(): number {
  return stagingCount;
}

/** Told whenever an upload starts or stops staging. Returns the way to stop listening. */
export function onStagingChange(listener: () => void): () => void {
  stagingListeners.add(listener);
  return () => {
    stagingListeners.delete(listener);
  };
}

function stagingChanged(by: number): void {
  stagingCount += by;
  for (const listener of [...stagingListeners]) listener();
}

/**
 * A data URL relabelled with the type its own bytes declare. A browser labels
 * an .m4a as video/mp4 or application/octet-stream, and an SVG as an image;
 * what goes for approval is what the bytes are, and anything they do not
 * say is an allowed photo, audio file or PDF is refused before it is sent.
 */
export function relabelByContent(dataUrl: string): string {
  const comma = dataUrl.indexOf(',');
  const header = comma > 0 ? dataUrl.slice(0, comma) : '';
  if (!header.startsWith('data:') || !header.endsWith(';base64')) {
    throw new ReviewModeBlockedError('unsupported_media');
  }
  const body = dataUrl.slice(comma + 1);
  const type = sniffMediaType(body.slice(0, 64));
  if (!type || !ALLOWED_MEDIA_TYPES.includes(type)) throw new ReviewModeBlockedError('unsupported_media');
  return `data:${type};base64,${body}`;
}

async function stageForApproval(source: ReviewMediaSource, file: File): Promise<string> {
  stagingChanged(1);
  try {
    const dataUrl = relabelByContent(await readFileAsDataURL(file));
    const id = crypto.randomUUID();
    const chunks = splitIntoChunks(dataUrl);
    for (let seq = 0; seq < chunks.length; seq++) {
      const body = { id, seq, total: chunks.length, data: chunks[seq] };
      await withNetworkRetry(() => source.stage(body));
    }
    const ref = `${REF_PREFIX}${id}#${chunks.length}`;
    stagedIds.add(id);
    urlCache.set(ref, dataUrl);
    return ref;
  } finally {
    stagingChanged(-1);
  }
}

/**
 * Upload a file to the media store. Returns the `media:` reference to put in
 * the data model. Chunks upload sequentially so each request stays small.
 *
 * Each chunk is sent again if the connection drops under it. A track is a
 * dozen chunks going uphill from a basement, and one of them dying used to
 * fail the whole file — and every retry by the producer started over from
 * chunk zero, so the same chunk was as likely to die again. Repeating a chunk
 * is safe: the server upserts by (id, seq), so a chunk that did land before
 * the answer was lost is simply written once more.
 */
export async function uploadMedia(file: File): Promise<string> {
  if (reviewSource) return stageForApproval(reviewSource, file);
  if (!creds) throw new Error('Media store not initialized (no session)');
  const dataUrl = await readFileAsDataURL(file);
  const key = creds.key;
  const id = crypto.randomUUID();
  const chunks = splitIntoChunks(dataUrl);
  const ref = `${REF_PREFIX}${id}#${chunks.length}`;
  const a = authOpts();
  for (let seq = 0; seq < chunks.length; seq++) {
    const data = encryptWithKey(chunks[seq], key);
    try {
      await withNetworkRetry(() =>
        api.put('/api/media', { id, seq, total: chunks.length, data }, { ...a, timeoutMs: MEDIA_CHUNK_TIMEOUT_MS }),
      );
    } catch (err) {
      // Nothing will ever point at the chunks that did land: the reference is
      // only handed out once the whole file is up. Clear them rather than
      // leave a few megabytes behind for every failed try.
      deleteMedia(ref);
      throw err;
    }
  }
  urlCache.set(ref, dataUrl); // already have the plaintext — warm the cache
  return ref;
}

/**
 * How many characters of resolved data URLs are kept in memory.
 *
 * A resolved track is its whole file as base64 — four to five million
 * characters for a walk-on, twice that in memory — and the cache used to keep
 * every one for the life of the page, on top of the PCM the audio engine
 * holds. A full bill was tens of megabytes that never went away. Thirty-two
 * million characters is half a dozen whole songs, kept oldest-use-first so
 * the ones a page is actually showing or playing stay; anything past that is
 * fetched again when it is next needed. Soft: a single file bigger than the
 * budget is still kept.
 */
export const URL_CACHE_BUDGET_CHARS = 32_000_000;

/** Resolved data URLs, weighed by length. Shares its rule with the audio engine. */
export function createUrlCache(budgetChars = URL_CACHE_BUDGET_CHARS) {
  return createBudgetedCache<string>((value) => value.length, budgetChars);
}

// Resolved data URLs, keyed by reference. In-memory only.
const urlCache = createUrlCache();
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
    if (!parsed) return null;
    const source = reviewSource;
    if (source) {
      // Co-producer view: the server hands over each slice already
      // decrypted, and there is no key here to decrypt one with.
      try {
        const parts = await Promise.all(Array.from({ length: parsed.total }, (_, seq) => source.chunk(parsed.id, seq)));
        const dataUrl = parts.join('');
        urlCache.set(src, dataUrl);
        return dataUrl;
      } catch (err) {
        console.warn('mediaStore: failed to resolve', err);
        return null;
      } finally {
        inFlight.delete(src);
      }
    }
    if (!creds) return null;
    const key = creds.key;
    const a = authOpts();
    try {
      // Chunks are fetched together rather than one after another.
      //
      // A slice is 1.5M characters, so a five-megabyte track is about five
      // chunks and a ten-megabyte one about nine. Sequentially that was five
      // to nine full round trips stacked end to end, each with a ~2MB decrypt
      // between it and the next — seconds per track on a phone network, and
      // the soundboard can only start a track once this finishes. Latency was
      // being paid once per chunk when it only ever needed paying once.
      //
      // No pool: browsers already cap concurrent requests per host at around
      // six, and `total` is small, so this self-limits. Peak memory is
      // unchanged — every part was held at once for the join either way.
      const parts = await Promise.all(
        Array.from({ length: parsed.total }, async (_, seq) => {
          const res = await api.get<{ data: string }>(
            `/api/media?id=${encodeURIComponent(parsed.id)}&seq=${seq}`,
            { ...a, timeoutMs: MEDIA_CHUNK_TIMEOUT_MS },
          );
          return decryptWithKey<string>(res.data, key);
        }),
      );
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
  // Co-producer view never deletes the owner's files. Dropping one from a
  // show is part of the change they propose; the owner's app decides.
  if (reviewSource) return;
  const parsed = parseMediaRef(ref);
  if (!parsed || !creds) return;
  api.del(`/api/media?id=${encodeURIComponent(parsed.id)}`, authOpts()).catch(() => {
    /* orphaned chunks are harmless; a later cleanup can collect them */
  });
}

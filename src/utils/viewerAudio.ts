/**
 * Soundboard audio for the live viewer.
 *
 * The operator's board plays through whatever device it's running on. That's
 * wrong when the machine wired to the PA is the one showing the viewer link
 * and the operator is working from a phone. So the board can publish its
 * tracks to the viewer, and the viewer plays them on cue.
 *
 * The awkward part is the encryption model. Walk-ons live in /api/media
 * encrypted under a key derived from the producer's password, and a viewer has
 * no account at all — it can't fetch them and couldn't read them if it did.
 * Handing over the account key would unlock every show the producer owns, so
 * that's out.
 *
 * Instead each show gets its own random key, generated here and never sent to
 * a server. Tracks are re-encrypted under it and uploaded to /api/live-media,
 * and the key rides in the fragment of the viewer link — the one part of a URL
 * browsers keep to themselves. The server stores bytes it cannot read, and the
 * blast radius of a shared link is exactly the show it was made for.
 *
 * The trade this makes, which is worth being clear about: anyone holding the
 * viewer link can now hear and download that show's music. Before, the link
 * revealed only the running order.
 */

import { api } from './api';
import { decryptWithKey, encryptWithKey } from './encryption';
import { resolveMediaUrl } from './mediaStore';
import type { SessionCredentials } from './session-vault';

/** Slice size of the plaintext data URL per chunk — matches the media store. */
const SLICE_CHARS = 1_500_000;

/** What the viewer needs to find and decode one track. */
export interface ViewerTrack {
  /** The soundboard key this came from, so `playing` can name it. */
  key: string;
  /** Storage id under the viewer token. */
  mediaId: string;
  /** Chunk count. */
  total: number;
}

/** Which track the board wants the viewer playing, and how it should come in. */
export interface ViewerPlayback {
  /** Soundboard key, or null for silence. */
  key: string | null;
  /** Producer wall clock when this instruction was written. */
  atMs: number;
  fadeInMs: number;
  fadeOutMs: number;
}

/**
 * What the viewer should do with the instruction it just polled.
 *
 * Pulled out of the component because this is where a cue gets dropped. The
 * subtlety is 'wait': a press can reach the viewer before that track has
 * finished downloading, and the wrong move is to treat the cue as handled —
 * the download lands a moment later and nothing restarts it, so the walk-on is
 * gone until the operator presses something else. 'wait' leaves the caller's
 * "currently playing" untouched so the next poll retries.
 */
export type PlaybackAction =
  | { action: 'none' }
  | { action: 'wait'; key: string }
  | { action: 'play'; key: string }
  | { action: 'stop' };

export function nextPlaybackAction(
  playing: string | null,
  playback: ViewerPlayback | undefined,
  isDownloaded: (key: string) => boolean,
): PlaybackAction {
  if (!playback) return { action: 'none' };
  const wanted = playback.key;
  // Silence: only worth acting on if something is actually running.
  if (!wanted) return playing === null ? { action: 'none' } : { action: 'stop' };
  if (wanted === playing) return { action: 'none' };
  if (!isDownloaded(wanted)) return { action: 'wait', key: wanted };
  return { action: 'play', key: wanted };
}

/** A fresh per-show key. 32 bytes of CSPRNG, base64url so it survives a URL. */
export function generateViewerKey(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Split a string into fixed-size slices (exported for tests). */
export function splitIntoChunks(text: string, sliceChars = SLICE_CHARS): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += sliceChars) {
    chunks.push(text.slice(i, i + sliceChars));
  }
  return chunks;
}

/**
 * The viewer link for a token, with the key in the fragment.
 *
 * `#` and everything after it is never sent to a server — not in the request
 * line, not in Referer — so the key reaches the viewer's JavaScript without
 * ever touching the backend that stores the ciphertext.
 */
export function viewerUrl(origin: string, token: string, key?: string | null): string {
  const base = `${origin}/?view=${encodeURIComponent(token)}`;
  return key ? `${base}#k=${key}` : base;
}

/** Read the key back out of the current location's fragment. */
export function readViewerKeyFromHash(hash: string): string | null {
  const m = /[#&]k=([A-Za-z0-9_-]+)/.exec(hash || '');
  return m ? m[1] : null;
}

// The key has to outlive the Run Show screen: a link handed out on Tuesday
// must still decode Friday's board. Kept per token, on the producer's device
// only — it is never uploaded anywhere.
const KEY_PREFIX = 'showrunner:viewerkey:';

export function loadViewerKey(token: string): string | null {
  try {
    return localStorage.getItem(KEY_PREFIX + token);
  } catch {
    return null;
  }
}

/** The show's existing key, or a new one saved for next time. */
export function ensureViewerKey(token: string): string {
  const existing = loadViewerKey(token);
  if (existing) return existing;
  const key = generateViewerKey();
  try {
    localStorage.setItem(KEY_PREFIX + token, key);
  } catch {
    /* private mode — the key still works for this session's links */
  }
  return key;
}

/**
 * Re-encrypt one track under the viewer key and upload it.
 *
 * `src` is whatever the soundboard holds — a `media:` reference, a data URL, or
 * a link. It's resolved to plaintext locally first; the producer's own key
 * never leaves the device and never reaches /api/live-media.
 */
export async function publishTrack(
  token: string,
  viewerKey: string,
  src: string,
  mediaId: string,
  creds: SessionCredentials,
): Promise<number> {
  const dataUrl = await resolveMediaUrl(src);
  if (!dataUrl) throw new Error('track could not be resolved');
  const chunks = splitIntoChunks(dataUrl);
  const auth = { authUserId: creds.userId, authHash: creds.authHash };
  for (let seq = 0; seq < chunks.length; seq++) {
    await api.put(
      '/api/live-media',
      { token, id: mediaId, seq, total: chunks.length, data: encryptWithKey(chunks[seq], viewerKey) },
      auth,
    );
  }
  return chunks.length;
}

/** Drop everything published under a token — when the operator turns this off. */
export async function unpublishAll(token: string, creds: SessionCredentials): Promise<void> {
  await api.del(`/api/live-media?token=${encodeURIComponent(token)}`, {
    authUserId: creds.userId,
    authHash: creds.authHash,
  });
}

/**
 * Viewer side: fetch a published track's chunks and decrypt to a data URL.
 * Returns null if the key doesn't fit the ciphertext or a chunk is missing —
 * a viewer that can't decode one track should stay quiet, not break.
 */
export async function fetchViewerTrack(
  token: string,
  viewerKey: string,
  track: ViewerTrack,
): Promise<string | null> {
  try {
    const parts: string[] = new Array(track.total);
    for (let seq = 0; seq < track.total; seq++) {
      const res = await api.get<{ data: string }>(
        `/api/live-media?token=${encodeURIComponent(token)}&id=${encodeURIComponent(track.mediaId)}&seq=${seq}`,
      );
      parts[seq] = decryptWithKey<string>(res.data, viewerKey);
    }
    const joined = parts.join('');
    // A wrong key decrypts to empty or garbage rather than throwing, so check
    // it actually looks like the data URL we put in.
    return joined.startsWith('data:') ? joined : null;
  } catch {
    return null;
  }
}

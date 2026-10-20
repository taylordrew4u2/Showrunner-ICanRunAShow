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
 * a server in a form it can read: it is saved inside the show, which is
 * encrypted like everything else. Tracks are re-encrypted under it and
 * uploaded to /api/live-media, and the key rides in the fragment of the
 * viewer link — the one part of a URL browsers keep to themselves. The
 * server stores bytes it cannot read, and the
 * blast radius of a shared link is exactly the show it was made for.
 *
 * The trade this makes, which is worth being clear about: anyone holding the
 * viewer link can now hear and download that show's music. Before, the link
 * revealed only the running order.
 */

import { sharedLinkPath } from './sharedLink';
import { api, withNetworkRetry } from './api';
import { decryptWithKey, encryptWithKey } from './encryption';
import { MEDIA_CHUNK_TIMEOUT_MS, resolveMediaUrl } from './mediaStore';
import type { SessionCredentials } from './session-vault';
import { trimmedLength } from './trim';

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
  /** The slice the board plays, if the track was trimmed — see trimSlice. */
  startSec?: number;
  endSec?: number;
}

/**
 * The slice of a track a press should play, as the engine takes it.
 *
 * A walk-on is rarely the top of the file — it's the drop or the chorus, and
 * a producer who trimmed it wants that and nothing else. The in/out rule is
 * trimmedLength's, so a half-finished edit plays something rather than a
 * stop scheduled in the past.
 *
 * One rule for both ends of the wire: the operator's own device and the
 * screen wired to the PA used to disagree, because only the board applied it,
 * and the room heard the whole song from the top.
 */
export function trimSlice(track: { startSec?: number; endSec?: number }): { offsetSec?: number; durationSec?: number } {
  return {
    offsetSec: track.startSec && track.startSec > 0 ? track.startSec : undefined,
    durationSec: trimmedLength(track.startSec, track.endSec) ?? undefined,
  };
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
  // No instruction at all is silence too. A board that closes, or stops
  // sending its audio here, publishes nothing about playback, and treating
  // that as "carry on" left the PA playing a song the board could no longer
  // stop.
  const wanted = playback?.key ?? null;
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

/**
 * How many different tracks one viewer link can hold. The server refuses the
 * next one — MAX_TRACKS_PER_TOKEN in api/live-media.ts, which this mirrors.
 */
export const MAX_VIEWER_TRACKS = 60;

/** One file to send to the viewer, and every pad on the board that plays it. */
export interface ViewerUpload<P extends { key: string; src: string }> {
  mediaId: string;
  src: string;
  pads: P[];
}

/**
 * What to upload for a board, in the order given.
 *
 * Files, not pads. The DJ bank carries the whole music library and anyone
 * without a walk-on of their own plays a library song too, so a board of a
 * dozen acts and a fifty-song library passed the server's limit, and one
 * upload per pad sent the same songs several times over before the server
 * refused the rest and the whole publish failed.
 *
 * Past the limit the remaining files are left out rather than failing the
 * lot: pass the pads walk-ons first, then show tracks, then the DJ bank, and
 * what gets left out is the end of the library. Those pads still play on the
 * board's own device.
 */
export function planViewerUploads<P extends { key: string; src: string }>(
  pads: P[],
  max = MAX_VIEWER_TRACKS,
): { uploads: ViewerUpload<P>[]; skipped: P[] } {
  const bySrc = new Map<string, ViewerUpload<P>>();
  const skipped: P[] = [];
  for (const pad of pads) {
    const existing = bySrc.get(pad.src);
    if (existing) {
      existing.pads.push(pad);
    } else if (bySrc.size < max) {
      // A stable id per file, named after the first pad that plays it, so
      // re-publishing overwrites rather than piling up a second copy.
      const mediaId = `t-${pad.key.replace(/[^a-zA-Z0-9]/g, '-')}`.slice(0, 60);
      bySrc.set(pad.src, { mediaId, src: pad.src, pads: [pad] });
    } else {
      skipped.push(pad);
    }
  }
  return { uploads: [...bySrc.values()], skipped };
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
  const base = `${origin}${sharedLinkPath('view', token)}`;
  return key ? `${base}#k=${key}` : base;
}

/** Read the key back out of the current location's fragment. */
export function readViewerKeyFromHash(hash: string): string | null {
  const m = /[#&]k=([A-Za-z0-9_-]+)/.exec(hash || '');
  return m ? m[1] : null;
}

// The key has to outlive the Run Show screen: a link handed out on Tuesday
// must still decode Friday's board. It is kept with the show (Show.viewerKey),
// inside the show's encryption, so it reaches every device the producer
// signs in on. Kept only on the device that made it, a publish from any other
// device made a new key, re-encrypted every track under it, and left every
// link already handed out unable to decode a thing. Keys from before that
// are still here, per token, and are adopted into the show the next time
// one is needed.
const KEY_PREFIX = 'showrunner:viewerkey:';

export function loadViewerKey(token: string): string | null {
  try {
    return localStorage.getItem(KEY_PREFIX + token);
  } catch {
    return null;
  }
}

/** Forget a show's key, once the account whose show it was is gone. */
export function forgetViewerKey(token: string): void {
  try {
    localStorage.removeItem(KEY_PREFIX + token);
  } catch {
    /* nothing this device can do */
  }
}

/**
 * The show's key: the one saved with the show, else one this device made
 * before keys travelled with the show, else a new one. The caller saves
 * whatever comes back onto the show when it differs from `saved`.
 */
export function ensureViewerKey(token: string, saved?: string | null): string {
  if (saved) return saved;
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
    const data = encryptWithKey(chunks[seq], viewerKey);
    // Each chunk is a ~2MB upload from the venue, given the media store's
    // allowance and sent again if the connection drops: one lost chunk used
    // to fail the track. Safe to repeat — the server keeps one copy per
    // chunk and overwrites it.
    await withNetworkRetry(() =>
      api.put(
        '/api/live-media',
        { token, id: mediaId, seq, total: chunks.length, data },
        { ...auth, timeoutMs: MEDIA_CHUNK_TIMEOUT_MS },
      ),
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
      // A ~2MB chunk, so the media store's allowance rather than the default
      // twenty seconds: on a slow venue link every chunk, and every retry of
      // the track, ran out of time and the walk-on never arrived.
      const res = await api.get<{ data: string }>(
        `/api/live-media?token=${encodeURIComponent(token)}&id=${encodeURIComponent(track.mediaId)}&seq=${seq}`,
        { timeoutMs: MEDIA_CHUNK_TIMEOUT_MS },
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

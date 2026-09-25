import { useEffect, useRef, useState } from 'react';
import { fetchLiveView, type LiveViewPayload } from '../utils/liveView';
import { applyColorScheme } from '../utils/theme';
import { audioEngine } from '../utils/audioEngine';
import { MEDIA_RETRY_DELAYS_MS } from '../utils/useMediaUrl';
import {
  fetchViewerTrack,
  nextPlaybackAction,
  readViewerKeyFromHash,
  trimSlice,
  type ViewerTrack,
} from '../utils/viewerAudio';

interface LiveViewerProps {
  token: string;
}

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

function fmtCountdown(seconds: number): string {
  const neg = seconds < 0;
  const s = Math.abs(Math.floor(seconds));
  return `${neg ? '-' : ''}${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
}

/** What the board published, plus this screen's clock when that publish first arrived. */
export type ShownPayload = LiveViewPayload & { receivedAt: number };

/**
 * Stamp a polled payload with when this screen first saw it.
 *
 * Every poll brings the same publish back until the board writes again, and
 * the count has to keep running through those, so the stamp survives as long
 * as `lastUpdateMs` — the board's own write time — is unchanged.
 *
 * Exported for the tests, as are the two helpers below. Fast refresh only
 * minds exports it has to re-render, and none of these has UI of its own.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function stampPayload(prev: ShownPayload | null, next: LiveViewPayload, now: number): ShownPayload {
  return { ...next, receivedAt: prev && prev.lastUpdateMs === next.lastUpdateMs ? prev.receivedAt : now };
}

/**
 * Seconds left on the cue, counted on this screen's clock.
 *
 * The count used to run from `lastUpdateMs`, which is the producer's phone's
 * idea of the time, subtracted from the PA laptop's. Any gap between the two
 * clocks went straight into the number on the wall: a laptop 45 seconds fast
 * showed every cue 45 seconds shorter than the board did. Counting from when
 * the publish reached this screen costs at most the request's latency and
 * involves one clock.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function remainingSeconds(shown: ShownPayload, now: number): number {
  const total = shown.remainingAtLastUpdate ?? 0;
  if (shown.status !== 'running') return total;
  return total - (now - shown.receivedAt) / 1000;
}

/** The viewer's copy of the board's tracks — see createTrackLoader. */
export interface TrackLoader {
  /** The tracks the board has published; anything new or changed gets downloaded. */
  sync(manifest: ViewerTrack[]): void;
  has(key: string): boolean;
  urlOf(key: string): string | undefined;
  /** The board cued a track this screen does not have: worth one more go now. */
  want(key: string): void;
  /** The connection is back: every missing track gets a fresh run of attempts. */
  retryAll(): void;
  dispose(): void;
}

/**
 * Downloads the published tracks one at a time and keeps trying the ones that
 * fail.
 *
 * One chunk timing out on venue wifi used to lose that track for the night:
 * nothing asked for it again, and when the operator pressed the pad the room
 * heard silence with no message on either screen. A failed track is now tried
 * again on the same spacing headshots use, then left alone until something
 * changes — the connection comes back, or the board cues it — rather than
 * polling for a file that may be genuinely undecodable.
 *
 * A track is told apart by its storage id and chunk count, so a walk-on the
 * board re-published under the same key is downloaded again rather than
 * played from the old copy. A swap to a file of exactly the same size is not
 * caught; the manifest carries nothing else to catch it with.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function createTrackLoader(
  download: (track: ViewerTrack) => Promise<string | null>,
  onReady: (key: string, url: string) => void,
  delays: readonly number[] = MEDIA_RETRY_DELAYS_MS,
): TrackLoader {
  const ready = new Map<string, { version: string; url: string }>();
  const failed = new Map<string, { attempts: number; notBefore: number }>();
  let wanted: ViewerTrack[] = [];
  let busy = false;
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const version = (t: ViewerTrack) => `${t.mediaId}:${t.total}`;
  const missing = () => wanted.filter((t) => ready.get(t.key)?.version !== version(t));

  function pump() {
    if (busy || disposed) return;
    if (timer !== undefined) { clearTimeout(timer); timer = undefined; }
    const now = Date.now();
    const queue = missing();
    const next = queue.find((t) => (failed.get(t.key)?.notBefore ?? 0) <= now);
    if (!next) {
      // Nothing due. Wake for the earliest one still worth trying, if any.
      const soonest = Math.min(...queue.map((t) => failed.get(t.key)?.notBefore ?? Infinity));
      if (Number.isFinite(soonest)) timer = setTimeout(pump, Math.max(0, soonest - now));
      return;
    }
    busy = true;
    download(next).catch(() => null).then((url) => {
      busy = false;
      if (disposed) return;
      if (url) {
        ready.set(next.key, { version: version(next), url });
        failed.delete(next.key);
        onReady(next.key, url);
      } else {
        const attempts = (failed.get(next.key)?.attempts ?? 0) + 1;
        const notBefore = attempts <= delays.length ? Date.now() + delays[attempts - 1] : Infinity;
        failed.set(next.key, { attempts, notBefore });
      }
      pump();
    });
  }

  return {
    sync(manifest) {
      wanted = manifest;
      for (const t of manifest) {
        const have = ready.get(t.key);
        if (have && have.version !== version(t)) ready.delete(t.key);
      }
      pump();
    },
    has: (key) => ready.has(key),
    urlOf: (key) => ready.get(key)?.url,
    want(key) {
      // Only a track that has run out of attempts; one mid-backoff keeps its
      // spacing, or every poll's repeat of the cue would hammer the server.
      const f = failed.get(key);
      if (f && f.notBefore === Infinity) failed.set(key, { attempts: 0, notBefore: 0 });
      pump();
    },
    retryAll() {
      for (const key of failed.keys()) failed.set(key, { attempts: 0, notBefore: 0 });
      pump();
    },
    dispose() {
      disposed = true;
      if (timer !== undefined) clearTimeout(timer);
    },
  };
}

export function LiveViewer({ token }: LiveViewerProps) {
  const [payload, setPayload] = useState<ShownPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());
  const initial = useRef(true);

  // The per-show audio key, if this link carries one. It lives in the fragment,
  // so it reached this page without ever going to the server.
  const viewerKey = useRef<string | null>(readViewerKeyFromHash(window.location.hash)).current;
  // Browsers won't start audio without a gesture, so the operator (or whoever
  // set up the room) taps once to arm this screen.
  const [soundOn, setSoundOn] = useState(false);
  const playingRef = useRef<string | null>(null);
  const loader = useRef<TrackLoader | null>(null);

  const hasAudio = !!viewerKey && !!payload?.audio?.length;

  // Poll the live view payload. Faster once this screen is carrying the sound:
  // a walk-on landing a beat late is worse than a countdown doing so.
  const pollMs = soundOn && hasAudio ? 500 : 1500;
  useEffect(() => {
    let alive = true;
    let inFlight = false;
    async function tick() {
      // One request at a time. On a slow link the interval used to stack
      // requests up, and an older answer landing after a newer one put the
      // board's previous instruction back on screen — and on the PA, where
      // it restarted a walk-on the operator had just stopped.
      if (inFlight) return;
      inFlight = true;
      try {
        const p = await fetchLiveView(token);
        if (!alive) return;
        if (p) {
          const received = Date.now();
          setPayload((prev) => stampPayload(prev, p, received));
          setError(null);
        } else if (initial.current) {
          setError('This live view link is not active yet.');
        }
      } catch {
        if (!alive) return;
        if (initial.current) setError("Couldn't reach the live view.");
      } finally {
        inFlight = false;
        initial.current = false;
      }
    }
    tick();
    const id = window.setInterval(tick, pollMs);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [token, pollMs]);

  // Pull down and decrypt every published track once the screen is armed, so a
  // cue doesn't arrive to find nothing decoded. The loader outlives any one
  // manifest so a re-publish only fetches what changed.
  useEffect(() => {
    if (!soundOn || !viewerKey) return;
    const l = createTrackLoader(
      (track) => fetchViewerTrack(token, viewerKey, track),
      (_key, url) => { audioEngine.preload(url).catch(() => {}); },
    );
    loader.current = l;
    // Coming back online is the best moment to try again, whatever the timer says.
    const onOnline = () => l.retryAll();
    window.addEventListener('online', onOnline);
    return () => {
      window.removeEventListener('online', onOnline);
      l.dispose();
      loader.current = null;
    };
  }, [soundOn, viewerKey, token]);

  const manifest = payload?.audio;
  // Every poll parses a fresh payload, so the array is a new object each time
  // even when the board has published nothing new. Keying the effect on the
  // contents stops it re-syncing the downloads twice a second.
  const manifestKey = manifest?.map((t) => `${t.mediaId}:${t.total}`).join(',') ?? '';
  useEffect(() => {
    if (manifest?.length) loader.current?.sync(manifest);
    // manifestKey stands in for manifest — see above. soundOn, viewerKey and
    // token are here so the sync runs again once the effect above has made a
    // loader for a manifest that arrived before the screen was armed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [soundOn, viewerKey, token, manifestKey]);

  // Follow the board. `playback.key` is the whole instruction — which track,
  // or null for silence — so the screen simply matches whatever it last said.
  useEffect(() => {
    if (!soundOn || !viewerKey) return;
    const playback = payload?.playback;
    const tracks = loader.current;
    if (!playback || !tracks) return;
    const next = nextPlaybackAction(playingRef.current, playback, (k) => tracks.has(k));
    // 'wait' deliberately leaves playingRef alone — the next poll retries and
    // the track starts the moment its download lands. The cue is also the
    // loader's signal to have another go at a download it had given up on.
    if (next.action === 'wait') {
      tracks.want(next.key);
    } else if (next.action === 'stop') {
      playingRef.current = null;
      audioEngine.stop({ fadeMs: playback.fadeOutMs });
    } else if (next.action === 'play') {
      playingRef.current = next.key;
      // The producer's trim, from the manifest: a walk-on cut to its drop
      // used to play whole through the PA while the operator's own device
      // played the slice.
      const published = payload?.audio?.find((t) => t.key === next.key);
      audioEngine
        .play(tracks.urlOf(next.key)!, {
          fadeInMs: playback.fadeInMs,
          fadeOutMs: playback.fadeOutMs,
          ...trimSlice(published ?? {}),
        })
        .catch(() => {});
    }
    // payload.audio is read at play time rather than listed: it arrives with
    // the same poll as the playback instruction, and listing it would re-run
    // this on every poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [soundOn, viewerKey, payload?.playback]);

  // Never leave a track running on a screen nobody is looking at.
  useEffect(() => () => audioEngine.stopNow(), []);

  function armSound() {
    audioEngine.init();
    setSoundOn(true);
  }

  // Match the producer's color scheme on the public viewer (don't persist it to
  // the visitor's device).
  useEffect(() => {
    if (payload?.theme) applyColorScheme(payload.theme, false);
  }, [payload?.theme]);

  useEffect(() => {
    if (payload?.showName) {
      document.title = `${payload.showName} — Live | I Can Run A Show`;
    }
    return () => { document.title = 'I Can Run A Show — Live-Show Management for Comedians & Promoters'; };
  }, [payload?.showName]);

  // Local tick so the timer counts down between server updates.
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, []);

  if (!payload && error) {
    return (
      <div className="live-viewer">
        <div className="live-viewer__message">{error}</div>
      </div>
    );
  }
  if (!payload) {
    return (
      <div className="live-viewer">
        <div className="live-viewer__message">Loading live view…</div>
      </div>
    );
  }

  // Pre-show state: just show showtime + optional admin note.
  if (payload.status === 'scheduled') {
    const startsAt = payload.startsAt ? new Date(payload.startsAt) : null;
    const valid = startsAt && !Number.isNaN(startsAt.getTime());
    let untilLabel: string | null = null;
    if (valid) {
      const diffMs = startsAt!.getTime() - now;
      if (diffMs > 0) {
        const totalMin = Math.round(diffMs / 60000);
        if (totalMin >= 60 * 24) untilLabel = `in ${Math.round(totalMin / (60 * 24))} day(s)`;
        else if (totalMin >= 60) untilLabel = `in ${Math.floor(totalMin / 60)}h ${totalMin % 60}m`;
        else if (totalMin > 0) untilLabel = `in ${totalMin} min`;
        else untilLabel = 'starting any minute';
      } else {
        untilLabel = 'starting soon';
      }
    }
    return (
      <div className="live-viewer live-viewer--pre">
        <div className="live-viewer__show">{payload.showName}</div>
        <div className="live-viewer__pre-label">Showtime</div>
        {valid ? (
          <>
            <div className="live-viewer__pre-when">
              {startsAt!.toLocaleString(undefined, {
                weekday: 'long',
                month: 'long',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
              })}
            </div>
            {untilLabel && <div className="live-viewer__pre-until">{untilLabel}</div>}
          </>
        ) : (
          <div className="live-viewer__pre-when">Time TBA</div>
        )}
        {payload.note && <div className="live-viewer__note">{payload.note}</div>}
        {payload.lineup && payload.lineup.length > 0 && (
          <div className="live-viewer__lineup">
            <div className="live-viewer__lineup-label">Lineup</div>
            <ol className="live-viewer__lineup-list">
              {payload.lineup.map((p, i) => (
                <li key={i} className="live-viewer__lineup-item">
                  <div className="live-viewer__lineup-photo live-viewer__lineup-photo--placeholder">
                    {(p.name || '·').charAt(0).toUpperCase()}
                  </div>
                  <div className="live-viewer__lineup-info">
                    <div className="live-viewer__lineup-name">{p.name}</div>
                    {p.credits && <div className="live-viewer__lineup-credits">{p.credits}</div>}
                  </div>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
    );
  }

  // Live state
  const seg = payload.segment ?? {};
  const next = payload.next ?? {};
  const remaining = remainingSeconds(payload, now);
  const isOver = remaining < 0;
  /**
   * The last minute, and only while the clock is actually running down.
   *
   * `remaining` is frozen at its last published value when the board is
   * paused or still counting into a cue, so a short cue reads as "under a
   * minute" before it has started. That was harmless when the warning was
   * red digits; a full-screen flash telling someone to wrap up a set they
   * haven't begun is not.
   */
  const warning = remaining <= 60 && payload.status === 'running';
  const showCountdown = payload.status === 'countdown' && payload.countdown && payload.countdown > 0;

  return (
    <div className={`live-viewer${warning ? ' live-viewer--alarm' : ''}`}>
      <div className="live-viewer__top">
        <span className="live-viewer__show">{payload.showName}</span>
        <span className={`live-viewer__status live-viewer__status--${payload.status}`}>{payload.status}</span>
      </div>

      {/* Only when the board has actually published audio to this link. A
          viewer with no sound to play should look exactly as it always did. */}
      {hasAudio && !soundOn && (
        <button className="live-viewer__sound" onClick={armSound}>
          Tap to enable sound on this screen
        </button>
      )}
      {hasAudio && soundOn && (
        <div className="live-viewer__sound live-viewer__sound--on" aria-live="polite">
          Sound on — this screen plays the walk-ons
        </div>
      )}

      <div className={`live-viewer__timer ${isOver ? 'live-viewer__timer--over' : ''} ${warning ? 'live-viewer__timer--warning' : ''}`}>
        {fmtCountdown(remaining)}
      </div>

      {showCountdown && (
        <div className="live-viewer__starting">Starting in {payload.countdown}…</div>
      )}

      <div className="live-viewer__cards">
        <div className="live-viewer__card">
          <div className="live-viewer__label">On stage</div>
          <div className="live-viewer__person">
            <div className="live-viewer__photo live-viewer__photo--placeholder">
              {(seg.name || '·').charAt(0).toUpperCase()}
            </div>
            <div className="live-viewer__info">
              <div className="live-viewer__name">{seg.name || seg.description || '—'}</div>
              {seg.credits && <div className="live-viewer__credits">{seg.credits}</div>}
            </div>
          </div>
        </div>

        <div className="live-viewer__card">
          <div className="live-viewer__label">Up next</div>
          <div className="live-viewer__person">
            <div className="live-viewer__photo live-viewer__photo--placeholder">
              {(next.name || '—').charAt(0).toUpperCase()}
            </div>
            <div className="live-viewer__info">
              <div className="live-viewer__name">{next.name || next.description || 'End of show'}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

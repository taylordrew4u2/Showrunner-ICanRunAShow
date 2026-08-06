import { useEffect, useRef, useState } from 'react';
import { fetchLiveView, type LiveViewPayload } from '../utils/liveView';
import { applyColorScheme } from '../utils/theme';
import { audioEngine } from '../utils/audioEngine';
import { fetchViewerTrack, nextPlaybackAction, readViewerKeyFromHash } from '../utils/viewerAudio';

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

export function LiveViewer({ token }: LiveViewerProps) {
  const [payload, setPayload] = useState<LiveViewPayload | null>(null);
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
  const trackUrls = useRef(new Map<string, string>());

  const hasAudio = !!viewerKey && !!payload?.audio?.length;

  // Poll the live view payload. Faster once this screen is carrying the sound:
  // a walk-on landing a beat late is worse than a countdown doing so.
  const pollMs = soundOn && hasAudio ? 500 : 1500;
  useEffect(() => {
    let alive = true;
    async function tick() {
      try {
        const p = await fetchLiveView(token);
        if (!alive) return;
        if (p) {
          setPayload(p);
          setError(null);
        } else if (initial.current) {
          setError('This live view link is not active yet.');
        }
      } catch {
        if (!alive) return;
        if (initial.current) setError("Couldn't reach the live view.");
      } finally {
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
  // cue doesn't arrive to find nothing decoded.
  const manifest = payload?.audio;
  // Every poll parses a fresh payload, so the array is a new object each time
  // even when the board has published nothing new. Keying the effect on the
  // contents stops it tearing down and restarting the downloads twice a second.
  const manifestKey = manifest?.map((t) => `${t.mediaId}:${t.total}`).join(',') ?? '';
  useEffect(() => {
    if (!soundOn || !viewerKey || !manifest?.length) return;
    let cancelled = false;
    (async () => {
      for (const track of manifest) {
        if (cancelled) return;
        if (trackUrls.current.has(track.key)) continue;
        const url = await fetchViewerTrack(token, viewerKey, track);
        if (cancelled || !url) continue;
        trackUrls.current.set(track.key, url);
        await audioEngine.preload(url).catch(() => {});
      }
    })();
    return () => { cancelled = true; };
    // manifestKey stands in for manifest — see above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [soundOn, viewerKey, token, manifestKey]);

  // Follow the board. `playback.key` is the whole instruction — which track,
  // or null for silence — so the screen simply matches whatever it last said.
  useEffect(() => {
    if (!soundOn || !viewerKey) return;
    const playback = payload?.playback;
    if (!playback) return;
    const next = nextPlaybackAction(playingRef.current, playback, (k) =>
      trackUrls.current.has(k),
    );
    // 'wait' deliberately falls through without touching playingRef — the next
    // poll retries and the track starts the moment its download lands.
    if (next.action === 'stop') {
      playingRef.current = null;
      audioEngine.stop({ fadeMs: playback.fadeOutMs });
    } else if (next.action === 'play') {
      playingRef.current = next.key;
      audioEngine
        .play(trackUrls.current.get(next.key)!, {
          fadeInMs: playback.fadeInMs,
          fadeOutMs: playback.fadeOutMs,
        })
        .catch(() => {});
    }
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
  const total = payload.remainingAtLastUpdate ?? 0;
  let remaining = total;
  if (payload.status === 'running') {
    remaining = total - (now - payload.lastUpdateMs) / 1000;
  }
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

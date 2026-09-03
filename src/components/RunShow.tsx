import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { DJSong, Performer, ScheduleItem } from '../types';
import { audioEngine } from '../utils/audioEngine';
import { padColor } from '../utils/padColor';
import { publishLiveView, type LiveViewPayload } from '../utils/liveView';
import { loadColorScheme } from '../utils/theme';
import {
  DEFAULT_CUE_SECONDS,
  MIN_CUE_SECONDS,
  baseDurations,
  fmtCountdown,
  fmtOffset,
  fmtShowTime,
} from '../utils/showTiming';
import {
  buildSoundboard,
  cuePerformerName,
  resolveCuePerformer,
  soundboardSources,
  type SoundboardTrack,
} from '../utils/soundboard';
import { useMediaUrl } from '../utils/useMediaUrl';
import { getMediaCredentials } from '../utils/mediaStore';
import {
  ensureViewerKey,
  publishTrack,
  unpublishAll,
  type ViewerTrack,
} from '../utils/viewerAudio';
import {
  FADE_PRESETS,
  FADE_STEP_MS,
  MAX_FADE_IN_MS,
  MAX_FADE_OUT_MS,
  describeFade,
  fmtFade,
  loadFadeSettings,
  matchesPreset,
  saveFadeSettings,
  type FadeSettings,
} from '../utils/audioSettings';
import { Icon } from './Icon';
import { useConfirm } from './useConfirm';
import { isRemotePress } from '../utils/stageRemote';

interface RunShowProps {
  showName: string;
  showId?: string;
  viewToken?: string;
  schedule: ScheduleItem[];
  performers?: Performer[];
  djSongs?: DJSong[];
  /**
   * How many tracks are in the account-wide Music library. Only used to tell
   * an empty board apart from an empty library — see the empty state below.
   */
  libraryCount?: number;
  /** The key a paired stage remote sends, if the operator has paired one. */
  remoteKey?: string;
  onStart?: () => void; // fired once when the show first starts (mark in-progress)
  onFinish?: () => void; // fired when the operator ends the show (mark completed)
  onClose: () => void;
}

const DRIFT_TOLERANCE = 30; // seconds we still count as "On Time"
const STEP_SECONDS = 2 * 60; // coarse +/- buttons
const FINE_STEP_SECONDS = 30; // fine +/- buttons
const WARNING_SECONDS = 60; // timer flashes red at/under this remaining
/** How long a fade audition sits at full volume before it fades back out. */
const AUDITION_HOLD_MS = 1500;
/** Tracks decoded at once when the board opens. See the preload effect. */
const PRELOAD_CONCURRENCY = 3;

/** What the operator is told when a press makes no sound. */
const FAILURE_MESSAGE: Record<string, string> = {
  'media-unavailable': "the audio file couldn't be loaded. Re-upload the track and try again.",
  'decode-failed': "this browser can't play that audio format. Try re-uploading it as MP3 or M4A.",
  'no-audio-support': 'this browser has no audio support.',
  blocked:
    'the browser is blocking audio. Press Start on the timer once, then try again — ' +
    'and on iPhone check the side switch is off silent.',
};

/**
 * One button on the board. Defined out here on purpose: the clock re-renders
 * every second, and a component declared inside RunShow would be a new type on
 * each of those renders — remounting every pad and restarting the playing
 * animation once a second.
 */
function TrackButton({
  track,
  variant,
  isPlaying,
  isLoading,
  onToggle,
}: {
  track: SoundboardTrack;
  variant: 'face' | 'disc';
  isPlaying: boolean;
  /** Pressed, but its audio is still being fetched and decoded. */
  isLoading: boolean;
  onToggle: (track: SoundboardTrack) => void;
}) {
  // The headshot resolves out of the media store; the initial holds the button
  // until it lands, so the board is pressable the moment the screen opens.
  const photoUrl = useMediaUrl(track.photo);
  // Its own colour, keyed off the track rather than its place on the board —
  // see padColor. This overrides the bank tint on the face; the banks keep
  // their headings, and the badge still says which pads are songs.
  const colour = padColor(track.key);
  return (
    <button
      type="button"
      style={{
        '--rs-knob-hi': colour.hi,
        '--rs-knob-lo': colour.lo,
        '--rs-knob-pointer': colour.pointer,
      } as CSSProperties}
      className={`rs-pad rs-pad--${variant} ${isPlaying ? 'rs-pad--playing' : ''}${
        isLoading ? ' rs-pad--loading' : ''
      }`}
      onClick={() => onToggle(track)}
      aria-pressed={isPlaying}
      title={isLoading ? `Loading ${track.label}…` : isPlaying ? `Stop ${track.label}` : `Play ${track.label}`}
    >
      <span className="rs-pad__face">
        {photoUrl ? (
          <img className="rs-pad__photo" src={photoUrl} alt="" />
        ) : (
          <span className="rs-pad__initial">{track.initial}</span>
        )}
        {variant === 'disc' && (
          <span className="rs-pad__kind" aria-hidden="true">
            ♪
          </span>
        )}
        {/* A pad that lights up as "playing" before its audio exists is the
            whole of "the button is delayed": the press registers, the picture
            says it started, and the room hears nothing. While a track is still
            loading the pad says so instead. */}
        <span className="rs-pad__state" aria-hidden="true">
          {isLoading ? (
            <span className="rs-pad__spinner" />
          ) : isPlaying ? (
            <span className="rs-pad__eq">
              <i />
              <i />
              <i />
            </span>
          ) : (
            <Icon name="play" size={16} />
          )}
        </span>
      </span>
      <span className="rs-pad__label">{track.label}</span>
      {track.sublabel && <span className="rs-pad__sub">{track.sublabel}</span>}
    </button>
  );
}

export function RunShow({
  showName,
  viewToken,
  schedule,
  performers = [],
  djSongs = [],
  libraryCount = 0,
  remoteKey,
  onStart,
  onFinish,
  onClose,
}: RunShowProps) {
  const { confirm, confirmDialog, confirmOpen } = useConfirm();
  const [idx, setIdx] = useState(0);
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0); // within current cue
  const [showElapsed, setShowElapsed] = useState(0); // whole show, real wall time
  const [adjust, setAdjust] = useState<Record<number, number>>({});
  const [muted, setMuted] = useState(false);
  // The button whose track is playing right now — the board's only audio state.
  // It is deliberately independent of `idx`: the clock and the sound are two
  // separate instruments and neither one drives the other.
  const [playingKey, setPlayingKey] = useState<string | null>(null);
  // The pad that has been pressed but whose audio is still being fetched and
  // decoded. Kept apart from playingKey so the board can show "coming" rather
  // than claiming it is already playing.
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  // A press that couldn't produce sound. Silence is the one thing an operator
  // can't diagnose mid-show, so a track that fails to load says why.
  const [audioError, setAudioError] = useState<string | null>(null);
  // How the board fades. Loaded once — the setting outlives the show, so it's
  // read from storage rather than passed in.
  const [fade, setFade] = useState<FadeSettings>(loadFadeSettings);
  // How many tracks are decoded and will start on the press with no wait.
  const [readyCount, setReadyCount] = useState(0);
  // Publishing the board's audio to the viewer, so the machine wired to the PA
  // plays the walk-ons instead of this device. Off unless the operator asks:
  // it re-uploads every track, and it makes the show's music readable by
  // anyone holding the viewer link.
  const [viewerAudio, setViewerAudio] = useState<ViewerTrack[] | null>(null);
  const [publishState, setPublishState] = useState<'idle' | 'publishing' | 'error'>('idle');
  const [publishDone, setPublishDone] = useState(0);
  const notifiedStartRef = useRef(false); // whether onStart has fired this session
  // The fade audition — see auditionFade(). Held in a ref so any press can call
  // the test off before its scheduled stop lands on somebody else's track.
  const [auditioning, setAuditioning] = useState(false);
  const auditionTimer = useRef<number | null>(null);

  const board = useMemo(
    () => buildSoundboard(schedule, performers, djSongs),
    [schedule, performers, djSongs],
  );
  const playingTrack = useMemo(() => {
    if (!playingKey) return null;
    return (
      [...board.performers, ...board.cues, ...board.dj].find((t) => t.key === playingKey) ?? null
    );
  }, [board, playingKey]);

  const base = useMemo(() => baseDurations(schedule), [schedule]);
  const effDurations = useMemo(
    () => base.map((d, i) => Math.max(MIN_CUE_SECONDS, d + (adjust[i] ?? 0))),
    [base, adjust],
  );
  const offsets = useMemo(() => {
    const arr: number[] = [];
    let acc = 0;
    for (const d of effDurations) {
      arr.push(acc);
      acc += d;
    }
    return arr;
  }, [effDurations]);

  const current = schedule[idx];
  const next = schedule[idx + 1];
  const totalSec = effDurations[idx] ?? DEFAULT_CUE_SECONDS;
  const remaining = totalSec - elapsed;
  const isOver = remaining < 0;
  const pct = Math.max(0, Math.min(100, (elapsed / totalSec) * 100));
  const isLast = idx >= schedule.length - 1;

  // Drift = real time used vs. where the plan says we should be. Recomputed from
  // current position so Prev / Jump / Reset stay consistent. Capping elapsed at
  // the allocation means an over-running cue reads as Behind.
  const drift = showElapsed - (offsets[idx] ?? 0) - Math.min(elapsed, totalSec);
  const status: 'On Time' | 'Behind' | 'Ahead' =
    drift > DRIFT_TOLERANCE ? 'Behind' : drift < -DRIFT_TOLERANCE ? 'Ahead' : 'On Time';

  const onStagePerformer = useMemo(
    () => resolveCuePerformer(current, performers),
    [current, performers],
  );
  const onStageName = cuePerformerName(current, performers);
  const nextName = cuePerformerName(next, performers);

  // ── Timer ────────────────────────────────────────────────────────────────
  // Start / pause moves the clock and nothing else. No track is started,
  // stopped, or faded from here.
  function notifyStart() {
    if (notifiedStartRef.current) return;
    notifiedStartRef.current = true;
    onStart?.();
  }

  function toggleRunning() {
    // A tap is a user gesture — the cheapest place to unlock the AudioContext
    // so the first soundboard press is instant.
    audioEngine.init();
    if (!running) notifyStart();
    setRunning((r) => !r);
  }

  // Tick the clocks while running.
  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(() => {
      setElapsed((e) => e + 1);
      setShowElapsed((e) => e + 1);
    }, 1000);
    return () => window.clearInterval(t);
  }, [running]);

  // Auto-advance to the next cue when this segment's timer reaches zero.
  useEffect(() => {
    if (!running || isLast) return;
    if (elapsed >= totalSec) {
      setIdx((i) => Math.min(schedule.length - 1, i + 1));
      setElapsed(0);
    }
  }, [running, elapsed, totalSec, isLast, schedule.length]);

  function goTo(target: number) {
    const t = Math.max(0, Math.min(schedule.length - 1, target));
    setIdx(t);
    setElapsed(0);
  }
  function goNext() {
    if (!isLast) goTo(idx + 1);
  }
  function goPrev() {
    if (idx > 0) goTo(idx - 1);
  }
  function resetCueTimer() {
    setElapsed(0);
  }
  function adjustTime(delta: number) {
    setAdjust((a) => ({ ...a, [idx]: (a[idx] ?? 0) + delta }));
  }

  async function restartShow() {
    const ok = await confirm({
      title: 'Restart from the top?',
      message:
        'The clock goes back to cue one and any time you added or took off is cleared. ' +
        'The running order itself is untouched.',
      confirmLabel: 'Restart',
      danger: false,
    });
    if (!ok) return;
    setIdx(0);
    setElapsed(0);
    setShowElapsed(0);
    setAdjust({});
    audioEngine.init();
    setRunning(true);
    notifyStart();
  }

  async function finishShow() {
    const ok = await confirm({
      title: 'End the show?',
      message:
        'The audio fades out and the show is marked completed. Your running order, lineup ' +
        'and timings are kept.',
      confirmLabel: 'End show',
      danger: false,
    });
    if (!ok) return;
    audioEngine.stop({ fadeMs: fade.fadeOutMs });
    onFinish?.();
    onClose();
  }

  // ── Soundboard ───────────────────────────────────────────────────────────
  // Every track on the board is decoded up front. A walk-on that has to fetch
  // and decode on the press lands a half-second late, which on stage is the
  // difference between a cue and a mistake.
  //
  // A few at a time rather than one after another: these are whole songs out of
  // the encrypted media store, and strictly sequential meant the last button on
  // a big lineup wasn't ready for a long while after the screen opened. Not all
  // at once either — that stalls the first track, which is the one most likely
  // to be pressed first.
  useEffect(() => {
    audioEngine.init();
    const sources = soundboardSources(board);
    let cancelled = false;
    // Counted from the engine rather than incremented: re-opening the board, or
    // an edit to the running order mid-show, re-runs this effect over tracks
    // that are already decoded, and a counter would tick past the total.
    const recount = () => setReadyCount(sources.filter((s) => audioEngine.isReady(s)).length);
    recount();
    const queue = [...sources];
    const worker = async () => {
      while (!cancelled) {
        const src = queue.shift();
        if (!src) return;
        await audioEngine.preload(src).catch(() => {});
        if (!cancelled) recount();
      }
    };
    void Promise.all(Array.from({ length: PRELOAD_CONCURRENCY }, worker));
    return () => {
      cancelled = true;
    };
  }, [board]);

  // Press to start, press again to stop. Pressing a different button hands
  // over: the outgoing track fades as the new one rises. Both fades are the
  // operator's setting — see the Fade control in the board header.
  /**
   * Cancel a fade audition that's still counting down to its own stop.
   *
   * Every path that starts or stops audio calls this first. Without it the
   * test's scheduled stop would land a second later on whatever the operator
   * pressed in the meantime — a walk-on cut off by a test they'd already
   * forgotten about is the worst possible way to learn what this button does.
   */
  function cancelAudition() {
    if (auditionTimer.current !== null) {
      window.clearTimeout(auditionTimer.current);
      auditionTimer.current = null;
    }
    setAuditioning(false);
  }

  /**
   * Play a real track with the current fade, then stop it with the current
   * fade, so "is the fade working?" is a question the room can answer before
   * doors rather than during the show. Uses the first pad on the board — a
   * synthetic tone would prove the engine works and nothing about the mix.
   */
  function auditionFade() {
    if (auditioning) {
      stopAll();
      return;
    }
    const track = board.performers[0] ?? board.cues[0] ?? board.dj[0];
    if (!track) return;
    cancelAudition();
    setAudioError(null);
    setPlayingKey(track.key);
    setAuditioning(true);
    audioEngine
      .play(track.src, { fadeInMs: fade.fadeInMs, fadeOutMs: fade.fadeOutMs, offsetSec: trimOf(track).offsetSec })
      .then((result) => {
        if (result === 'started' || result === 'superseded') return;
        cancelAudition();
        setPlayingKey((k) => (k === track.key ? null : k));
        setAudioError(`${track.label} — ${FAILURE_MESSAGE[result] ?? "it didn't play."}`);
      })
      .catch(() => cancelAudition());
    // Hold at full for a beat once the ramp is done, so the two ends of the
    // fade are heard as two separate things rather than one wobble.
    auditionTimer.current = window.setTimeout(() => {
      auditionTimer.current = null;
      setAuditioning(false);
      audioEngine.stop({ fadeMs: fade.fadeOutMs });
      setPlayingKey((k) => (k === track.key ? null : k));
    }, fade.fadeInMs + AUDITION_HOLD_MS);
  }

  /**
   * The slice of a track a press should play.
   *
   * A walk-on is rarely the top of the file — it's the drop or the chorus, and
   * a producer who trimmed it wants that and nothing else. An out-point before
   * the in-point is treated as no out-point rather than a negative duration,
   * which would schedule a stop in the past and cut the track dead.
   */
  function trimOf(track: SoundboardTrack): { offsetSec?: number; durationSec?: number } {
    const start = track.startSec && track.startSec > 0 ? track.startSec : undefined;
    const end = track.endSec && track.endSec > (start ?? 0) ? track.endSec : undefined;
    return { offsetSec: start, durationSec: end ? end - (start ?? 0) : undefined };
  }

  function toggleTrack(track: SoundboardTrack) {
    cancelAudition();
    if (playingKey === track.key) {
      audioEngine.stop({ fadeMs: fade.fadeOutMs });
      setPlayingKey(null);
      setLoadingKey(null);
      return;
    }
    setPlayingKey(track.key);
    // Decoded tracks start on the press; only an undecoded one has to wait,
    // and only that one should show the wait.
    setLoadingKey(audioEngine.isReady(track.src) ? null : track.key);
    setAudioError(null);
    // Only report if this button is still the lit one — being superseded by a
    // later press is normal and must not raise an error.
    const failed = (reason: string) => {
      setLoadingKey((k) => (k === track.key ? null : k));
      setPlayingKey((k) => {
        if (k !== track.key) return k;
        const why = FAILURE_MESSAGE[reason] ?? "it didn't play.";
        setAudioError(`${track.label} — ${why}`);
        return null;
      });
    };
    audioEngine
      .play(track.src, {
        fadeInMs: fade.fadeInMs,
        fadeOutMs: fade.fadeOutMs,
        ...trimOf(track),
        onEnded: () => setPlayingKey((k) => (k === track.key ? null : k)),
      })
      .then((result) => {
        setLoadingKey((k) => (k === track.key ? null : k));
        if (result !== 'started' && result !== 'superseded') failed(result);
      })
      .catch(() => failed('media-unavailable'));
  }

  function stopAll() {
    cancelAudition();
    audioEngine.stop({ fadeMs: fade.fadeOutMs });
    setPlayingKey(null);
    setLoadingKey(null);
    setAudioError(null);
  }

  // ── Viewer audio ─────────────────────────────────────────────────────────
  // Re-encrypt every board track under this show's viewer key and upload it,
  // so the viewer can play on cue. Sequential on purpose: these are whole
  // songs, and saturating the uplink before a show helps nobody.
  async function publishViewerAudio() {
    const creds = getMediaCredentials();
    if (!viewToken || !creds) {
      setPublishState('error');
      return;
    }
    const key = ensureViewerKey(viewToken);
    const tracks = [...board.performers, ...board.cues, ...board.dj];
    setPublishState('publishing');
    setPublishDone(0);
    const published: ViewerTrack[] = [];
    try {
      for (const track of tracks) {
        // A stable id per board key, so re-publishing overwrites rather than
        // piling up a second copy of every track under the token.
        const mediaId = `t-${track.key.replace(/[^a-zA-Z0-9]/g, '-')}`.slice(0, 60);
        const total = await publishTrack(viewToken, key, track.src, mediaId, creds);
        published.push({ key: track.key, mediaId, total });
        setPublishDone((n) => n + 1);
      }
      setViewerAudio(published);
      setPublishState('idle');
    } catch {
      setPublishState('error');
    }
  }

  async function stopViewerAudio() {
    setViewerAudio(null);
    setPublishState('idle');
    const creds = getMediaCredentials();
    if (viewToken && creds) await unpublishAll(viewToken, creds).catch(() => {});
  }

  // Persist whenever the operator moves a slider or picks a preset. Applies to
  // the next press — a fade already scheduled on a running track is left alone.
  function updateFade(next: Partial<FadeSettings>) {
    setFade((f) => {
      const merged = { ...f, ...next };
      saveFadeSettings(merged);
      return merged;
    });
  }

  function toggleMute() {
    setMuted((m) => !m);
  }

  // Keep mute state in sync with the engine.
  useEffect(() => {
    audioEngine.setMuted(muted);
  }, [muted]);

  // Stop on unmount — including an audition still waiting to fade itself out.
  useEffect(
    () => () => {
      if (auditionTimer.current !== null) window.clearTimeout(auditionTimer.current);
      audioEngine.stopNow();
    },
    [],
  );

  // ── Live viewer publishing ───────────────────────────────────────────────
  // Publish the live state when something meaningful changes. The viewer
  // interpolates the remaining seconds between updates from lastUpdateMs, so we
  // don't need to write on every tick. The viewer link itself is configured in
  // the show detail page (Viewer link button); we just write to its token here.
  useEffect(() => {
    if (!viewToken) return;
    const liveStatus: LiveViewPayload['status'] =
      running ? 'running' : showElapsed > 0 || idx > 0 ? 'paused' : 'idle';
    const payload: LiveViewPayload = {
      showName,
      status: liveStatus,
      theme: loadColorScheme(),
      segment: {
        name: onStageName,
        description: current?.description,
        credits: onStagePerformer?.credits,
      },
      next: {
        name: nextName || undefined,
        description: next?.description,
      },
      totalSec,
      remainingAtLastUpdate: totalSec - elapsed,
      lastUpdateMs: Date.now(),
      ...(viewerAudio
        ? {
            audio: viewerAudio,
            playback: {
              key: playingKey,
              atMs: Date.now(),
              fadeInMs: fade.fadeInMs,
              fadeOutMs: fade.fadeOutMs,
            },
          }
        : {}),
    };
    publishLiveView(viewToken, payload).catch(() => { /* swallow */ });
    // playingKey is in the deps on purpose: when the viewer is carrying the
    // sound, a press has to reach it immediately rather than waiting for the
    // next cue change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewToken, idx, running, totalSec, showName, playingKey, viewerAudio]);

  // On Run Show close, mark the live view ended so viewers see the final state.
  useEffect(() => () => {
    if (!viewToken) return;
    const payload: LiveViewPayload = {
      showName,
      status: 'ended',
      theme: loadColorScheme(),
      segment: {
        name: onStageName,
        description: current?.description,
        credits: onStagePerformer?.credits,
      },
      next: {},
      totalSec,
      remainingAtLastUpdate: 0,
      lastUpdateMs: Date.now(),
    };
    publishLiveView(viewToken, payload).catch(() => { /* ignore */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  /**
   * Hold the screen awake while the show runs.
   *
   * A laptop that sleeps mid-set takes the soundboard with it, and takes the
   * stage remote with it too — a remote can only reach an app the machine is
   * still running. Re-requested when the tab comes back, because the lock is
   * dropped whenever the page is hidden. Unsupported browsers simply carry on
   * without it.
   */
  useEffect(() => {
    type Sentinel = { release: () => Promise<void> };
    const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<Sentinel> } };
    if (!nav.wakeLock) return;
    let sentinel: Sentinel | null = null;
    let dropped = false;
    const acquire = async () => {
      try {
        sentinel = await nav.wakeLock!.request('screen');
      } catch {
        // Denied (a background tab, or battery saver). Nothing to do but run.
      }
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible' && !dropped) void acquire();
    };
    void acquire();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      dropped = true;
      document.removeEventListener('visibilitychange', onVisible);
      void sentinel?.release().catch(() => {});
    };
  }, []);

  /**
   * Real fullscreen, not just a full-viewport layout.
   *
   * A stage remote types into whatever the computer is looking at, so the one
   * way it fails is something else taking focus — the browser's own tabs and
   * address bar, another window, a stray click on the desktop. Fullscreen
   * removes all of those from reach for the length of the show, which is a
   * better answer than asking the operator to be careful from thirty feet
   * away.
   */
  const [isFullscreen, setIsFullscreen] = useState(false);
  useEffect(() => {
    const sync = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', sync);
    sync();
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      // Refused (an iframe without permission, or an unsupported browser).
      // The show runs the same either way.
    }
  }

  // Keyboard: the clock only. Space would otherwise re-fire whichever
  // soundboard button was last pressed — preventDefault keeps the press from
  // reaching it, so the spacebar always means "start / pause the timer".
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // A confirmation is on screen and hasn't been answered. Every shortcut
      // below acts on the show behind it: Escape closed the whole Run Show out
      // from under the prompt, and the spacebar started the clock while
      // "restart from the top?" was still waiting for an answer.
      if (confirmOpen) return;
      const el = e.target as HTMLElement | null;
      // A fade slider is an <input>, but it isn't typing — and once the
      // operator has touched one it holds focus. Treating it as a text field
      // would mean the spacebar silently stopped starting and pausing the
      // show, which is the one key that has to work every time.
      const isSlider = el instanceof HTMLInputElement && el.type === 'range';
      const typing =
        !!el &&
        ((el.tagName === 'INPUT' && !isSlider) || el.tagName === 'TEXTAREA' || el.isContentEditable);
      if (typing) return;
      if (e.key === 'Escape') onClose();
      if (e.key === ' ') {
        e.preventDefault();
        toggleRunning();
      }
      // Arrows belong to a focused slider — nudging a fade must never move the
      // running order.
      if (isSlider) return;
      if (e.key === 'ArrowRight') goNext();
      if (e.key === 'ArrowLeft') goPrev();
      // One key for the music, because a remote has few buttons and the
      // question during a show is only ever "is it playing or not". Playing →
      // stop. Silent → start whatever this cue calls for: its own track if it
      // has one, otherwise the walk-on of whoever is on stage. Nothing to play
      // is a no-op rather than an error; the operator is mid-show.
      if (e.key === 's' || e.key === 'S' || isRemotePress(e.key, remoteKey)) {
        e.preventDefault();
        if (playingKey) {
          stopAll();
        } else if (current) {
          const forCue = board.cues.find((t) => t.key === `cue:${current.id}`);
          const forPerformer = current.performerId
            ? board.performers.find((t) => t.key === `performer:${current.performerId}`)
            : undefined;
          const track = forCue ?? forPerformer;
          if (track) toggleTrack(track);
        }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, running, isLast, confirmOpen, playingKey, current, board, remoteKey]);

  const started = running || showElapsed > 0 || idx > 0;
  const startLabel = running ? 'Pause' : started ? 'Resume' : 'Start';
  const djWithoutAudio = djSongs.filter((s) => !s.music).length;
  const hasBoard = board.performers.length > 0 || board.cues.length > 0 || board.dj.length > 0;
  // Distinct audio files — what gets decoded, so what the ready count counts.
  const trackCount = useMemo(() => soundboardSources(board).length, [board]);
  // Buttons on the board. Publishing walks these, not the distinct files, so
  // two performers sharing a track would otherwise overrun the progress count.
  const padCount = board.performers.length + board.cues.length + board.dj.length;

  if (schedule.length === 0) {
    return (
      <div className="run-show" role="dialog" aria-modal="true" aria-label="Run show">
        <div className="run-show__bar">
          <span className="run-show__name">{showName}</span>
          <button className="run-show__close" onClick={onClose} aria-label="Close run show">
            <Icon name="x" size={18} />
          </button>
        </div>
        <div className="run-show__empty">
          <div className="run-show__empty-title">No cues yet</div>
          <p>Add some schedule items first, then come back to run the show.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="run-show" role="dialog" aria-modal="true" aria-label="Run show">
      <div className="run-show__bar">
        <span className="run-show__name">{showName}</span>
        <div className="run-show__bar-actions">
          <button
            className="run-show__fullscreen"
            onClick={toggleFullscreen}
            title={isFullscreen
              ? 'Leave fullscreen'
              : 'Fill the screen, so nothing else can take focus from your remote'}
            aria-label={isFullscreen ? 'Leave fullscreen' : 'Enter fullscreen'}
          >
            <Icon name={isFullscreen ? 'x' : 'tv'} size={16} />
            <span>{isFullscreen ? 'Exit full' : 'Fullscreen'}</span>
          </button>

          <button className="run-show__restart" onClick={restartShow} title="Restart the timer from the top">
            Restart
          </button>
          <button className="run-show__finish" onClick={finishShow} title="End the show and mark it completed">
            Finish show
          </button>
          <button className="run-show__close" onClick={onClose} aria-label="Close run show">
            <Icon name="x" size={18} />
          </button>
        </div>
      </div>

      <div className="run-show__scroll">
        {/* ── Clock ───────────────────────────────────────────────────── */}
        <section className="rs-panel rs-clock">
          <div className="rs-clock__head">
            <span className="rs-clock__pos">
              Cue {idx + 1} / {schedule.length}
            </span>
            <span className={`rs-clock__status rs-clock__status--${status.toLowerCase().replace(' ', '-')}`}>
              {status}
            </span>
            <span className="rs-clock__showtime">{fmtShowTime(showElapsed)}</span>
          </div>

          <div
            className={`rs-clock__time ${isOver ? 'rs-clock__time--over' : ''} ${
              !isOver && remaining <= WARNING_SECONDS ? 'rs-clock__time--warning' : ''
            }`}
          >
            {fmtCountdown(remaining)}
          </div>

          <div className="rs-clock__cue">
            <span className="rs-clock__cue-desc">{current?.description || 'Untitled cue'}</span>
            {onStageName && <span className="rs-clock__cue-who">{onStageName}</span>}
          </div>
          <div className="rs-clock__range">
            {fmtOffset(offsets[idx] ?? 0)}–{fmtOffset((offsets[idx] ?? 0) + totalSec)}
            {next ? ` · Next: ${next.description || 'Untitled cue'}${nextName ? ` (${nextName})` : ''}` : ' · Last cue'}
          </div>

          <div className="rs-progress">
            <div
              className={`rs-progress__bar ${isOver ? 'rs-progress__bar--over' : ''}`}
              style={{ width: `${pct}%` }}
            />
          </div>

          {/* Transport — the only controls that touch the clock. */}
          <div className="rs-transport">
            <button className="rs-btn" onClick={goPrev} disabled={idx === 0} title="Previous cue">
              <Icon name="back-skip" size={18} />
              <span>Prev</span>
            </button>
            <button
              className={`rs-btn rs-btn--transport ${running ? 'rs-btn--pause' : 'rs-btn--start'}`}
              onClick={toggleRunning}
            >
              <Icon name={running ? 'pause' : 'play'} size={20} />
              <span>{startLabel}</span>
            </button>
            <button className="rs-btn" onClick={goNext} disabled={isLast} title="Next cue">
              <Icon name="skip" size={18} />
              <span>Next</span>
            </button>
          </div>
          <div className="rs-nudge">
            <button className="rs-chip" onClick={() => adjustTime(-STEP_SECONDS)}>−2 min</button>
            <button className="rs-chip" onClick={() => adjustTime(-FINE_STEP_SECONDS)}>−30s</button>
            <button className="rs-chip" onClick={() => adjustTime(FINE_STEP_SECONDS)}>+30s</button>
            <button className="rs-chip" onClick={() => adjustTime(STEP_SECONDS)}>+2 min</button>
            <button className="rs-chip" onClick={resetCueTimer}>Reset cue</button>
          </div>
        </section>

        {/* ── Soundboard ──────────────────────────────────────────────── */}
        <section className="rs-panel rs-board">
          <div className="rs-board__head">
            <h2 className="rs-board__title">Soundboard</h2>
            <div className="rs-board__actions">
              <button className="rs-chip" onClick={stopAll} disabled={!playingKey}>
                Stop audio
              </button>
              <button className={`rs-chip ${muted ? 'rs-chip--active' : ''}`} onClick={toggleMute}>
                {muted ? 'Unmute' : 'Mute'}
              </button>
            </div>
          </div>

          {/* Fade lives on the board, not behind a menu. It's a mix decision an
              operator makes between cues — reaching through a disclosure for it
              mid-show is the same as not having it. */}
          <div className="rs-fade">
            <div className="rs-fade__head">
              <span className="rs-fade__title">Fade</span>
              <div className="rs-fade__presets">
                {FADE_PRESETS.map((p) => (
                  <button
                    key={p.id}
                    className={`rs-chip ${matchesPreset(fade, p.fade) ? 'rs-chip--active' : ''}`}
                    onClick={() => updateFade(p.fade)}
                    title={p.hint}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              {/* Not a fourth preset — it changes nothing, it just plays one.
                  Pushed to the end of the row so it doesn't read as one. */}
              <button
                className={`rs-chip rs-fade__hear ${auditioning ? 'rs-chip--active' : ''}`}
                onClick={auditionFade}
                disabled={!hasBoard}
                title={
                  hasBoard
                    ? 'Play a track with this fade, then fade it back out'
                    : 'Upload some audio first'
                }
              >
                {auditioning ? '■ Stop test' : '▶ Hear it'}
              </button>
            </div>
            {/* The sliders say "0.00s"; this says what that means. An operator
                who has set the in-fade to zero and heard no swell needs to be
                told it's off, not left deciding the feature is broken. */}
            <p className="rs-fade__summary">{describeFade(fade)}</p>
            {viewToken && (
              <div className="rs-fade__viewer">
                <button
                  className={`rs-chip ${viewerAudio ? 'rs-chip--active' : ''}`}
                  onClick={viewerAudio ? stopViewerAudio : publishViewerAudio}
                  disabled={publishState === 'publishing' || !hasBoard}
                >
                  {publishState === 'publishing'
                    ? `Sending ${publishDone}/${padCount}…`
                    : viewerAudio
                      ? 'Playing on viewer screen'
                      : 'Play through viewer screen'}
                </button>
                <span className="rs-fade__viewer-note">
                  {publishState === 'error'
                    ? "Couldn't send the audio — check your connection and try again."
                    : viewerAudio
                      ? 'The viewer link plays the walk-ons. Anyone with that link can hear them.'
                      : 'Send this board to the viewer link, for the machine wired to the PA.'}
                </span>
              </div>
            )}

          </div>

          <div className="rs-board__now" aria-live="polite">
            {audioError ? (
              <span className="rs-board__now-text rs-board__now-text--error">{audioError}</span>
            ) : playingTrack ? (
              <>
                <span className="rs-board__now-dot" aria-hidden="true" />
                <span className="rs-board__now-text">
                  {loadingKey === playingTrack.key ? 'Loading: ' : 'Playing: '}
                  <strong>{playingTrack.label}</strong>
                  {playingTrack.sublabel ? ` · ${playingTrack.sublabel}` : ''}
                </span>
              </>
            ) : trackCount > 0 && readyCount < trackCount ? (
              // Until a track is decoded, its first press has to wait on the
              // download. Saying so beats an operator wondering why the one
              // button they tried was slow when the rest are instant.
              <span className="rs-board__now-text">
                Loading tracks — {readyCount} of {trackCount} ready to play instantly.
              </span>
            ) : (
              <span className="rs-board__now-text">
                Nothing playing. Press a face to start their song, press it again to stop.
              </span>
            )}
          </div>

          {/* Faders left, pads right — the layout of the desk this stands in
              for, and the one an operator's hands already know. */}
          <div className="rs-console">
            <div className="rs-console__levels">
              <span className="rs-console__levels-title">Fade</span>
              <label className="rs-fader">
                <span className="rs-fader__value">{fmtFade(fade.fadeInMs)}</span>
                <span className="rs-fader__slot">
                  <input
                    className="rs-fade__slider"
                    type="range"
                    min={0}
                    max={MAX_FADE_IN_MS}
                    step={FADE_STEP_MS}
                    value={fade.fadeInMs}
                    onChange={(e) => updateFade({ fadeInMs: Number(e.target.value) })}
                  />
                </span>
                <span className="rs-fader__label">In</span>
              </label>
              <label className="rs-fader">
                <span className="rs-fader__value">{fmtFade(fade.fadeOutMs)}</span>
                <span className="rs-fader__slot">
                  <input
                    className="rs-fade__slider"
                    type="range"
                    min={0}
                    max={MAX_FADE_OUT_MS}
                    step={FADE_STEP_MS}
                    value={fade.fadeOutMs}
                    onChange={(e) => updateFade({ fadeOutMs: Number(e.target.value) })}
                  />
                </span>
                <span className="rs-fader__label">Out</span>
              </label>
            </div>

            <div className="rs-console__banks">
          {board.performers.length > 0 && (
            <div className="rs-bank">
              <div className="rs-bank__label">Performers</div>
              <div className="rs-bank__grid">
                {board.performers.map((t) => (
                  <TrackButton
                    key={t.key}
                    track={t}
                    variant="face"
                    isPlaying={playingKey === t.key}
                    isLoading={loadingKey === t.key}
                    onToggle={toggleTrack}
                  />
                ))}
              </div>
            </div>
          )}

          {board.cues.length > 0 && (
            <div className="rs-bank rs-bank--cues">
              <div className="rs-bank__label">Show tracks</div>
              <div className="rs-bank__grid">
                {board.cues.map((t) => (
                  <TrackButton
                    key={t.key}
                    track={t}
                    variant="disc"
                    isPlaying={playingKey === t.key}
                    isLoading={loadingKey === t.key}
                    onToggle={toggleTrack}
                  />
                ))}
              </div>
            </div>
          )}

          {board.dj.length > 0 && (
            <div className="rs-bank rs-bank--dj">
              <div className="rs-bank__label">DJ</div>
              <div className="rs-bank__grid">
                {board.dj.map((t) => (
                  <TrackButton
                    key={t.key}
                    track={t}
                    variant="disc"
                    isPlaying={playingKey === t.key}
                    isLoading={loadingKey === t.key}
                    onToggle={toggleTrack}
                  />
                ))}
              </div>
            </div>
          )}

          {/* An empty board is the app telling the truth — a pad exists only
              where an audio file is actually attached. But "no audio uploaded"
              reads as a bug to someone who has spent an evening uploading
              tracks to the Music library, because a library track does nothing
              for a show until it's added to that show's DJ list. So the empty
              state says which of the two situations this is. */}
          {!hasBoard && (
            <p className="rs-board__empty">
              {libraryCount > 0 ? (
                <>
                  Nothing on the board yet — this show has no audio attached.
                  You have {libraryCount} track{libraryCount === 1 ? '' : 's'} in your Music
                  library and they're already in this show's DJ list, but a track only gets a
                  button here once it has an audio file on it. Walk-on music on a performer and
                  music on a cue get a button here too.
                </>
              ) : (
                <>
                  No audio uploaded yet. Add walk-on music to a performer, music to a cue, or
                  upload tracks in the DJ section, and each one gets a button here.
                </>
              )}
            </p>
          )}
          {djWithoutAudio > 0 && (
            <p className="rs-board__note">
              {djWithoutAudio} DJ {djWithoutAudio === 1 ? 'song has' : 'songs have'} no audio
              uploaded — upload the file in the DJ section to get a button.
            </p>
          )}
            </div>
          </div>
        </section>

        {/* ── Lineup ──────────────────────────────────────────────────── */}
        <section className="rs-panel rs-lineup">
          <h2 className="rs-lineup__title">Lineup</h2>
          <ol className="rs-lineup__list">
            {schedule.map((cue, i) => {
              const who = cuePerformerName(cue, performers);
              return (
                <li key={cue.id}>
                  <button
                    className={`rs-lineup__row ${i === idx ? 'rs-lineup__row--current' : ''} ${
                      i < idx ? 'rs-lineup__row--done' : ''
                    }`}
                    onClick={() => goTo(i)}
                    title="Move the timer to this cue"
                  >
                    <span className="rs-lineup__num">{i + 1}</span>
                    <span className="rs-lineup__range">
                      {fmtOffset(offsets[i])}–{fmtOffset(offsets[i] + effDurations[i])}
                    </span>
                    <span className="rs-lineup__body">
                      <span className="rs-lineup__desc">{cue.description || 'Untitled cue'}</span>
                      {who && <span className="rs-lineup__who">{who}</span>}
                    </span>
                    <span className="rs-lineup__len">{Math.max(1, Math.round(effDurations[i] / 60))}m</span>
                    {i === idx && <span className="rs-lineup__badge">Now</span>}
                  </button>
                </li>
              );
            })}
          </ol>
        </section>
      </div>
      {confirmDialog}
    </div>
  );
}

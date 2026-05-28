import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Performer, ScheduleItem } from '../types';
import { publishLiveView, type LiveViewPayload } from '../utils/liveView';
import { Icon } from './Icon';

interface RunShowProps {
  showName: string;
  showId?: string;
  viewToken?: string;
  schedule: ScheduleItem[];
  performers?: Performer[];
  onClose: () => void;
}

const DEFAULT_CUE_SECONDS = 5 * 60;
const MIN_CUE_SECONDS = 30;
const DRIFT_TOLERANCE = 30; // seconds we still count as "On Time"
const STEP_SECONDS = 2 * 60; // coarse +/- buttons
const FINE_STEP_SECONDS = 30; // fine +/- buttons
const PREROLL_SECONDS = 5; // flashing countdown before each segment
const FADE_MS = 800; // audio fade in/out duration
const WARNING_SECONDS = 60; // timer flashes red at/under this remaining

function parseClockToMinutes(time: string | undefined): number | null {
  if (!time) return null;
  const m = time.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const mins = m[2] ? parseInt(m[2], 10) : 0;
  const meridiem = m[3]?.toLowerCase();
  if (meridiem === 'pm' && h < 12) h += 12;
  if (meridiem === 'am' && h === 12) h = 0;
  if (h > 23 || mins > 59) return null;
  return h * 60 + mins;
}

// Pull an explicit duration out of a cue, e.g. "Host transition (1 min)" or "Intro 90 sec".
function parseDurationSeconds(text: string | undefined): number | null {
  if (!text) return null;
  const min = text.match(/(\d+(?:\.\d+)?)\s*min/i);
  if (min) return Math.round(parseFloat(min[1]) * 60);
  const sec = text.match(/(\d+)\s*sec/i);
  if (sec) return parseInt(sec[1], 10);
  return null;
}

function baseDurations(schedule: ScheduleItem[]): number[] {
  const clock = schedule.map((s) => parseClockToMinutes(s.time));
  return schedule.map((s, i) => {
    // An explicit per-segment length wins so Run Show matches what was set.
    if (s.durationMin && s.durationMin > 0) return Math.max(MIN_CUE_SECONDS, s.durationMin * 60);
    const cur = clock[i];
    const next = clock[i + 1];
    if (cur != null && next != null && next > cur) return (next - cur) * 60;
    const fromText = parseDurationSeconds(s.description);
    if (fromText != null) return Math.max(MIN_CUE_SECONDS, fromText);
    return DEFAULT_CUE_SECONDS;
  });
}

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

// MM:SS, or H:MM:SS once we cross an hour. Used for the planned segment range.
function fmtOffset(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

// HH:MM:SS for the running show clock.
function fmtShowTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

// MM:SS countdown, negative once a cue runs over.
function fmtCountdown(seconds: number): string {
  const neg = seconds < 0;
  const s = Math.abs(Math.floor(seconds));
  return `${neg ? '-' : ''}${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
}

function nextUpLabel(desc: string, durationSec: number): string {
  const mins = Math.max(1, Math.round(durationSec / 60));
  if (/\d+\s*(min|sec)/i.test(desc)) return desc;
  return `${desc} (${mins} min)`;
}

export function RunShow({ showName, viewToken, schedule, performers = [], onClose }: RunShowProps) {
  const [idx, setIdx] = useState(0);
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0); // within current cue
  const [showElapsed, setShowElapsed] = useState(0); // whole show, real wall time
  const [adjust, setAdjust] = useState<Record<number, number>>({});
  const [muted, setMuted] = useState(false);
  const [showCues, setShowCues] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null); // pre-roll seconds before a segment starts
  const [loadedSrc, setLoadedSrc] = useState<string | undefined>(undefined); // audio src — only swaps after fade-out
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const startedIdxRef = useRef<number | null>(null); // idx whose pre-roll has completed
  const fadeRef = useRef<number | null>(null);

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
  const drift = showElapsed - offsets[idx] - Math.min(elapsed, totalSec);
  const status: 'On Time' | 'Behind' | 'Ahead' =
    drift > DRIFT_TOLERANCE ? 'Behind' : drift < -DRIFT_TOLERANCE ? 'Ahead' : 'On Time';

  // Resolve the cue's music: an uploaded track wins, then the assigned comic's
  // walk-on, then a name match in the description (legacy). Duration always
  // comes from the cue so it stays adjustable per segment.
  const currentMusic = useMemo<{ src: string; name: string; duration?: number } | null>(() => {
    if (!current) return null;
    if (current.music) {
      return { src: current.music, name: current.musicName || 'Uploaded track', duration: current.musicDuration };
    }
    const assigned = current.performerId ? performers.find((p) => p.id === current.performerId) : null;
    if (assigned?.walkOnMusic) {
      return { src: assigned.walkOnMusic, name: assigned.walkOnMusicName || assigned.name, duration: current.musicDuration };
    }
    const hay = `${current.description} ${current.performer ?? ""}`.toLowerCase();
    const match = performers.find((p) => p.walkOnMusic && hay.includes(p.name.toLowerCase()));
    if (match?.walkOnMusic) {
      return { src: match.walkOnMusic, name: match.walkOnMusicName || match.name, duration: current.musicDuration };
    }
    return null;
  }, [current, performers]);
  const hasAudio = !!currentMusic;

  // Who's on stage for this cue: the linked performer record, else a name match.
  const resolveCuePerformer = useCallback(
    (cue: ScheduleItem | undefined): Performer | null => {
      if (!cue) return null;
      if (cue.performerId) return performers.find((p) => p.id === cue.performerId) ?? null;
      const n = (cue.performer ?? '').trim().toLowerCase();
      if (n) return performers.find((p) => p.name.toLowerCase() === n) ?? null;
      return null;
    },
    [performers],
  );
  const onStagePerformer = useMemo<Performer | null>(() => resolveCuePerformer(current), [current, resolveCuePerformer]);
  const onStageName = onStagePerformer?.name || current?.performer || '';
  const nextPerformer = useMemo<Performer | null>(() => resolveCuePerformer(next), [next, resolveCuePerformer]);
  const nextName = nextPerformer?.name || next?.performer || '';

  // Tick the clocks while running — but not during a pre-roll countdown.
  useEffect(() => {
    if (!running || countdown !== null) return;
    const t = window.setInterval(() => {
      setElapsed((e) => e + 1);
      setShowElapsed((e) => e + 1);
    }, 1000);
    return () => window.clearInterval(t);
  }, [running, countdown]);

  // Auto-advance to the next cue when this segment's timer reaches zero.
  useEffect(() => {
    if (!running || countdown !== null || isLast) return;
    if (elapsed >= totalSec) {
      setIdx((i) => Math.min(schedule.length - 1, i + 1));
      setElapsed(0);
    }
  }, [running, countdown, elapsed, totalSec, isLast, schedule.length]);

  // ── Audio fades ──────────────────────────────────────────────────────────
  function clearFade() {
    if (fadeRef.current) {
      window.clearInterval(fadeRef.current);
      fadeRef.current = null;
    }
  }
  function fadeInAudio() {
    const audio = audioRef.current;
    if (!audio) return;
    clearFade();
    audio.currentTime = 0;
    audio.volume = 0;
    audio.play().catch(() => {});
    const start = performance.now();
    fadeRef.current = window.setInterval(() => {
      const t = Math.min(1, (performance.now() - start) / FADE_MS);
      audio.volume = t;
      if (t >= 1) clearFade();
    }, 30);
  }
  function fadeOutAudio(onDone?: () => void) {
    const audio = audioRef.current;
    if (!audio || audio.paused) {
      onDone?.();
      return;
    }
    clearFade();
    const startVol = audio.volume;
    const start = performance.now();
    fadeRef.current = window.setInterval(() => {
      const t = Math.min(1, (performance.now() - start) / FADE_MS);
      audio.volume = startVol * (1 - t);
      if (t >= 1) {
        clearFade();
        audio.pause();
        audio.currentTime = 0;
        audio.volume = 1;
        onDone?.();
      }
    }, 30);
  }

  // Swap the loaded audio src only after fading out the current one — so
  // segment changes get a fade-out instead of an instant cut.
  useEffect(() => {
    const targetSrc = currentMusic?.src;
    if (targetSrc === loadedSrc) return;
    const audio = audioRef.current;
    if (audio && !audio.paused) {
      fadeOutAudio(() => setLoadedSrc(targetSrc));
    } else {
      setLoadedSrc(targetSrc);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentMusic]);

  // Start a flashing pre-roll countdown when entering a segment while running.
  useEffect(() => {
    if (!running || countdown !== null) return;
    if (startedIdxRef.current === idx) return;
    setCountdown(PREROLL_SECONDS);
  }, [running, idx, countdown]);

  // Run the countdown; when it ends, the segment starts and its music fades in.
  useEffect(() => {
    if (countdown === null || !running) return;
    if (countdown <= 0) {
      startedIdxRef.current = idx;
      setCountdown(null);
      if (currentMusic) fadeInAudio();
      return;
    }
    const t = window.setTimeout(() => setCountdown((c) => (c === null ? null : c - 1)), 1000);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countdown, running, idx]);

  function skipCountdown() {
    if (countdown !== null) setCountdown(0);
  }

  // Enforce the per-cue play duration on ALL playback — fade out at the limit.
  function handleTimeUpdate() {
    const audio = audioRef.current;
    const limit = currentMusic?.duration;
    if (audio && !audio.paused && limit && limit > 0 && audio.currentTime >= limit) {
      fadeOutAudio();
    }
  }

  // Keep the audio element's mute state in sync (incl. newly mounted cues).
  useEffect(() => {
    if (audioRef.current) audioRef.current.muted = muted;
  }, [muted, idx, hasAudio]);

  // Clean up any running fade on unmount.
  useEffect(() => () => clearFade(), []);

  // ── Live viewer publishing ───────────────────────────────────────────────
  // Publish the live state when something meaningful changes. The viewer
  // interpolates the remaining seconds between updates from lastUpdateMs, so we
  // don't need to write on every tick. The viewer link itself is configured in
  // the show detail page (Viewer link button); we just write to its token here.
  useEffect(() => {
    if (!viewToken) return;
    const status: LiveViewPayload['status'] =
      countdown !== null ? 'countdown' : running ? 'running' : (showElapsed > 0 || idx > 0 ? 'paused' : 'idle');
    const payload: LiveViewPayload = {
      showName,
      status,
      countdown: countdown ?? undefined,
      segment: {
        name: onStageName,
        description: current?.description,
        photo: onStagePerformer?.photo,
        credits: onStagePerformer?.credits,
      },
      next: {
        name: nextName || undefined,
        description: next?.description,
        photo: nextPerformer?.photo,
      },
      totalSec,
      remainingAtLastUpdate: totalSec - elapsed,
      lastUpdateMs: Date.now(),
    };
    publishLiveView(viewToken, payload).catch(() => { /* swallow */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewToken, idx, running, countdown, totalSec, showName]);

  // On Run Show close, mark the live view ended so viewers see the final state.
  useEffect(() => () => {
    if (!viewToken) return;
    const payload: LiveViewPayload = {
      showName,
      status: 'ended',
      segment: {
        name: onStageName,
        description: current?.description,
        photo: onStagePerformer?.photo,
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

  function jumpTo(target: number) {
    goTo(target);
    setShowCues(false);
  }

  function resetCueTimer() {
    setElapsed(0);
  }

  function adjustTime(delta: number) {
    setAdjust((a) => ({ ...a, [idx]: (a[idx] ?? 0) + delta }));
  }

  function restartShow() {
    setRunning(false);
    setIdx(0);
    setElapsed(0);
    setShowElapsed(0);
    setAdjust({});
    setShowCues(false);
    setCountdown(null);
    startedIdxRef.current = null;
    fadeOutAudio();
  }

  // Unlock audio within the Start gesture so the deferred (post-countdown) play
  // isn't blocked by the browser's autoplay policy.
  function primeAudio() {
    const audio = audioRef.current;
    if (!audio) return;
    const v = audio.volume;
    audio.volume = 0;
    audio
      .play()
      .then(() => {
        audio.pause();
        audio.currentTime = 0;
        audio.volume = v;
      })
      .catch(() => {
        audio.volume = v;
      });
  }

  function playAudio() {
    fadeInAudio();
  }
  function stopAudio() {
    fadeOutAudio();
  }
  function restartAudio() {
    fadeInAudio();
  }
  function toggleMute() {
    setMuted((m) => !m);
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
      if (e.key === ' ') {
        e.preventDefault();
        setRunning((r) => !r);
      }
      if (e.key === 'ArrowRight') goNext();
      if (e.key === 'ArrowLeft') goPrev();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, elapsed, totalSec, isLast]);

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

  const started = running || showElapsed > 0 || idx > 0;
  const startLabel = running ? 'Pause' : started ? 'Resume' : 'Start';

  return (
    <div className="run-show" role="dialog" aria-modal="true" aria-label="Run show">
      <div className="run-show__bar">
        <span className="run-show__name">{showName}</span>
        <div className="run-show__bar-actions">
          <button className="run-show__restart" onClick={restartShow} title="Restart show from the top">
            Restart show
          </button>
          <button className="run-show__close" onClick={onClose} aria-label="Close run show">
            <Icon name="x" size={18} />
          </button>
        </div>
      </div>

      <div className="run-show__scroll">
        {/* Timer card */}
        <div className="rs-card rs-timer-card">
          <div
            className={`rs-timer ${isOver ? 'rs-timer--over' : ''} ${remaining <= WARNING_SECONDS ? 'rs-timer--warning' : ''}`}
          >
            {fmtCountdown(remaining)}
          </div>
          <div className="rs-showtime">Show Time: {fmtShowTime(showElapsed)}</div>
          <div className="rs-segment">
            {fmtOffset(offsets[idx])}–{fmtOffset(offsets[idx] + totalSec)}
            {current?.description ? ` | ${current.description}` : ''}
            {current?.performer ? ` · ${current.performer}` : ''}
          </div>
          <div className="rs-progress">
            <div
              className={`rs-progress__bar ${isOver ? 'rs-progress__bar--over' : ''}`}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>

        {/* On stage */}
        {onStageName && (
          <div className="rs-card rs-onstage">
            {onStagePerformer?.photo ? (
              <img src={onStagePerformer.photo} alt="" className="rs-onstage__photo" />
            ) : (
              <div className="rs-onstage__photo rs-onstage__photo--placeholder">
                {onStageName.charAt(0).toUpperCase()}
              </div>
            )}
            <div className="rs-onstage__info">
              <div className="rs-onstage__label">On stage</div>
              <div className="rs-onstage__name">{onStageName}</div>
              {onStagePerformer?.credits && (
                <div className="rs-onstage__credits">{onStagePerformer.credits}</div>
              )}
              {onStagePerformer?.socialMedia && (
                <div className="rs-onstage__social">{onStagePerformer.socialMedia}</div>
              )}
            </div>
          </div>
        )}

        {/* Stats */}
        <div className="rs-card rs-grid">
          <div className="rs-cell">
            <div className="rs-cell__label">Allocated Time</div>
            <div className="rs-cell__value">{Math.max(1, Math.round(totalSec / 60))} min</div>
          </div>
          <div className="rs-cell">
            <div className="rs-cell__label">Time Remaining</div>
            <div className={`rs-cell__value ${isOver ? 'rs-cell__value--over' : ''}`}>
              {fmtCountdown(remaining)}
            </div>
          </div>
          <div className="rs-cell">
            <div className="rs-cell__label">Schedule Status</div>
            <div
              className={`rs-cell__value rs-status rs-status--${status.toLowerCase().replace(' ', '-')}`}
            >
              {status}
            </div>
          </div>
          <div className="rs-cell">
            <div className="rs-cell__label">Position</div>
            <div className="rs-cell__value">
              {idx + 1} of {schedule.length}
            </div>
          </div>
          <div className="rs-cell rs-cell--wide">
            <div className="rs-cell__label">Next Up</div>
            <div className="rs-cell__value">
              {next ? nextUpLabel(next.description, effDurations[idx + 1]) : 'End of show'}
            </div>
          </div>
        </div>

        {/* Controls */}
        <div className="rs-card rs-controls">
          <div className="rs-controls__group">
            <div className="rs-controls__label">Timer Controls</div>
            <div className="rs-controls__row">
              <button className="rs-btn" onClick={goPrev} disabled={idx === 0}>
                Prev
              </button>
              <button
                className="rs-btn rs-btn--start"
                onClick={() => { primeAudio(); setRunning((r) => !r); }}
              >
                {startLabel}
              </button>
              <button className="rs-btn rs-btn--next" onClick={goNext} disabled={isLast}>
                Next
              </button>
            </div>
            <div className="rs-controls__row">
              <button className="rs-btn" onClick={() => adjustTime(-STEP_SECONDS)}>
                −2 Min
              </button>
              <button className="rs-btn" onClick={() => adjustTime(-FINE_STEP_SECONDS)}>
                −30s
              </button>
              <button className="rs-btn" onClick={() => adjustTime(FINE_STEP_SECONDS)}>
                +30s
              </button>
              <button className="rs-btn" onClick={() => adjustTime(STEP_SECONDS)}>
                +2 Min
              </button>
            </div>
            <div className="rs-controls__row">
              <button className="rs-btn" onClick={resetCueTimer}>
                Reset cue timer
              </button>
              <button
                className={`rs-btn ${showCues ? 'rs-btn--active' : ''}`}
                onClick={() => setShowCues((v) => !v)}
              >
                {showCues ? 'Hide cues' : 'Jump to cue'}
              </button>
            </div>
          </div>

          <div className="rs-controls__group">
            <div className="rs-controls__label">Audio Controls</div>
            <div className="rs-controls__row">
              <button className="rs-btn" onClick={playAudio} disabled={!hasAudio}>
                Play
              </button>
              <button className="rs-btn" onClick={stopAudio} disabled={!hasAudio}>
                Stop Audio
              </button>
              <button className="rs-btn" onClick={restartAudio} disabled={!hasAudio}>
                Restart
              </button>
              <button
                className={`rs-btn ${muted ? 'rs-btn--active' : ''}`}
                onClick={toggleMute}
                disabled={!hasAudio}
              >
                {muted ? 'Unmute' : 'Mute'}
              </button>
            </div>
            {hasAudio ? (
              <div className="rs-audio-now">
                {currentMusic?.name}
                {currentMusic?.duration ? ` · auto-plays ${currentMusic.duration}s` : ''}
              </div>
            ) : (
              <div className="rs-audio-now">No music set for this cue.</div>
            )}
          </div>
        </div>

        {/* Jump-to-cue list */}
        {showCues && (
          <div className="rs-card rs-cues">
            <div className="rs-cues__title">Jump to cue</div>
            <ul className="rs-cues__list">
              {schedule.map((cue, i) => (
                <li key={cue.id}>
                  <button
                    className={`rs-cue ${i === idx ? 'rs-cue--current' : ''}`}
                    onClick={() => jumpTo(i)}
                  >
                    <span className="rs-cue__num">{i + 1}</span>
                    <span className="rs-cue__range">
                      {fmtOffset(offsets[i])}–{fmtOffset(offsets[i] + effDurations[i])}
                    </span>
                    <span className="rs-cue__desc">{cue.description || 'Untitled cue'}</span>
                    {i === idx && <span className="rs-cue__badge">Now</span>}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {countdown !== null && countdown > 0 && (
        <div className="rs-countdown" onClick={skipCountdown} role="button" aria-label="Skip countdown">
          <div className="rs-countdown__num" key={countdown}>{countdown}</div>
          <div className="rs-countdown__label">
            Starting{current?.description ? `: ${current.description}` : ''}
            {currentMusic ? ' · music' : ''}
          </div>
          <div className="rs-countdown__hint">tap to skip</div>
        </div>
      )}

      {/* Single persistent element so it stays "unlocked" for autoplay across
          cues. src is controlled via loadedSrc, which only swaps after a fade-out. */}
      <audio
        ref={audioRef}
        src={loadedSrc}
        preload="auto"
        onTimeUpdate={handleTimeUpdate}
      />
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Performer, ScheduleItem } from '../types';
import { Icon } from './Icon';

interface RunShowProps {
  showName: string;
  schedule: ScheduleItem[];
  performers?: Performer[];
  onClose: () => void;
}

const DEFAULT_CUE_SECONDS = 5 * 60;
const MIN_CUE_SECONDS = 30;
const DRIFT_TOLERANCE = 30; // seconds we still count as "On Time"
const STEP_SECONDS = 2 * 60; // coarse +/- buttons
const FINE_STEP_SECONDS = 30; // fine +/- buttons

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

export function RunShow({ showName, schedule, performers = [], onClose }: RunShowProps) {
  const [idx, setIdx] = useState(0);
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0); // within current cue
  const [showElapsed, setShowElapsed] = useState(0); // whole show, real wall time
  const [adjust, setAdjust] = useState<Record<number, number>>({});
  const [muted, setMuted] = useState(false);
  const [showCues, setShowCues] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const autoPlayedIdxRef = useRef<number | null>(null);

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

  // Tick the clocks while running.
  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(() => {
      setElapsed((e) => e + 1);
      setShowElapsed((e) => e + 1);
    }, 1000);
    return () => window.clearInterval(t);
  }, [running]);

  // Stop/reset audio and re-arm auto-play whenever the cue changes.
  useEffect(() => {
    autoPlayedIdxRef.current = null;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
  }, [idx]);

  // Auto-play the segment's intro/transition music once, when the segment is
  // active and the show is running. Playback is capped by the cue's duration in
  // the timeupdate handler below, so this just starts it from the top.
  useEffect(() => {
    if (!running || !currentMusic || autoPlayedIdxRef.current === idx) return;
    const audio = audioRef.current;
    if (!audio) return;
    autoPlayedIdxRef.current = idx;
    audio.currentTime = 0;
    audio.muted = muted;
    audio.play().catch(() => {});
  }, [idx, running, currentMusic, muted]);

  // Enforce the per-cue play duration on ALL playback (auto-play and the manual
  // Play/Restart buttons): pause the moment we reach the set number of seconds.
  function handleTimeUpdate() {
    const audio = audioRef.current;
    const limit = currentMusic?.duration;
    if (audio && limit && limit > 0 && audio.currentTime >= limit) {
      audio.pause();
    }
  }

  // Keep the audio element's mute state in sync (incl. newly mounted cues).
  useEffect(() => {
    if (audioRef.current) audioRef.current.muted = muted;
  }, [muted, idx, hasAudio]);

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
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
  }

  function playAudio() {
    if (audioRef.current) {
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch(() => {});
    }
  }
  function stopAudio() {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
  }
  function restartAudio() {
    if (audioRef.current) {
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch(() => {});
    }
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
          <div className={`rs-timer ${isOver ? 'rs-timer--over' : ''}`}>{fmtCountdown(remaining)}</div>
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
              <button className="rs-btn rs-btn--start" onClick={() => setRunning((r) => !r)}>
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

      {hasAudio && (
        <audio ref={audioRef} src={currentMusic?.src} preload="auto" onTimeUpdate={handleTimeUpdate} />
      )}
    </div>
  );
}

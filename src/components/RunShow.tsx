import { useEffect, useMemo, useRef, useState } from 'react';
import type { DJSong, Performer, ScheduleItem } from '../types';
import { audioEngine } from '../utils/audioEngine';
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
import { Icon } from './Icon';

interface RunShowProps {
  showName: string;
  showId?: string;
  viewToken?: string;
  schedule: ScheduleItem[];
  performers?: Performer[];
  djSongs?: DJSong[];
  onStart?: () => void; // fired once when the show first starts (mark in-progress)
  onFinish?: () => void; // fired when the operator ends the show (mark completed)
  onClose: () => void;
}

const DRIFT_TOLERANCE = 30; // seconds we still count as "On Time"
const STEP_SECONDS = 2 * 60; // coarse +/- buttons
const FINE_STEP_SECONDS = 30; // fine +/- buttons
const WARNING_SECONDS = 60; // timer flashes red at/under this remaining

// Music comes up under the host's introduction, so it eases in. It comes down
// when the performer is already at the mic, so it gets out of the way fast.
const FADE_IN_MS = 1400;
const FADE_OUT_MS = 350;

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
  onToggle,
}: {
  track: SoundboardTrack;
  variant: 'face' | 'disc';
  isPlaying: boolean;
  onToggle: (track: SoundboardTrack) => void;
}) {
  return (
    <button
      type="button"
      className={`rs-pad rs-pad--${variant} ${isPlaying ? 'rs-pad--playing' : ''}`}
      onClick={() => onToggle(track)}
      aria-pressed={isPlaying}
      title={isPlaying ? `Stop ${track.label}` : `Play ${track.label}`}
    >
      <span className="rs-pad__face">
        <span className="rs-pad__initial">{track.initial}</span>
        <span className="rs-pad__state" aria-hidden="true">
          {isPlaying ? (
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
  onStart,
  onFinish,
  onClose,
}: RunShowProps) {
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
  const notifiedStartRef = useRef(false); // whether onStart has fired this session

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

  function restartShow() {
    if (!window.confirm('Restart the timer from the top of the show?')) return;
    setIdx(0);
    setElapsed(0);
    setShowElapsed(0);
    setAdjust({});
    audioEngine.init();
    setRunning(true);
    notifyStart();
  }

  function finishShow() {
    if (!window.confirm('End the show and mark it completed?')) return;
    audioEngine.stop({ fadeMs: FADE_OUT_MS });
    onFinish?.();
    onClose();
  }

  // ── Soundboard ───────────────────────────────────────────────────────────
  // Every track on the board is decoded up front. A walk-on that has to fetch
  // and decode on the press lands a half-second late, which on stage is the
  // difference between a cue and a mistake.
  useEffect(() => {
    audioEngine.init();
    let cancelled = false;
    (async () => {
      for (const src of soundboardSources(board)) {
        if (cancelled) return;
        await audioEngine.preload(src).catch(() => {});
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [board]);

  // Press to start (fades in), press again to stop (fades out fast). Pressing a
  // different button hands over: the outgoing track fades as the new one rises.
  function toggleTrack(track: SoundboardTrack) {
    if (playingKey === track.key) {
      audioEngine.stop({ fadeMs: FADE_OUT_MS });
      setPlayingKey(null);
      return;
    }
    setPlayingKey(track.key);
    audioEngine
      .play(track.src, {
        fadeInMs: FADE_IN_MS,
        fadeOutMs: FADE_OUT_MS,
        onEnded: () => setPlayingKey((k) => (k === track.key ? null : k)),
      })
      .then((ok) => {
        // A false here is either a track that wouldn't decode or a press that
        // has since been superseded — only clear if this one is still the
        // button lit up.
        if (!ok) setPlayingKey((k) => (k === track.key ? null : k));
      })
      .catch(() => setPlayingKey((k) => (k === track.key ? null : k)));
  }

  function stopAll() {
    audioEngine.stop({ fadeMs: FADE_OUT_MS });
    setPlayingKey(null);
  }

  function toggleMute() {
    setMuted((m) => !m);
  }

  // Keep mute state in sync with the engine.
  useEffect(() => {
    audioEngine.setMuted(muted);
  }, [muted]);

  // Stop on unmount.
  useEffect(() => () => audioEngine.stopNow(), []);

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
    };
    publishLiveView(viewToken, payload).catch(() => { /* swallow */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewToken, idx, running, totalSec, showName]);

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

  // Keyboard: the clock only. Space would otherwise re-fire whichever
  // soundboard button was last pressed — preventDefault keeps the press from
  // reaching it, so the spacebar always means "start / pause the timer".
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null;
      const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
      if (typing) return;
      if (e.key === 'Escape') onClose();
      if (e.key === ' ') {
        e.preventDefault();
        toggleRunning();
      }
      if (e.key === 'ArrowRight') goNext();
      if (e.key === 'ArrowLeft') goPrev();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, running, isLast]);

  const started = running || showElapsed > 0 || idx > 0;
  const startLabel = running ? 'Pause' : started ? 'Resume' : 'Start';
  const djWithoutAudio = djSongs.filter((s) => !s.music).length;
  const hasBoard = board.performers.length > 0 || board.cues.length > 0 || board.dj.length > 0;

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

          <div className="rs-board__now" aria-live="polite">
            {playingTrack ? (
              <>
                <span className="rs-board__now-dot" aria-hidden="true" />
                <span className="rs-board__now-text">
                  Playing: <strong>{playingTrack.label}</strong>
                  {playingTrack.sublabel ? ` · ${playingTrack.sublabel}` : ''}
                </span>
              </>
            ) : (
              <span className="rs-board__now-text">
                Nothing playing. Press a face to start their song, press it again to stop.
              </span>
            )}
          </div>

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
                    onToggle={toggleTrack}
                  />
                ))}
              </div>
            </div>
          )}

          {board.cues.length > 0 && (
            <div className="rs-bank">
              <div className="rs-bank__label">Show tracks</div>
              <div className="rs-bank__grid">
                {board.cues.map((t) => (
                  <TrackButton
                    key={t.key}
                    track={t}
                    variant="disc"
                    isPlaying={playingKey === t.key}
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
                    onToggle={toggleTrack}
                  />
                ))}
              </div>
            </div>
          )}

          {!hasBoard && (
            <p className="rs-board__empty">
              No audio uploaded yet. Add walk-on music to a performer, music to a cue, or upload
              tracks in the DJ section, and each one gets a button here.
            </p>
          )}
          {djWithoutAudio > 0 && (
            <p className="rs-board__note">
              {djWithoutAudio} DJ {djWithoutAudio === 1 ? 'song has' : 'songs have'} no audio
              uploaded — upload the file in the DJ section to get a button.
            </p>
          )}
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
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Performer, ScheduleItem } from '../types';
import { Icon } from './Icon';

interface LiveModeProps {
  showName: string;
  schedule: ScheduleItem[];
  performers?: Performer[];
  onClose: () => void;
}

const DEFAULT_CUE_SECONDS = 5 * 60;

function parseTimeToMinutes(time: string): number | null {
  if (!time) return null;
  const trimmed = time.trim();
  const match = trimmed.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (!match) return null;
  let hours = parseInt(match[1], 10);
  const mins = match[2] ? parseInt(match[2], 10) : 0;
  const meridiem = match[3]?.toLowerCase();
  if (meridiem === 'pm' && hours < 12) hours += 12;
  if (meridiem === 'am' && hours === 12) hours = 0;
  if (hours > 23 || mins > 59) return null;
  return hours * 60 + mins;
}

function durationsFromSchedule(schedule: ScheduleItem[]): number[] {
  const minutes = schedule.map((s) => parseTimeToMinutes(s.time));
  return schedule.map((_, idx) => {
    const cur = minutes[idx];
    const next = minutes[idx + 1];
    if (cur != null && next != null && next > cur) {
      return Math.max(60, (next - cur) * 60);
    }
    return DEFAULT_CUE_SECONDS;
  });
}

function formatRemaining(seconds: number): string {
  const sign = seconds < 0 ? '-' : '';
  const abs = Math.abs(Math.floor(seconds));
  const m = Math.floor(abs / 60);
  const s = abs % 60;
  return `${sign}${m}:${s.toString().padStart(2, '0')}`;
}

function formatClock(date: Date): string {
  return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' });
}

export function LiveMode({ showName, schedule, performers = [], onClose }: LiveModeProps) {
  const [idx, setIdx] = useState(0);
  const [running, setRunning] = useState(true);
  const [elapsed, setElapsed] = useState(0);
  const [now, setNow] = useState(() => new Date());
  const [showFull, setShowFull] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const durations = useMemo(() => durationsFromSchedule(schedule), [schedule]);
  const current = schedule[idx];

  // Find a performer whose name appears in the current/next cue description
  function matchPerformer(cue: ScheduleItem | undefined): Performer | null {
    if (!cue || !performers.length) return null;
    const desc = cue.description.toLowerCase();
    return performers.find(p => p.walkOnMusic && desc.includes(p.name.toLowerCase())) ?? null;
  }
  const currentPerformer = useMemo(() => matchPerformer(current), [current, performers]);
  const nextPerformer = useMemo(() => matchPerformer(schedule[idx + 1]), [idx, schedule, performers]);

  // Stop audio whenever the cue changes
  useEffect(() => {
    audioRef.current?.pause();
  }, [idx]);
  const totalSec = durations[idx] ?? DEFAULT_CUE_SECONDS;
  const remaining = totalSec - elapsed;
  const isOver = remaining < 0;
  const pct = Math.max(0, Math.min(100, (elapsed / totalSec) * 100));

  useEffect(() => {
    if (!running) return;
    const tick = window.setInterval(() => {
      setElapsed((e) => e + 1);
      setNow(new Date());
    }, 1000);
    return () => window.clearInterval(tick);
  }, [running]);

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
  }, [idx, schedule.length]);

  function goNext() {
    if (idx < schedule.length - 1) {
      setIdx(idx + 1);
      setElapsed(0);
    }
  }

  function goPrev() {
    if (idx > 0) {
      setIdx(idx - 1);
      setElapsed(0);
    }
  }

  function jumpTo(targetIdx: number) {
    setIdx(targetIdx);
    setElapsed(0);
  }

  if (schedule.length === 0) {
    return (
      <div className="live-screen">
        <div className="live-screen__top">
          <div className="row">
            <span className="live-pill">Live</span>
            <span style={{ fontSize: 13, fontWeight: 700 }}>{showName}</span>
          </div>
          <button
            className="icon-btn icon-btn--ghost"
            style={{
              color: 'rgba(255,255,255,0.7)',
              borderColor: 'rgba(255,255,255,0.1)',
              background: 'rgba(255,255,255,0.05)',
            }}
            onClick={onClose}
            aria-label="Close live mode"
          >
            <Icon name="x" size={18} />
          </button>
        </div>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center' }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>No cues yet</div>
            <p style={{ color: 'rgba(255,255,255,0.6)', marginTop: 8, fontSize: 14 }}>
              Add some schedule items first, then come back to run the show.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const upNext = showFull
    ? schedule.map((cue, i) => ({ cue, realIdx: i }))
    : schedule.slice(idx + 1, idx + 5).map((cue, i) => ({ cue, realIdx: idx + 1 + i }));

  const progressColor = isOver ? 'var(--primary)' : pct > 80 ? 'var(--primary)' : '#fff';

  return (
    <div className="live-screen" role="dialog" aria-modal="true" aria-label="Live show mode">
      <div className="live-screen__top">
        <div className="row">
          <span className="live-pill">Live</span>
          <span style={{ fontSize: 13, fontWeight: 700 }}>{showName}</span>
        </div>
        <div className="row">
          <span className="live-clock">{formatClock(now)}</span>
          <button
            className="icon-btn icon-btn--ghost"
            style={{
              color: 'rgba(255,255,255,0.7)',
              borderColor: 'rgba(255,255,255,0.1)',
              background: 'rgba(255,255,255,0.05)',
            }}
            onClick={onClose}
            aria-label="Close live mode"
          >
            <Icon name="x" size={18} />
          </button>
        </div>
      </div>

      <div className="live-screen__current">
        <p className="live-current__label">
          Now · cue {idx + 1} of {schedule.length}
        </p>
        <h2 className="live-current__title">{current?.description || 'Untitled cue'}</h2>
        {(current?.time || totalSec) && (
          <p className="live-current__sub">
            {current?.time && <span className="tag">{current.time}</span>}
            <span>{Math.round(totalSec / 60)} min planned</span>
          </p>
        )}

        <div className={`live-timer ${isOver ? 'live-timer--over' : ''}`}>{formatRemaining(remaining)}</div>
        <div className="live-timer__sub">{isOver ? 'Over by' : 'Remaining'}</div>

        <div className="live-progress">
          <div
            className="live-progress__bar"
            style={{ width: `${Math.min(100, pct)}%`, background: progressColor }}
          />
        </div>

        {/* Walk-on music for current cue's performer */}
        {currentPerformer && (
          <div className="live-walkon">
            <div className="live-walkon__header">
              {currentPerformer.photo && (
                <img src={currentPerformer.photo} alt="" className="live-walkon__photo" />
              )}
              <div className="live-walkon__info">
                <p className="live-walkon__label">Walk-on music</p>
                <p className="live-walkon__name">{currentPerformer.name}</p>
                {currentPerformer.walkOnMusicName && (
                  <p className="live-walkon__song">🎵 {currentPerformer.walkOnMusicName}{currentPerformer.walkOnMusicTimestamp ? ` @ ${currentPerformer.walkOnMusicTimestamp}` : ''}</p>
                )}
              </div>
            </div>
            <audio
              ref={audioRef}
              src={currentPerformer.walkOnMusic}
              controls
              preload="auto"
              className="live-walkon__audio"
            />
          </div>
        )}

        {/* Preview upcoming performer's music */}
        {nextPerformer && nextPerformer.id !== currentPerformer?.id && (
          <div className="live-walkon live-walkon--next">
            <p className="live-walkon__label">Up next · {nextPerformer.name}</p>
            {nextPerformer.walkOnMusicName && (
              <p className="live-walkon__song">🎵 {nextPerformer.walkOnMusicName}</p>
            )}
          </div>
        )}
      </div>

      <div className="live-controls">
        <button className="live-btn" onClick={goPrev} disabled={idx === 0}>
          <Icon name="back-skip" size={22} />
          Prev
        </button>
        <button className="live-btn live-btn--primary" onClick={() => setRunning((r) => !r)}>
          <Icon name={running ? 'pause' : 'play'} size={26} />
          {running ? 'Pause' : 'Resume'}
        </button>
        <button className="live-btn" onClick={goNext} disabled={idx === schedule.length - 1}>
          <Icon name="skip" size={22} />
          Next
        </button>
      </div>

      <div className="live-up-next">
        <div className="spread" style={{ marginTop: 4 }}>
          <p className="live-up-next__title" style={{ margin: 0 }}>
            {showFull ? 'Full run-of-show' : 'Up next'}
          </p>
          <button
            onClick={() => setShowFull((v) => !v)}
            style={{
              background: 'none',
              border: 0,
              color: 'rgba(255,255,255,0.6)',
              fontWeight: 700,
              fontSize: 11,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              cursor: 'pointer',
            }}
          >
            {showFull ? 'Up next' : 'Full list'}
          </button>
        </div>
        {upNext.length === 0 && (
          <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13, margin: '12px 0 0' }}>
            That's the last cue.
          </p>
        )}
        {upNext.map(({ cue, realIdx }) => {
          const isDone = realIdx < idx;
          const isNext = realIdx === idx + 1;
          return (
            <button
              key={cue.id}
              className={`live-cue ${isDone ? 'live-cue--done' : ''}`}
              onClick={() => !isDone && jumpTo(realIdx)}
              disabled={isDone}
            >
              <span className="live-cue__time">{cue.time || '—'}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="live-cue__title">{cue.description}</div>
                {isNext && <div className="live-cue__sub">Up next</div>}
              </div>
              {isNext && (
                <span className="live-pill" style={{ background: 'rgba(220,38,38,0.2)', color: '#fff' }}>
                  Next
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

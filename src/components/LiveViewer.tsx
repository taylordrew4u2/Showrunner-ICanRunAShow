import { useEffect, useRef, useState } from 'react';
import { fetchLiveView, type LiveViewPayload } from '../utils/liveView';

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

  // Poll the live view payload. Frequent so segment changes show up quickly.
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
    const id = window.setInterval(tick, 1500);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [token]);

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
  const warning = remaining <= 60;
  const showCountdown = payload.status === 'countdown' && payload.countdown && payload.countdown > 0;

  return (
    <div className="live-viewer">
      <div className="live-viewer__top">
        <span className="live-viewer__show">{payload.showName}</span>
        <span className={`live-viewer__status live-viewer__status--${payload.status}`}>{payload.status}</span>
      </div>

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
            {seg.photo ? (
              <img src={seg.photo} alt="" className="live-viewer__photo" />
            ) : (
              <div className="live-viewer__photo live-viewer__photo--placeholder">
                {(seg.name || '·').charAt(0).toUpperCase()}
              </div>
            )}
            <div className="live-viewer__info">
              <div className="live-viewer__name">{seg.name || seg.description || '—'}</div>
              {seg.credits && <div className="live-viewer__credits">{seg.credits}</div>}
            </div>
          </div>
        </div>

        <div className="live-viewer__card">
          <div className="live-viewer__label">Up next</div>
          <div className="live-viewer__person">
            {next.photo ? (
              <img src={next.photo} alt="" className="live-viewer__photo" />
            ) : (
              <div className="live-viewer__photo live-viewer__photo--placeholder">
                {(next.name || '—').charAt(0).toUpperCase()}
              </div>
            )}
            <div className="live-viewer__info">
              <div className="live-viewer__name">{next.name || next.description || 'End of show'}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

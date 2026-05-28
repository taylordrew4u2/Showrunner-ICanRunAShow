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

  // Compute remaining locally based on the host's last update.
  let remaining = payload.remainingAtLastUpdate;
  if (payload.status === 'running') {
    remaining = payload.remainingAtLastUpdate - (now - payload.lastUpdateMs) / 1000;
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
            {payload.segment.photo ? (
              <img src={payload.segment.photo} alt="" className="live-viewer__photo" />
            ) : (
              <div className="live-viewer__photo live-viewer__photo--placeholder">
                {(payload.segment.name || '·').charAt(0).toUpperCase()}
              </div>
            )}
            <div className="live-viewer__info">
              <div className="live-viewer__name">{payload.segment.name || payload.segment.description || '—'}</div>
              {payload.segment.credits && (
                <div className="live-viewer__credits">{payload.segment.credits}</div>
              )}
            </div>
          </div>
        </div>

        <div className="live-viewer__card">
          <div className="live-viewer__label">Up next</div>
          <div className="live-viewer__person">
            {payload.next.photo ? (
              <img src={payload.next.photo} alt="" className="live-viewer__photo" />
            ) : (
              <div className="live-viewer__photo live-viewer__photo--placeholder">
                {(payload.next.name || '—').charAt(0).toUpperCase()}
              </div>
            )}
            <div className="live-viewer__info">
              <div className="live-viewer__name">{payload.next.name || payload.next.description || 'End of show'}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

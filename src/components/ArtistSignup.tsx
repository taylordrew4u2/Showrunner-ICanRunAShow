import { useEffect, useMemo, useState } from 'react';
import {
  createSignup,
  fetchArtistPayload,
  listSignups,
  type ArtistSignupPayload,
  type ArtistSignupEntry,
  DEFAULT_BLACK_LABEL,
  DEFAULT_COLOR_LABEL,
} from '../utils/artistSignup';
import { fetchLiveView, type LiveViewPayload } from '../utils/liveView';
import { applyColorScheme } from '../utils/theme';
import { generateId } from '../utils/id';

interface ArtistSignupProps {
  token: string;
}

type View = 'home' | 'signup' | 'schedule';


function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function formatStartTime(iso: string | undefined): { dateLabel: string | null; timeLabel: string | null } {
  if (!iso) return { dateLabel: null, timeLabel: null };
  const d = new Date(iso.includes('T') ? iso : `${iso}T00:00`);
  if (Number.isNaN(d.getTime())) return { dateLabel: iso, timeLabel: null };
  const dateLabel = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const timeLabel = iso.includes('T')
    ? d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : null;
  return { dateLabel, timeLabel };
}

export function ArtistSignup({ token }: ArtistSignupProps) {
  const [payload, setPayload] = useState<ArtistSignupPayload | null>(null);
  const [live, setLive] = useState<LiveViewPayload | null>(null);
  const [signups, setSignups] = useState<ArtistSignupEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>('home');
  const [flashOpen, setFlashOpen] = useState(false);
  const [scheduleZoom, setScheduleZoom] = useState(false);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [imageNum, setImageNum] = useState('');
  const [color, setColor] = useState<'black' | 'color'>('black');
  const [submitting, setSubmitting] = useState(false);
  const [submittedEntry, setSubmittedEntry] = useState<ArtistSignupEntry | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  // Match the producer's color scheme (don't persist to the visitor's device).
  useEffect(() => {
    if (payload?.theme) applyColorScheme(payload.theme, false);
  }, [payload?.theme]);

  useEffect(() => {
    let alive = true;
    let initial = true;
    async function tick() {
      try {
        const [p, s] = await Promise.all([fetchArtistPayload(token), listSignups(token)]);
        if (!alive) return;
        setPayload(p);
        setSignups(s);
        setError(null);
        if (p?.liveToken) {
          const l = await fetchLiveView(p.liveToken);
          if (alive) setLive(l);
        } else if (alive) {
          setLive(null);
        }
      } catch {
        if (alive && initial) setError("Couldn't load the sign-up sheet.");
      } finally {
        initial = false;
      }
    }
    tick();
    const id = window.setInterval(tick, 4000);
    return () => { alive = false; window.clearInterval(id); };
  }, [token]);

  const queuePosition = useMemo(() => {
    if (!submittedEntry) return null;
    const waitingBefore = signups.filter(
      (s) => !s.completed && new Date(s.createdAt) < new Date(submittedEntry.createdAt),
    ).length;
    return waitingBefore + 1;
  }, [submittedEntry, signups]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setFormError('Add your name.'); return; }
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setFormError("A valid email is required so we can notify you when you're up.");
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      const entryId = generateId();
      await createSignup(token, {
        id: entryId,
        name: name.trim(),
        email: email.trim(),
        imageNumber: imageNum.trim() ? parseInt(imageNum, 10) : undefined,
        color,
      });
      const updated = await listSignups(token);
      setSignups(updated);
      const mine = updated.find((s) => s.id === entryId);
      setSubmittedEntry(mine ?? null);
      setName(''); setEmail(''); setImageNum(''); setColor('black');
      setTimeout(() => setSubmittedEntry(null), 8000);
    } catch {
      setFormError("Couldn't submit. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!payload && error) {
    return <div className="artist-signup"><div className="artist-signup__msg">{error}</div></div>;
  }
  if (!payload) {
    return <div className="artist-signup"><div className="artist-signup__msg">Loading…</div></div>;
  }

  const isLive = !!live && live.status !== 'ended' && live.status !== 'scheduled';
  const waitingCount = signups.filter((s) => !s.completed).length;
  const pay = payload.paymentLinks ?? {};
  const hasPayment = !!(pay.cashApp || pay.venmo || pay.zelle || pay.other);
  const blackLabel = payload.pricingLabels?.black || DEFAULT_BLACK_LABEL;
  const colorLabel = payload.pricingLabels?.color || DEFAULT_COLOR_LABEL;
  const startsAtIso = live?.startsAt || payload.startsAtIso;
  const { dateLabel, timeLabel } = formatStartTime(startsAtIso);

  return (
    <div className="artist-signup">
      {view === 'home' && (
        <>
          <header className="artist-signup__hero">
            <div className="artist-signup__hero-inner">
              {payload.venueName && <div className="artist-signup__hero-eyebrow">{payload.venueName}</div>}
              <h1 className="artist-signup__title">{payload.showName}</h1>
              <div className="artist-signup__hero-sub">Tattoo sign-up</div>
            </div>
          </header>

          {payload.welcomeMessage && (
            <section className="artist-signup__welcome">{payload.welcomeMessage}</section>
          )}

          {isLive && live ? (
            <section className="artist-signup__live-card">
              <div className="artist-signup__live-badge">
                <span className="artist-signup__live-dot" /> LIVE NOW
              </div>
              <div className="artist-signup__live-grid">
                <div className="artist-signup__live-block">
                  <div className="artist-signup__live-label">On stage</div>
                  <div className="artist-signup__live-row">
                    {live.segment?.photo ? (
                      <img className="artist-signup__live-photo" src={live.segment.photo} alt="" />
                    ) : (
                      <div className="artist-signup__live-photo artist-signup__live-photo--placeholder">
                        {getInitials(live.segment?.name || live.segment?.description || '?')}
                      </div>
                    )}
                    <div>
                      <div className="artist-signup__live-name">{live.segment?.name || live.segment?.description || '—'}</div>
                    </div>
                  </div>
                </div>
                <div className="artist-signup__live-block">
                  <div className="artist-signup__live-label">Up next</div>
                  <div className="artist-signup__live-row">
                    {live.next?.photo ? (
                      <img className="artist-signup__live-photo artist-signup__live-photo--sm" src={live.next.photo} alt="" />
                    ) : (
                      <div className="artist-signup__live-photo artist-signup__live-photo--sm artist-signup__live-photo--placeholder">
                        {getInitials(live.next?.name || live.next?.description || '?')}
                      </div>
                    )}
                    <div className="artist-signup__live-name artist-signup__live-name--sm">
                      {live.next?.name || live.next?.description || 'End of show'}
                    </div>
                  </div>
                </div>
              </div>
            </section>
          ) : (
            <section className="artist-signup__starts">
              <div className="artist-signup__starts-eyebrow">Show starts</div>
              {dateLabel && <div className="artist-signup__starts-date">{dateLabel}</div>}
              {timeLabel ? (
                <div className="artist-signup__starts-time">{timeLabel}</div>
              ) : !dateLabel && (
                <div className="artist-signup__starts-time">Time TBA</div>
              )}
            </section>
          )}

          <nav className="artist-signup__nav">
            <button
              type="button"
              className="artist-signup__nav-btn artist-signup__nav-btn--primary"
              onClick={() => setView('signup')}
            >
              <span className="artist-signup__nav-icon">✺</span>
              <span className="artist-signup__nav-body">
                <span className="artist-signup__nav-title">Sign up for a tattoo</span>
                <span className="artist-signup__nav-sub">
                  View the flash & get in line
                  {waitingCount > 0 && ` · ${waitingCount} waiting`}
                </span>
              </span>
              <span className="artist-signup__nav-chevron">›</span>
            </button>

            <button
              type="button"
              className="artist-signup__nav-btn"
              onClick={() => setView('schedule')}
              disabled={!payload.scheduleImage}
            >
              <span className="artist-signup__nav-icon">▦</span>
              <span className="artist-signup__nav-body">
                <span className="artist-signup__nav-title">Tonight's schedule</span>
                <span className="artist-signup__nav-sub">
                  {payload.scheduleImage ? 'See the full run-of-show' : 'Schedule not posted yet'}
                </span>
              </span>
              <span className="artist-signup__nav-chevron">›</span>
            </button>
          </nav>
        </>
      )}

      {view === 'signup' && (
        <>
          <header className="artist-signup__subhead">
            <button type="button" className="artist-signup__back" onClick={() => setView('home')}>
              ‹ Back
            </button>
            <h1 className="artist-signup__subtitle">Sign up</h1>
          </header>

          {payload.flashImage && (
            <section className="artist-signup__section">
              <h2 className="artist-signup__h2">Flash sheet</h2>
              <button type="button" className="artist-signup__flash-btn" onClick={() => setFlashOpen(true)} aria-label="View flash sheet larger">
                <img src={payload.flashImage} alt="Tattoo flash sheet" className="artist-signup__flash" />
                <span className="artist-signup__flash-zoom">Tap to zoom</span>
              </button>
              <p className="artist-signup__hint">
                Pick the number of the image you want.&nbsp;
                <strong>{blackLabel}</strong> · <strong>{colorLabel}</strong>
              </p>
            </section>
          )}

          <section className="artist-signup__section artist-signup__signup-section">
            <h2 className="artist-signup__h2">Your info</h2>
            {submittedEntry ? (
              <div className="artist-signup__success-card">
                <div className="artist-signup__success-headline">You're on the list!</div>
                {queuePosition != null && (
                  <div className="artist-signup__success-pos">
                    You're <strong>#{queuePosition}</strong> in line
                  </div>
                )}
                <div className="artist-signup__success-sub">
                  We'll email you when it's your turn. <strong>Check your spam folder</strong> so you don't miss it.
                </div>
                <button type="button" className="artist-signup__back-btn" onClick={() => setView('home')}>
                  Back to home
                </button>
              </div>
            ) : (
              <>
                {formError && <div className="artist-signup__error">{formError}</div>}
                <form className="artist-signup__form" onSubmit={handleSubmit}>
                  <label className="artist-signup__field artist-signup__field--full">
                    <span>Your name</span>
                    <input className="artist-signup__input" value={name} onChange={(e) => setName(e.target.value)} placeholder="First and last" autoComplete="name" />
                  </label>
                  <label className="artist-signup__field artist-signup__field--full">
                    <span>Email *</span>
                    <input className="artist-signup__input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" inputMode="email" />
                    <span className="artist-signup__field-hint">We'll email you when you're up — please check your spam folder.</span>
                  </label>
                  <label className="artist-signup__field">
                    <span>Image #</span>
                    <input className="artist-signup__input" type="number" min="1" value={imageNum} onChange={(e) => setImageNum(e.target.value)} placeholder="From flash" inputMode="numeric" />
                  </label>
                  <div className="artist-signup__field">
                    <span>Color</span>
                    <div className="artist-signup__seg" role="radiogroup" aria-label="Color choice">
                      <button
                        type="button"
                        role="radio"
                        aria-checked={color === 'black'}
                        className={`artist-signup__seg-btn ${color === 'black' ? 'artist-signup__seg-btn--active' : ''}`}
                        onClick={() => setColor('black')}
                      >
                        {blackLabel}
                      </button>
                      <button
                        type="button"
                        role="radio"
                        aria-checked={color === 'color'}
                        className={`artist-signup__seg-btn ${color === 'color' ? 'artist-signup__seg-btn--active' : ''}`}
                        onClick={() => setColor('color')}
                      >
                        {colorLabel}
                      </button>
                    </div>
                  </div>
                  <button className="artist-signup__submit" type="submit" disabled={submitting}>
                    {submitting ? 'Submitting…' : 'Sign me up'}
                  </button>
                </form>
                <p className="artist-signup__hint">
                  You'll pay when you sit down with the tattooer — Cash App, Venmo, or cash all work.
                </p>
              </>
            )}
          </section>

          <section className="artist-signup__section">
            <div className="artist-signup__list-head">
              <h2 className="artist-signup__h2">Who's signed up</h2>
              <span className="artist-signup__list-count">{waitingCount} waiting</span>
            </div>
            {signups.length === 0 ? (
              <p className="artist-signup__hint">Be the first to sign up.</p>
            ) : (
              <ol className="artist-signup__list">
                {signups.map((s, i) => {
                  const isMine = submittedEntry?.id === s.id;
                  return (
                    <li key={s.id} className={[
                      'artist-signup__entry',
                      s.completed ? 'artist-signup__entry--done' : '',
                      isMine ? 'artist-signup__entry--mine' : '',
                    ].filter(Boolean).join(' ')}>
                      <div className="artist-signup__entry-avatar">{getInitials(s.name)}</div>
                      <div className="artist-signup__entry-body">
                        <div className="artist-signup__entry-name">
                          {s.name}
                          {isMine && <span className="artist-signup__entry-you">you</span>}
                        </div>
                        <div className="artist-signup__entry-tags">
                          {s.imageNumber != null && <span className="artist-signup__entry-tag">#{s.imageNumber}</span>}
                          {s.color && <span className={`artist-signup__entry-tag artist-signup__entry-tag--${s.color}`}>
                            {s.color === 'black' ? 'Black' : 'Color'}
                          </span>}
                          {s.completed && <span className="artist-signup__entry-tag artist-signup__entry-tag--done">Paid</span>}
                        </div>
                      </div>
                      {!s.completed && <div className="artist-signup__entry-pos">#{i + 1}</div>}
                    </li>
                  );
                })}
              </ol>
            )}
          </section>

          {hasPayment && (
            <section className="artist-signup__section">
              <h2 className="artist-signup__h2">Pay the tattooer</h2>
              <div className="artist-signup__pay-row">
                {pay.cashApp && <a className="artist-signup__pay artist-signup__pay--cashapp" href={pay.cashApp} target="_blank" rel="noreferrer">Cash App</a>}
                {pay.venmo && <a className="artist-signup__pay artist-signup__pay--venmo" href={pay.venmo} target="_blank" rel="noreferrer">Venmo</a>}
                {pay.zelle && <a className="artist-signup__pay" href={pay.zelle} target="_blank" rel="noreferrer">Zelle</a>}
                {pay.other && <a className="artist-signup__pay" href={pay.other} target="_blank" rel="noreferrer">Other</a>}
              </div>
              <p className="artist-signup__hint">Cash also works — settle at the chair.</p>
            </section>
          )}
        </>
      )}

      {view === 'schedule' && (
        <>
          <header className="artist-signup__subhead">
            <button type="button" className="artist-signup__back" onClick={() => setView('home')}>
              ‹ Back
            </button>
            <h1 className="artist-signup__subtitle">Tonight's schedule</h1>
          </header>

          <section className="artist-signup__section">
            {payload.scheduleImage ? (
              <button type="button" className="artist-signup__flash-btn" onClick={() => setScheduleZoom(true)} aria-label="View schedule larger">
                <img src={payload.scheduleImage} alt="Tonight's schedule" className="artist-signup__flash" />
                <span className="artist-signup__flash-zoom">Tap to zoom</span>
              </button>
            ) : (
              <p className="artist-signup__hint">No schedule posted yet — check back soon.</p>
            )}
          </section>
        </>
      )}

      {flashOpen && payload.flashImage && (
        <div className="artist-signup__lightbox" onClick={() => setFlashOpen(false)} role="dialog" aria-modal="true">
          <img src={payload.flashImage} alt="Flash sheet" />
          <button className="artist-signup__lightbox-close" onClick={() => setFlashOpen(false)} aria-label="Close">×</button>
        </div>
      )}
      {scheduleZoom && payload.scheduleImage && (
        <div className="artist-signup__lightbox" onClick={() => setScheduleZoom(false)} role="dialog" aria-modal="true">
          <img src={payload.scheduleImage} alt="Schedule" />
          <button className="artist-signup__lightbox-close" onClick={() => setScheduleZoom(false)} aria-label="Close">×</button>
        </div>
      )}
    </div>
  );
}

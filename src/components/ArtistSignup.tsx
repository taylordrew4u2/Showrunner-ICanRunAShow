import { useEffect, useMemo, useState } from 'react';
import {
  createSignup,
  fetchArtistPayload,
  listSignups,
  type ArtistSignupPayload,
  type ArtistSignupEntry,
} from '../utils/artistSignup';
import { fetchLiveView, type LiveViewPayload } from '../utils/liveView';
import { generateId } from '../utils/id';

interface ArtistSignupProps {
  token: string;
}

const DEFAULT_BLACK_LABEL = 'Black — $60';
const DEFAULT_COLOR_LABEL = 'Full color — $80';

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function ArtistSignup({ token }: ArtistSignupProps) {
  const [payload, setPayload] = useState<ArtistSignupPayload | null>(null);
  const [live, setLive] = useState<LiveViewPayload | null>(null);
  const [signups, setSignups] = useState<ArtistSignupEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [flashOpen, setFlashOpen] = useState(false);

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [imageNum, setImageNum] = useState('');
  const [color, setColor] = useState<'black' | 'color'>('black');
  const [submitting, setSubmitting] = useState(false);
  const [submittedEntry, setSubmittedEntry] = useState<ArtistSignupEntry | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

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

  const sections = payload?.sections ?? {};
  const showLive = sections.live ?? true;
  const showFlash = sections.flash ?? true;
  const showSignups = sections.signups ?? true;
  const showPayment = sections.payment ?? true;

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
    if (payload?.phoneRequired && !phone.trim()) {
      setFormError('Phone is required so we can text you.');
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      const entryId = generateId();
      await createSignup(token, {
        id: entryId,
        name: name.trim(),
        phone: phone.trim() || undefined,
        imageNumber: imageNum.trim() ? parseInt(imageNum, 10) : undefined,
        color,
      });
      const updated = await listSignups(token);
      setSignups(updated);
      const mine = updated.find((s) => s.id === entryId);
      setSubmittedEntry(mine ?? null);
      setName(''); setPhone(''); setImageNum(''); setColor('black');
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

  return (
    <div className="artist-signup">
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

      {showLive && isLive && live && (
        <section className="artist-signup__live-card">
          <div className="artist-signup__live-badge">
            <span className="artist-signup__live-dot" /> LIVE
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
                  {live.segment?.credits && <div className="artist-signup__live-credits">{live.segment.credits}</div>}
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
      )}

      {payload.scheduleVisible && payload.schedule && payload.schedule.length > 0 && (
        <section className="artist-signup__section">
          <h2 className="artist-signup__h2">Tonight's schedule</h2>
          <ol className="artist-signup__timeline">
            {payload.schedule.map((s, i) => (
              <li key={i} className="artist-signup__timeline-item">
                <div className="artist-signup__timeline-dot" />
                <div className="artist-signup__timeline-body">
                  {s.time && <div className="artist-signup__timeline-time">{s.time}</div>}
                  <div className="artist-signup__timeline-desc">{s.description}</div>
                  {s.performer && <div className="artist-signup__timeline-perf">{s.performer}</div>}
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}

      {showFlash && payload.flashImage && (
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
        <h2 className="artist-signup__h2">Sign up</h2>
        {submittedEntry ? (
          <div className="artist-signup__success-card">
            <div className="artist-signup__success-headline">You're on the list!</div>
            {queuePosition != null && (
              <div className="artist-signup__success-pos">
                You're <strong>#{queuePosition}</strong> in line
              </div>
            )}
            <div className="artist-signup__success-sub">
              {submittedEntry.phone
                ? "We'll text you when it's your turn."
                : 'Hang nearby — we\'ll call your name when you\'re up.'}
            </div>
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
                <span>Phone {payload.phoneRequired ? '' : '(optional)'}</span>
                <input className="artist-signup__input" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="So we can text you when you're up" autoComplete="tel" inputMode="tel" />
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

      {showSignups && (
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
                        {s.completed && <span className="artist-signup__entry-tag artist-signup__entry-tag--done">Done</span>}
                      </div>
                    </div>
                    {!s.completed && <div className="artist-signup__entry-pos">#{i + 1}</div>}
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      )}

      {showPayment && hasPayment && (
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

      {flashOpen && payload.flashImage && (
        <div className="artist-signup__lightbox" onClick={() => setFlashOpen(false)} role="dialog" aria-modal="true">
          <img src={payload.flashImage} alt="Flash sheet" />
          <button className="artist-signup__lightbox-close" onClick={() => setFlashOpen(false)} aria-label="Close">×</button>
        </div>
      )}
    </div>
  );
}

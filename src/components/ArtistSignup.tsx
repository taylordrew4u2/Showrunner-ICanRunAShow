import { useEffect, useState } from 'react';
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

export function ArtistSignup({ token }: ArtistSignupProps) {
  const [payload, setPayload] = useState<ArtistSignupPayload | null>(null);
  const [live, setLive] = useState<LiveViewPayload | null>(null);
  const [signups, setSignups] = useState<ArtistSignupEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [imageNum, setImageNum] = useState('');
  const [color, setColor] = useState<'black' | 'color'>('black');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Poll payload + live + signups.
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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setFormError('Add your name.'); return; }
    setSubmitting(true);
    setFormError(null);
    try {
      await createSignup(token, {
        id: generateId(),
        name: name.trim(),
        phone: phone.trim() || undefined,
        imageNumber: imageNum.trim() ? parseInt(imageNum, 10) : undefined,
        color,
      });
      setSubmitted(true);
      setName(''); setPhone(''); setImageNum(''); setColor('black');
      const updated = await listSignups(token);
      setSignups(updated);
      setTimeout(() => setSubmitted(false), 2500);
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
  const completedCount = signups.filter((s) => s.completed).length;
  const pay = payload.paymentLinks ?? {};

  return (
    <div className="artist-signup">
      <header className="artist-signup__header">
        <h1 className="artist-signup__title">{payload.showName} — Tattoo sign-up</h1>
        {isLive && live && (
          <div className="artist-signup__live">
            <div>
              <span className="artist-signup__live-label">On stage:</span>{' '}
              <strong>{live.segment?.name || live.segment?.description || '—'}</strong>
            </div>
            <div>
              <span className="artist-signup__live-label">Up next:</span>{' '}
              <strong>{live.next?.name || live.next?.description || 'End of show'}</strong>
            </div>
          </div>
        )}
      </header>

      {payload.scheduleVisible && payload.schedule && payload.schedule.length > 0 && (
        <section className="artist-signup__section">
          <h2 className="artist-signup__h2">Tonight's schedule</h2>
          <ol className="artist-signup__schedule">
            {payload.schedule.map((s, i) => (
              <li key={i}>
                {s.time && <span className="artist-signup__time">{s.time}</span>}
                <span className="artist-signup__desc">{s.description}</span>
                {s.performer && <span className="artist-signup__perf">{s.performer}</span>}
              </li>
            ))}
          </ol>
        </section>
      )}

      {payload.flashImage && (
        <section className="artist-signup__section">
          <h2 className="artist-signup__h2">Flash sheet</h2>
          <img src={payload.flashImage} alt="Tattoo flash sheet" className="artist-signup__flash" />
          <p className="artist-signup__hint">
            Pick the number of the image you want. <strong>Black</strong> is <strong>$60</strong>;
            <strong> full color</strong> is <strong>$80</strong>.
          </p>
        </section>
      )}

      <section className="artist-signup__section">
        <h2 className="artist-signup__h2">Sign up</h2>
        {submitted && <div className="artist-signup__success">You're on the list — we'll text you when it's your turn.</div>}
        {formError && <div className="artist-signup__error">{formError}</div>}
        <form className="artist-signup__form" onSubmit={handleSubmit}>
          <label>
            <span>Name</span>
            <input className="artist-signup__input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
          </label>
          <label>
            <span>Phone</span>
            <input className="artist-signup__input" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="So we can text you when you're up" />
          </label>
          <label>
            <span>Image #</span>
            <input className="artist-signup__input" type="number" min="1" value={imageNum} onChange={(e) => setImageNum(e.target.value)} placeholder="From the flash sheet" />
          </label>
          <label>
            <span>Color</span>
            <select className="artist-signup__input" value={color} onChange={(e) => setColor(e.target.value as 'black' | 'color')}>
              <option value="black">Black — $60</option>
              <option value="color">Full color — $80</option>
            </select>
          </label>
          <button className="artist-signup__submit" type="submit" disabled={submitting}>
            {submitting ? 'Submitting…' : 'Sign me up'}
          </button>
        </form>
        <p className="artist-signup__hint">
          You'll pay when you sit down with the tattooer — Cash App, Venmo, or cash all work.
        </p>
      </section>

      <section className="artist-signup__section">
        <h2 className="artist-signup__h2">Sign-up list ({signups.length - completedCount} waiting)</h2>
        {signups.length === 0 ? (
          <p className="artist-signup__hint">Be the first to sign up.</p>
        ) : (
          <ol className="artist-signup__list">
            {signups.map((s) => (
              <li key={s.id} className={s.completed ? 'artist-signup__entry artist-signup__entry--done' : 'artist-signup__entry'}>
                <span className="artist-signup__entry-name">{s.name}</span>
                {s.imageNumber != null && <span className="artist-signup__entry-tag">#{s.imageNumber}</span>}
                {s.color && <span className="artist-signup__entry-tag">{s.color === 'black' ? 'Black' : 'Color'}</span>}
              </li>
            ))}
          </ol>
        )}
      </section>

      {(pay.cashApp || pay.venmo || pay.zelle || pay.other) && (
        <section className="artist-signup__section">
          <h2 className="artist-signup__h2">Pay the tattooer</h2>
          <div className="artist-signup__pay-row">
            {pay.cashApp && <a className="artist-signup__pay" href={pay.cashApp} target="_blank" rel="noreferrer">Cash App</a>}
            {pay.venmo && <a className="artist-signup__pay" href={pay.venmo} target="_blank" rel="noreferrer">Venmo</a>}
            {pay.zelle && <a className="artist-signup__pay" href={pay.zelle} target="_blank" rel="noreferrer">Zelle</a>}
            {pay.other && <a className="artist-signup__pay" href={pay.other} target="_blank" rel="noreferrer">Other</a>}
          </div>
          <p className="artist-signup__hint">Cash also works — settle at the chair.</p>
        </section>
      )}
    </div>
  );
}

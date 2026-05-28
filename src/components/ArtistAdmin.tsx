import { useEffect, useMemo, useState } from 'react';
import type { Show } from '../types';
import { generateId } from '../utils/id';
import { compressImage, pickFile } from '../utils/media';
import {
  publishArtistPayload,
  listSignups,
  setSignupCompleted,
  deleteSignup,
  type ArtistSignupPayload,
  type ArtistSignupEntry,
} from '../utils/artistSignup';

interface ArtistAdminProps {
  show: Show;
  onChange: (updates: Partial<Show>) => void;
  onClose: () => void;
}

interface Draft {
  scheduleVisible: boolean;
  flashImage: string;
  welcomeMessage: string;
  cashApp: string;
  venmo: string;
  zelle: string;
  other: string;
  blackLabel: string;
  colorLabel: string;
  showLive: boolean;
  showSignups: boolean;
  showFlash: boolean;
  showPayment: boolean;
  phoneRequired: boolean;
  notifyTemplate: string;
  hiddenCues: Set<string>;
}

const DEFAULT_BLACK_LABEL = 'Black — $60';
const DEFAULT_COLOR_LABEL = 'Full color — $80';
const DEFAULT_NOTIFY = "Hi {name}! You're up next — head over for your tattoo.";

function buildPayload(show: Show): ArtistSignupPayload {
  const hidden = new Set(show.artistHiddenCues ?? []);
  return {
    showName: show.name,
    venueName: show.venueName,
    scheduleVisible: show.artistScheduleVisible ?? true,
    schedule: show.schedule
      ?.filter((s) => !hidden.has(s.id))
      .map((s) => ({
        time: s.time || undefined,
        description: s.description,
        performer: s.performer || undefined,
      })),
    flashImage: show.artistFlashImage,
    paymentLinks: show.artistPaymentLinks,
    liveToken: show.viewToken,
    welcomeMessage: show.artistWelcomeMessage,
    pricingLabels: show.artistPricingLabels,
    sections: show.artistSections,
    phoneRequired: show.artistPhoneRequired,
    lastUpdateMs: Date.now(),
  };
}

function buildNotifyHref(phone: string | undefined, name: string, template: string): string | undefined {
  if (!phone) return undefined;
  const message = template.replace(/\{name\}/g, name).trim() || DEFAULT_NOTIFY.replace('{name}', name);
  const cleanPhone = phone.replace(/[^\d+]/g, '');
  // Modern cross-platform: ?body= works on iOS 12+ and Android. RFC 5724.
  return `sms:${cleanPhone}?body=${encodeURIComponent(message)}`;
}

export function ArtistAdmin({ show, onChange, onClose }: ArtistAdminProps) {
  const [signups, setSignups] = useState<ArtistSignupEntry[]>([]);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  const [draft, setDraft] = useState<Draft>({
    scheduleVisible: show.artistScheduleVisible ?? true,
    flashImage: show.artistFlashImage ?? '',
    welcomeMessage: show.artistWelcomeMessage ?? '',
    cashApp: show.artistPaymentLinks?.cashApp ?? '',
    venmo: show.artistPaymentLinks?.venmo ?? '',
    zelle: show.artistPaymentLinks?.zelle ?? '',
    other: show.artistPaymentLinks?.other ?? '',
    blackLabel: show.artistPricingLabels?.black ?? DEFAULT_BLACK_LABEL,
    colorLabel: show.artistPricingLabels?.color ?? DEFAULT_COLOR_LABEL,
    showLive: show.artistSections?.live ?? true,
    showSignups: show.artistSections?.signups ?? true,
    showFlash: show.artistSections?.flash ?? true,
    showPayment: show.artistSections?.payment ?? true,
    phoneRequired: show.artistPhoneRequired ?? false,
    notifyTemplate: show.artistNotifyTemplate ?? DEFAULT_NOTIFY,
    hiddenCues: new Set(show.artistHiddenCues ?? []),
  });

  const url = show.artistSignupToken
    ? `${window.location.origin}/?artist=${show.artistSignupToken}`
    : null;

  useEffect(() => {
    if (!show.artistSignupToken) return;
    let alive = true;
    async function tick() {
      try {
        const list = await listSignups(show.artistSignupToken!);
        if (alive) setSignups(list);
      } catch { /* ignore */ }
    }
    tick();
    const id = window.setInterval(tick, 4000);
    return () => { alive = false; window.clearInterval(id); };
  }, [show.artistSignupToken]);

  const nextPending = useMemo(() => signups.find((s) => !s.completed), [signups]);

  async function handleUploadFlash() {
    const file = await pickFile('image/*');
    if (!file) return;
    try {
      const data = await compressImage(file, { maxDim: 1800, quality: 0.85 });
      setDraft((d) => ({ ...d, flashImage: data }));
    } catch {
      alert("Couldn't read that image.");
    }
  }

  function toggleCue(id: string) {
    setDraft((d) => {
      const next = new Set(d.hiddenCues);
      if (next.has(id)) next.delete(id); else next.add(id);
      return { ...d, hiddenCues: next };
    });
  }

  async function handleSave() {
    setBusy(true);
    setSaved(false);
    let token = show.artistSignupToken;
    const paymentLinks = {
      cashApp: draft.cashApp.trim() || undefined,
      venmo: draft.venmo.trim() || undefined,
      zelle: draft.zelle.trim() || undefined,
      other: draft.other.trim() || undefined,
    };
    const pricingLabels = (draft.blackLabel.trim() !== DEFAULT_BLACK_LABEL || draft.colorLabel.trim() !== DEFAULT_COLOR_LABEL)
      ? { black: draft.blackLabel.trim() || undefined, color: draft.colorLabel.trim() || undefined }
      : undefined;
    const updates: Partial<Show> = {
      artistScheduleVisible: draft.scheduleVisible,
      artistFlashImage: draft.flashImage || undefined,
      artistPaymentLinks: paymentLinks,
      artistWelcomeMessage: draft.welcomeMessage.trim() || undefined,
      artistPricingLabels: pricingLabels,
      artistSections: {
        schedule: draft.scheduleVisible,
        flash: draft.showFlash,
        live: draft.showLive,
        signups: draft.showSignups,
        payment: draft.showPayment,
      },
      artistHiddenCues: Array.from(draft.hiddenCues),
      artistPhoneRequired: draft.phoneRequired,
      artistNotifyTemplate: draft.notifyTemplate.trim() === DEFAULT_NOTIFY ? undefined : draft.notifyTemplate.trim() || undefined,
    };
    if (!token) {
      token = generateId();
      updates.artistSignupToken = token;
    }
    onChange(updates);
    const merged: Show = { ...show, ...updates };
    try {
      await publishArtistPayload(token, buildPayload(merged));
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch { /* ignore */ }
    setBusy(false);
  }

  function handleCopy() {
    if (!url) return;
    navigator.clipboard?.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }).catch(() => {
      window.prompt('Copy this link:', url);
    });
  }

  async function handleToggleCompleted(entry: ArtistSignupEntry) {
    await setSignupCompleted(entry.id, !entry.completed);
    setSignups((prev) => prev.map((s) => (s.id === entry.id ? { ...s, completed: !s.completed } : s)));
  }

  async function handleDelete(id: string) {
    if (!window.confirm('Remove this sign-up?')) return;
    await deleteSignup(id);
    setSignups((prev) => prev.filter((s) => s.id !== id));
  }

  function handleNotifyNext() {
    if (!nextPending) return;
    const href = buildNotifyHref(nextPending.phone, nextPending.name, draft.notifyTemplate);
    if (!href) {
      alert(`${nextPending.name} doesn't have a phone number on file.`);
      return;
    }
    window.location.href = href;
  }

  const waitingCount = signups.filter((s) => !s.completed).length;
  const doneCount = signups.length - waitingCount;
  const cues = show.schedule ?? [];

  return (
    <div className="artist-page" role="dialog" aria-modal="true" aria-label="Artist admin">
      <header className="artist-page__bar">
        <button className="artist-page__back" onClick={onClose} aria-label="Back to show">
          <span className="artist-page__back-arrow">‹</span> Back to show
        </button>
        <h1 className="artist-page__title">Artist admin</h1>
        <div className="artist-page__bar-right">
          {saved && <span className="artist-page__saved">Saved ✓</span>}
          <button className="btn btn--primary btn--sm" onClick={handleSave} disabled={busy}>
            {busy ? 'Saving…' : show.artistSignupToken ? 'Save & publish' : 'Generate link'}
          </button>
        </div>
      </header>

      <div className="artist-page__scroll">
        <div className="artist-page__grid">
          <section className="artist-card artist-card--link artist-page__col-full">
            <h3 className="artist-card__title">Public sign-up link</h3>
            {url ? (
              <>
                <div className="viewer-link-modal__url-row">
                  <input className="section-field__input" readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
                  <button className="btn btn--secondary btn--sm" onClick={handleCopy}>{copied ? 'Copied!' : 'Copy'}</button>
                </div>
                <p className="artist-card__hint">Share this link with artists so they can sign up from their phone.</p>
              </>
            ) : (
              <p className="artist-card__hint">Click <strong>Save & publish</strong> above to generate the link.</p>
            )}
          </section>

          {nextPending && (
            <section className="artist-card artist-card--next artist-page__col-full">
              <div className="artist-card__next-info">
                <div className="artist-card__next-label">Next up</div>
                <div className="artist-card__next-name">{nextPending.name}</div>
                <div className="artist-card__next-tags">
                  {nextPending.imageNumber != null && <span className="artist-admin__entry-tag">#{nextPending.imageNumber}</span>}
                  {nextPending.color && <span className={`artist-admin__entry-tag artist-admin__entry-tag--${nextPending.color}`}>{nextPending.color === 'black' ? 'Black' : 'Color'}</span>}
                </div>
              </div>
              <button className="btn btn--primary" onClick={handleNotifyNext} disabled={!nextPending.phone}>
                {nextPending.phone ? 'Text them they\'re up' : 'No phone on file'}
              </button>
            </section>
          )}

          <section className="artist-card artist-page__col-full">
            <h3 className="artist-card__title">Welcome message</h3>
            <p className="artist-card__hint">Shown at the top of the public page.</p>
            <textarea
              className="section-field__input artist-admin__textarea"
              rows={3}
              placeholder="Tell artists how it works, what to expect, etc."
              value={draft.welcomeMessage}
              onChange={(e) => setDraft((d) => ({ ...d, welcomeMessage: e.target.value }))}
            />
          </section>

          <section className="artist-card">
            <h3 className="artist-card__title">What viewers see</h3>
            <div className="artist-admin__toggles">
              <label className="artist-admin__check">
                <input type="checkbox" checked={draft.showLive} onChange={(e) => setDraft((d) => ({ ...d, showLive: e.target.checked }))} />
                Live on-stage / up-next
              </label>
              <label className="artist-admin__check">
                <input type="checkbox" checked={draft.scheduleVisible} onChange={(e) => setDraft((d) => ({ ...d, scheduleVisible: e.target.checked }))} />
                Full schedule
              </label>
              <label className="artist-admin__check">
                <input type="checkbox" checked={draft.showFlash} onChange={(e) => setDraft((d) => ({ ...d, showFlash: e.target.checked }))} />
                Flash sheet
              </label>
              <label className="artist-admin__check">
                <input type="checkbox" checked={draft.showSignups} onChange={(e) => setDraft((d) => ({ ...d, showSignups: e.target.checked }))} />
                Sign-up list
              </label>
              <label className="artist-admin__check">
                <input type="checkbox" checked={draft.showPayment} onChange={(e) => setDraft((d) => ({ ...d, showPayment: e.target.checked }))} />
                Payment links
              </label>
              <label className="artist-admin__check">
                <input type="checkbox" checked={draft.phoneRequired} onChange={(e) => setDraft((d) => ({ ...d, phoneRequired: e.target.checked }))} />
                Require phone on sign-up
              </label>
            </div>
          </section>

          <section className="artist-card">
            <h3 className="artist-card__title">Pricing labels</h3>
            <p className="artist-card__hint">Override the default pricing the form shows.</p>
            <div className="artist-admin__pay-grid">
              <label><span>Black option</span>
                <input className="section-field__input" value={draft.blackLabel}
                  onChange={(e) => setDraft((d) => ({ ...d, blackLabel: e.target.value }))} placeholder={DEFAULT_BLACK_LABEL} />
              </label>
              <label><span>Color option</span>
                <input className="section-field__input" value={draft.colorLabel}
                  onChange={(e) => setDraft((d) => ({ ...d, colorLabel: e.target.value }))} placeholder={DEFAULT_COLOR_LABEL} />
              </label>
            </div>
          </section>

          {draft.scheduleVisible && cues.length > 0 && (
            <section className="artist-card artist-page__col-full">
              <h3 className="artist-card__title">Schedule items shown to public</h3>
              <p className="artist-card__hint">Uncheck any cues you want to hide from the public schedule.</p>
              <ul className="artist-admin__cues">
                {cues.map((c) => (
                  <li key={c.id}>
                    <label className="artist-admin__check">
                      <input
                        type="checkbox"
                        checked={!draft.hiddenCues.has(c.id)}
                        onChange={() => toggleCue(c.id)}
                      />
                      <span className="artist-admin__cue-time">{c.time || '—'}</span>
                      <span className="artist-admin__cue-desc">{c.description || '(no description)'}</span>
                      {c.performer && <span className="artist-admin__entry-tag">{c.performer}</span>}
                    </label>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="artist-card artist-page__col-full">
            <h3 className="artist-card__title">Flash sheet image</h3>
            {draft.flashImage ? (
              <div className="artist-admin__flash">
                <img src={draft.flashImage} alt="Flash sheet" />
                <div className="artist-admin__flash-actions">
                  <button className="btn btn--secondary btn--sm" onClick={handleUploadFlash}>Replace</button>
                  <button className="btn btn--ghost btn--sm" onClick={() => setDraft((d) => ({ ...d, flashImage: '' }))}>Remove</button>
                </div>
              </div>
            ) : (
              <button className="btn btn--secondary btn--sm" onClick={handleUploadFlash}>Upload flash sheet</button>
            )}
          </section>

          <section className="artist-card artist-page__col-full">
            <h3 className="artist-card__title">Payment links</h3>
            <div className="artist-admin__pay-grid">
              <label><span>Cash App</span>
                <input className="section-field__input" value={draft.cashApp} onChange={(e) => setDraft((d) => ({ ...d, cashApp: e.target.value }))} placeholder="https://cash.app/$handle" />
              </label>
              <label><span>Venmo</span>
                <input className="section-field__input" value={draft.venmo} onChange={(e) => setDraft((d) => ({ ...d, venmo: e.target.value }))} placeholder="https://venmo.com/u/handle" />
              </label>
              <label><span>Zelle / link</span>
                <input className="section-field__input" value={draft.zelle} onChange={(e) => setDraft((d) => ({ ...d, zelle: e.target.value }))} placeholder="https://… or info" />
              </label>
              <label><span>Other</span>
                <input className="section-field__input" value={draft.other} onChange={(e) => setDraft((d) => ({ ...d, other: e.target.value }))} placeholder="https://…" />
              </label>
            </div>
          </section>

          <section className="artist-card artist-page__col-full">
            <h3 className="artist-card__title">Notify text template</h3>
            <p className="artist-card__hint">Use <code>{'{name}'}</code> for the artist's name.</p>
            <textarea
              className="section-field__input artist-admin__textarea"
              rows={2}
              value={draft.notifyTemplate}
              onChange={(e) => setDraft((d) => ({ ...d, notifyTemplate: e.target.value }))}
              placeholder={DEFAULT_NOTIFY}
            />
          </section>

          <section className="artist-card artist-page__col-full">
            <div className="artist-admin__signup-head">
              <h3 className="artist-card__title" style={{ margin: 0 }}>Sign-ups</h3>
              <span className="artist-admin__signup-count">
                {waitingCount} waiting · {doneCount} done
              </span>
            </div>
            {signups.length === 0 ? (
              <p className="artist-card__hint">No sign-ups yet. Share the link to start collecting.</p>
            ) : (
              <ol className="artist-admin__signups">
                {signups.map((s, i) => {
                  const isNext = !s.completed && s.id === nextPending?.id;
                  return (
                    <li key={s.id} className={[
                      'artist-admin__entry',
                      s.completed ? 'artist-admin__entry--done' : '',
                      isNext ? 'artist-admin__entry--next' : '',
                    ].filter(Boolean).join(' ')}>
                      <div className="artist-admin__entry-main">
                        <span className="artist-admin__entry-pos">{i + 1}</span>
                        <span className="artist-admin__entry-name">{s.name}</span>
                        {s.imageNumber != null && <span className="artist-admin__entry-tag">#{s.imageNumber}</span>}
                        {s.color && <span className={`artist-admin__entry-tag artist-admin__entry-tag--${s.color}`}>
                          {s.color === 'black' ? 'Black' : 'Color'}
                        </span>}
                        {s.phone && (
                          <a className="artist-admin__entry-phone" href={`tel:${s.phone.replace(/[^\d+]/g, '')}`}>{s.phone}</a>
                        )}
                      </div>
                      <div className="artist-admin__entry-actions">
                        {s.phone && (
                          <a className="btn btn--secondary btn--sm" href={buildNotifyHref(s.phone, s.name, draft.notifyTemplate)}>Text ▸</a>
                        )}
                        <button className="btn btn--ghost btn--sm" onClick={() => handleToggleCompleted(s)}>
                          {s.completed ? 'Undo' : 'Mark done'}
                        </button>
                        <button className="btn btn--ghost btn--sm" onClick={() => handleDelete(s.id)} title="Remove">×</button>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>
        </div>
      </div>

      <footer className="artist-page__footer">
        <button className="btn btn--ghost" onClick={onClose}>Back to show</button>
        <button className="btn btn--primary" onClick={handleSave} disabled={busy}>
          {busy ? 'Saving…' : saved ? 'Saved ✓' : show.artistSignupToken ? 'Save & publish' : 'Generate link & publish'}
        </button>
      </footer>
    </div>
  );
}

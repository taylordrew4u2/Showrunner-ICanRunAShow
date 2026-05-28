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

type Tab = 'queue' | 'signups' | 'settings';

interface Draft {
  scheduleVisible: boolean;
  flashImage: string;
  scheduleImage: string;
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
  notifyTemplate: string;
  hiddenCues: Set<string>;
}

const DEFAULT_BLACK_LABEL = 'Black — $60';
const DEFAULT_COLOR_LABEL = 'Full color — $80';
const DEFAULT_NOTIFY = "Hi {name}! You're up — head over for your tattoo.";

function buildPayload(show: Show): ArtistSignupPayload {
  const hidden = new Set(show.artistHiddenCues ?? []);
  const startsAtIso = show.date && show.time ? `${show.date}T${show.time}` : show.date || undefined;
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
    scheduleImage: show.artistScheduleImage,
    startsAtIso,
    paymentLinks: show.artistPaymentLinks,
    liveToken: show.viewToken,
    welcomeMessage: show.artistWelcomeMessage,
    pricingLabels: show.artistPricingLabels,
    sections: show.artistSections,
    lastUpdateMs: Date.now(),
  };
}

function renderTemplate(template: string, name: string): string {
  return template.replace(/\{name\}/g, name).trim() || DEFAULT_NOTIFY.replace('{name}', name);
}

async function sendNotifyEmail(
  email: string,
  name: string,
  message: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch('/api/notify-artist', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, name, message, subject: "You're up!" }),
    });
    const data: { ok?: boolean; error?: string } = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      return { ok: false, error: data.error || `Server returned ${res.status}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Network error' };
  }
}

function telHref(phone: string | undefined): string | undefined {
  if (!phone) return undefined;
  return `tel:${phone.replace(/[^\d+]/g, '')}`;
}

type NotifyState = 'idle' | 'sending' | 'sent' | 'error';

export function ArtistAdmin({ show, onChange, onClose }: ArtistAdminProps) {
  const [tab, setTab] = useState<Tab>('queue');
  const [signups, setSignups] = useState<ArtistSignupEntry[]>([]);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [notifyById, setNotifyById] = useState<Record<string, NotifyState>>({});
  const [notifyError, setNotifyError] = useState<string | null>(null);

  async function notifyEntry(entry: ArtistSignupEntry) {
    if (!entry.email) {
      setNotifyError(`${entry.name} didn't leave an email on sign-up — can't notify.`);
      return;
    }
    setNotifyError(null);
    setNotifyById((m) => ({ ...m, [entry.id]: 'sending' }));
    const message = renderTemplate(draft.notifyTemplate, entry.name);
    const result = await sendNotifyEmail(entry.email, entry.name, message);
    if (result.ok) {
      setNotifyById((m) => ({ ...m, [entry.id]: 'sent' }));
      setTimeout(() => {
        setNotifyById((m) => {
          const { [entry.id]: _drop, ...rest } = m;
          void _drop;
          return rest;
        });
      }, 2500);
    } else {
      setNotifyById((m) => ({ ...m, [entry.id]: 'error' }));
      setNotifyError(result.error || "Couldn't send the email. Check Brevo setup.");
    }
  }

  function notifyButtonLabel(id: string, fallback: string): string {
    const s = notifyById[id];
    if (s === 'sending') return 'Sending…';
    if (s === 'sent') return 'Sent ✓';
    if (s === 'error') return 'Try again';
    return fallback;
  }

  const [draft, setDraft] = useState<Draft>({
    scheduleVisible: show.artistScheduleVisible ?? true,
    flashImage: show.artistFlashImage ?? '',
    scheduleImage: show.artistScheduleImage ?? '',
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
    const id = window.setInterval(tick, 3000);
    return () => { alive = false; window.clearInterval(id); };
  }, [show.artistSignupToken]);

  const pending = useMemo(() => signups.filter((s) => !s.completed), [signups]);
  const paid = useMemo(() => signups.filter((s) => s.completed), [signups]);
  const nextUp = pending[0];
  const onDeck = pending.slice(1, 4);
  const cues = show.schedule ?? [];

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

  async function handleUploadScheduleImage() {
    const file = await pickFile('image/*');
    if (!file) return;
    try {
      const data = await compressImage(file, { maxDim: 1800, quality: 0.85 });
      setDraft((d) => ({ ...d, scheduleImage: data }));
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
      artistScheduleImage: draft.scheduleImage || undefined,
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

  async function handleMarkPaid(entry: ArtistSignupEntry) {
    await setSignupCompleted(entry.id, !entry.completed);
    setSignups((prev) => prev.map((s) => (s.id === entry.id ? { ...s, completed: !s.completed } : s)));
  }

  async function handleDelete(id: string) {
    if (!window.confirm('Remove this sign-up?')) return;
    await deleteSignup(id);
    setSignups((prev) => prev.filter((s) => s.id !== id));
  }

  function renderQueueTab() {
    if (!show.artistSignupToken) {
      return (
        <div className="artist-card artist-page__col-full">
          <h3 className="artist-card__title">No sign-up link yet</h3>
          <p className="artist-card__hint">Go to <strong>Settings</strong> and tap <strong>Save & publish</strong> to generate your public sign-up link.</p>
        </div>
      );
    }
    return (
      <>
        <div className="artist-queue__counts">
          <div className="artist-queue__count">
            <div className="artist-queue__count-num">{pending.length}</div>
            <div className="artist-queue__count-label">Waiting</div>
          </div>
          <div className="artist-queue__count">
            <div className="artist-queue__count-num">{paid.length}</div>
            <div className="artist-queue__count-label">Paid</div>
          </div>
          <div className="artist-queue__count">
            <div className="artist-queue__count-num">{signups.length}</div>
            <div className="artist-queue__count-label">Total</div>
          </div>
        </div>

        {nextUp ? (
          <section className="artist-queue__next">
            <div className="artist-queue__next-head">
              <span className="artist-queue__next-eyebrow">UP NEXT</span>
              <span className="artist-queue__next-pos">#1</span>
            </div>
            <div className="artist-queue__next-name">{nextUp.name}</div>
            <div className="artist-queue__next-tags">
              {nextUp.imageNumber != null && <span className="artist-admin__entry-tag">Image #{nextUp.imageNumber}</span>}
              {nextUp.color && <span className={`artist-admin__entry-tag artist-admin__entry-tag--${nextUp.color}`}>
                {nextUp.color === 'black' ? 'Black' : 'Color'}
              </span>}
            </div>
            {nextUp.phone && (
              <div className="artist-queue__next-phone">
                <a href={telHref(nextUp.phone)}>{nextUp.phone}</a>
              </div>
            )}
            {nextUp.email && (
              <div className="artist-queue__next-phone">
                <a href={`mailto:${nextUp.email}`}>{nextUp.email}</a>
              </div>
            )}
            <div className="artist-queue__next-actions">
              <button
                className="btn btn--primary artist-queue__next-btn"
                onClick={() => notifyEntry(nextUp)}
                disabled={!nextUp.email || notifyById[nextUp.id] === 'sending'}
                title={nextUp.email ? 'Send "you\'re up" email' : 'No email on file'}
              >
                {nextUp.email
                  ? notifyButtonLabel(nextUp.id, 'Email "you\'re up"')
                  : 'No email'}
              </button>
              <a
                className="btn btn--secondary artist-queue__next-btn"
                href={telHref(nextUp.phone)}
                aria-disabled={!nextUp.phone}
                style={!nextUp.phone ? { opacity: 0.5, pointerEvents: 'none' } : undefined}
              >
                Call
              </a>
              <button
                className="btn btn--success artist-queue__next-btn artist-queue__paid-btn"
                onClick={() => handleMarkPaid(nextUp)}
              >
                ✓ Mark paid
              </button>
            </div>
            {notifyError && <p className="artist-queue__notify-error">{notifyError}</p>}
          </section>
        ) : (
          <div className="artist-card artist-page__col-full artist-queue__empty">
            <div className="artist-queue__empty-icon">🤘</div>
            <div className="artist-queue__empty-title">Queue is clear</div>
            <div className="artist-queue__empty-sub">Nobody waiting right now.</div>
          </div>
        )}

        {onDeck.length > 0 && (
          <section className="artist-card artist-page__col-full">
            <h3 className="artist-card__title">On deck</h3>
            <ol className="artist-queue__deck">
              {onDeck.map((s, i) => (
                <li key={s.id} className="artist-queue__deck-item">
                  <span className="artist-queue__deck-pos">#{i + 2}</span>
                  <div className="artist-queue__deck-body">
                    <div className="artist-queue__deck-name">{s.name}</div>
                    <div className="artist-queue__deck-tags">
                      {s.imageNumber != null && <span className="artist-admin__entry-tag">#{s.imageNumber}</span>}
                      {s.color && <span className={`artist-admin__entry-tag artist-admin__entry-tag--${s.color}`}>
                        {s.color === 'black' ? 'Black' : 'Color'}
                      </span>}
                    </div>
                  </div>
                  <button
                    className="btn btn--success btn--sm"
                    onClick={() => handleMarkPaid(s)}
                  >
                    Paid
                  </button>
                </li>
              ))}
            </ol>
          </section>
        )}

        <section className="artist-card artist-page__col-full">
          <h3 className="artist-card__title">Public sign-up link</h3>
          <div className="viewer-link-modal__url-row">
            <input className="section-field__input" readOnly value={url ?? ''} onFocus={(e) => e.currentTarget.select()} />
            <button className="btn btn--secondary btn--sm" onClick={handleCopy}>{copied ? 'Copied!' : 'Copy'}</button>
          </div>
        </section>
      </>
    );
  }

  function renderSignupsTab() {
    return (
      <section className="artist-card artist-page__col-full">
        <div className="artist-admin__signup-head">
          <h3 className="artist-card__title" style={{ margin: 0 }}>All sign-ups</h3>
          <span className="artist-admin__signup-count">
            {pending.length} waiting · {paid.length} paid
          </span>
        </div>
        {signups.length === 0 ? (
          <p className="artist-card__hint">No sign-ups yet. Share the link to start collecting.</p>
        ) : (
          <ol className="artist-admin__signups">
            {signups.map((s, i) => (
              <li key={s.id} className={[
                'artist-admin__entry',
                s.completed ? 'artist-admin__entry--done' : '',
                !s.completed && s.id === nextUp?.id ? 'artist-admin__entry--next' : '',
              ].filter(Boolean).join(' ')}>
                <div className="artist-admin__entry-main">
                  <span className="artist-admin__entry-pos">{i + 1}</span>
                  <span className="artist-admin__entry-name">{s.name}</span>
                  {s.imageNumber != null && <span className="artist-admin__entry-tag">#{s.imageNumber}</span>}
                  {s.color && <span className={`artist-admin__entry-tag artist-admin__entry-tag--${s.color}`}>
                    {s.color === 'black' ? 'Black' : 'Color'}
                  </span>}
                  {s.email && (
                    <a className="artist-admin__entry-phone" href={`mailto:${s.email}`} title={s.email}>{s.email}</a>
                  )}
                  {s.phone && (
                    <a className="artist-admin__entry-phone" href={telHref(s.phone)}>{s.phone}</a>
                  )}
                </div>
                <div className="artist-admin__entry-actions">
                  <button
                    className="btn btn--secondary btn--sm"
                    onClick={() => notifyEntry(s)}
                    disabled={!s.email || notifyById[s.id] === 'sending'}
                    title={s.email ? 'Send "you\'re up" email' : 'No email on file'}
                  >
                    {s.email ? notifyButtonLabel(s.id, 'Email ▸') : 'No email'}
                  </button>
                  <button
                    className={s.completed ? 'btn btn--ghost btn--sm' : 'btn btn--success btn--sm'}
                    onClick={() => handleMarkPaid(s)}
                  >
                    {s.completed ? 'Mark unpaid' : '✓ Paid'}
                  </button>
                  <button className="btn btn--ghost btn--sm" onClick={() => handleDelete(s.id)} title="Remove">×</button>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>
    );
  }

  function renderSettingsTab() {
    return (
      <>
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

        <section className="artist-card artist-page__col-full">
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
          <h3 className="artist-card__title">Tonight's schedule image</h3>
          <p className="artist-card__hint">Shown when artists tap "Tonight's schedule" on the public page. Upload your show run as an image.</p>
          {draft.scheduleImage ? (
            <div className="artist-admin__flash">
              <img src={draft.scheduleImage} alt="Tonight's schedule" />
              <div className="artist-admin__flash-actions">
                <button className="btn btn--secondary btn--sm" onClick={handleUploadScheduleImage}>Replace</button>
                <button className="btn btn--ghost btn--sm" onClick={() => setDraft((d) => ({ ...d, scheduleImage: '' }))}>Remove</button>
              </div>
            </div>
          ) : (
            <button className="btn btn--secondary btn--sm" onClick={handleUploadScheduleImage}>Upload schedule image</button>
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
          <h3 className="artist-card__title">Notification email template</h3>
          <p className="artist-card__hint">Use <code>{'{name}'}</code> for the artist's name.</p>
          <textarea
            className="section-field__input artist-admin__textarea"
            rows={2}
            value={draft.notifyTemplate}
            onChange={(e) => setDraft((d) => ({ ...d, notifyTemplate: e.target.value }))}
            placeholder={DEFAULT_NOTIFY}
          />
        </section>
      </>
    );
  }

  return (
    <div className="artist-page" role="dialog" aria-modal="true" aria-label="Artist admin">
      <header className="artist-page__bar">
        <button className="artist-page__back" onClick={onClose} aria-label="Back to show">
          <span className="artist-page__back-arrow">‹</span> Back to show
        </button>
        <h1 className="artist-page__title">Artist admin</h1>
        <div className="artist-page__bar-right">
          {saved && <span className="artist-page__saved">Saved ✓</span>}
          {tab === 'settings' && (
            <button className="btn btn--primary btn--sm" onClick={handleSave} disabled={busy}>
              {busy ? 'Saving…' : show.artistSignupToken ? 'Save' : 'Generate link'}
            </button>
          )}
        </div>
      </header>

      <nav className="artist-page__tabs" role="tablist">
        <button
          className={`artist-page__tab ${tab === 'queue' ? 'artist-page__tab--active' : ''}`}
          onClick={() => setTab('queue')}
          role="tab"
          aria-selected={tab === 'queue'}
        >
          Queue {pending.length > 0 && <span className="artist-page__tab-badge">{pending.length}</span>}
        </button>
        <button
          className={`artist-page__tab ${tab === 'signups' ? 'artist-page__tab--active' : ''}`}
          onClick={() => setTab('signups')}
          role="tab"
          aria-selected={tab === 'signups'}
        >
          Sign-ups {signups.length > 0 && <span className="artist-page__tab-badge">{signups.length}</span>}
        </button>
        <button
          className={`artist-page__tab ${tab === 'settings' ? 'artist-page__tab--active' : ''}`}
          onClick={() => setTab('settings')}
          role="tab"
          aria-selected={tab === 'settings'}
        >
          Settings
        </button>
      </nav>

      <div className="artist-page__scroll">
        <div className="artist-page__grid">
          {tab === 'queue' && renderQueueTab()}
          {tab === 'signups' && renderSignupsTab()}
          {tab === 'settings' && renderSettingsTab()}
        </div>
      </div>

      {tab === 'settings' && (
        <footer className="artist-page__footer">
          <button className="btn btn--ghost" onClick={onClose}>Back to show</button>
          <button className="btn btn--primary" onClick={handleSave} disabled={busy}>
            {busy ? 'Saving…' : saved ? 'Saved ✓' : show.artistSignupToken ? 'Save & publish' : 'Generate link & publish'}
          </button>
        </footer>
      )}
    </div>
  );
}

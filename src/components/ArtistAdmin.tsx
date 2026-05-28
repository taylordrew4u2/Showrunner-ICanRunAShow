import { useEffect, useState } from 'react';
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

function buildPayload(show: Show): ArtistSignupPayload {
  return {
    showName: show.name,
    scheduleVisible: show.artistScheduleVisible ?? true,
    schedule: show.schedule?.map((s) => ({
      time: s.time || undefined,
      description: s.description,
      performer: s.performer || undefined,
    })),
    flashImage: show.artistFlashImage,
    paymentLinks: show.artistPaymentLinks,
    liveToken: show.viewToken,
    lastUpdateMs: Date.now(),
  };
}

export function ArtistAdmin({ show, onChange, onClose }: ArtistAdminProps) {
  const [signups, setSignups] = useState<ArtistSignupEntry[]>([]);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState({
    scheduleVisible: show.artistScheduleVisible ?? true,
    flashImage: show.artistFlashImage ?? '',
    cashApp: show.artistPaymentLinks?.cashApp ?? '',
    venmo: show.artistPaymentLinks?.venmo ?? '',
    zelle: show.artistPaymentLinks?.zelle ?? '',
    other: show.artistPaymentLinks?.other ?? '',
  });

  const url = show.artistSignupToken
    ? `${window.location.origin}/?artist=${show.artistSignupToken}`
    : null;

  // Poll signups while the modal is open.
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

  async function handleSave() {
    setBusy(true);
    let token = show.artistSignupToken;
    const paymentLinks = {
      cashApp: draft.cashApp.trim() || undefined,
      venmo: draft.venmo.trim() || undefined,
      zelle: draft.zelle.trim() || undefined,
      other: draft.other.trim() || undefined,
    };
    const updates: Partial<Show> = {
      artistScheduleVisible: draft.scheduleVisible,
      artistFlashImage: draft.flashImage || undefined,
      artistPaymentLinks: paymentLinks,
    };
    if (!token) {
      token = generateId();
      updates.artistSignupToken = token;
    }
    onChange(updates);
    const merged: Show = { ...show, ...updates };
    try {
      await publishArtistPayload(token, buildPayload(merged));
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

  function notifyHref(phone: string | undefined, name: string): string | undefined {
    if (!phone) return undefined;
    const body = encodeURIComponent(`Hi ${name}! You're up — head over for your tattoo.`);
    return `sms:${phone}?&body=${body}`;
  }

  return (
    <div className="artist-admin-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div className="artist-admin" onClick={(e) => e.stopPropagation()}>
        <header className="artist-admin__header">
          <h2 className="artist-admin__title">Artist admin</h2>
          <button className="artist-admin__close" onClick={onClose} aria-label="Close">×</button>
        </header>

        <div className="artist-admin__body">
          <section className="artist-admin__sec">
            <h3 className="artist-admin__h3">Public sign-up link</h3>
            {url ? (
              <div className="viewer-link-modal__url-row">
                <input className="section-field__input" readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
                <button className="btn btn--secondary btn--sm" onClick={handleCopy}>{copied ? 'Copied!' : 'Copy'}</button>
              </div>
            ) : (
              <p className="artist-admin__hint">Click <strong>Save & publish</strong> below to generate the link.</p>
            )}
          </section>

          <section className="artist-admin__sec">
            <label className="artist-admin__check">
              <input
                type="checkbox"
                checked={draft.scheduleVisible}
                onChange={(e) => setDraft((d) => ({ ...d, scheduleVisible: e.target.checked }))}
              />
              Show the full schedule on the public page
            </label>
          </section>

          <section className="artist-admin__sec">
            <h3 className="artist-admin__h3">Flash sheet image</h3>
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

          <section className="artist-admin__sec">
            <h3 className="artist-admin__h3">Payment links</h3>
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

          <section className="artist-admin__sec">
            <h3 className="artist-admin__h3">Sign-ups ({signups.length})</h3>
            {signups.length === 0 ? (
              <p className="artist-admin__hint">No sign-ups yet.</p>
            ) : (
              <ol className="artist-admin__signups">
                {signups.map((s) => (
                  <li key={s.id} className={s.completed ? 'artist-admin__entry artist-admin__entry--done' : 'artist-admin__entry'}>
                    <div className="artist-admin__entry-main">
                      <span className="artist-admin__entry-name">{s.name}</span>
                      {s.imageNumber != null && <span className="artist-admin__entry-tag">#{s.imageNumber}</span>}
                      {s.color && <span className="artist-admin__entry-tag">{s.color === 'black' ? 'Black $60' : 'Color $80'}</span>}
                      {s.phone && (
                        <a className="artist-admin__entry-phone" href={`tel:${s.phone}`}>{s.phone}</a>
                      )}
                    </div>
                    <div className="artist-admin__entry-actions">
                      {s.phone && (
                        <a className="btn btn--secondary btn--sm" href={notifyHref(s.phone, s.name)}>Notify ▸</a>
                      )}
                      <button className="btn btn--ghost btn--sm" onClick={() => handleToggleCompleted(s)}>
                        {s.completed ? 'Undo' : 'Mark done'}
                      </button>
                      <button className="btn btn--ghost btn--sm" onClick={() => handleDelete(s.id)} title="Remove">×</button>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>

        <footer className="artist-admin__footer">
          <button className="btn btn--primary" onClick={handleSave} disabled={busy}>
            {busy ? 'Saving…' : show.artistSignupToken ? 'Save & publish' : 'Generate link & publish'}
          </button>
          <button className="btn btn--ghost" onClick={onClose}>Close</button>
        </footer>
      </div>
    </div>
  );
}

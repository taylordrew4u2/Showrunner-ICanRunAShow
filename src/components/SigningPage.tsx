import { useEffect, useState } from 'react';
import type { ApiError } from '../utils/api';
import { downscaleImage, FLYER_MAX_DIM } from '../utils/imageResize';
import type { SignatureRecord } from '../types';
import {
  collectFieldAnswers,
  fetchSigningDocument,
  fetchSigningRequest,
  missingRequiredFields,
  shortHash,
  signedFileName,
  submitSignature,
  type SigningPayload,
} from '../utils/contracts';
import { renderPdfPages, type RenderedPage } from '../utils/pdfPages';
import './SigningPage.css';

interface SigningPageProps {
  token: string;
  signKey: string | null;
}

type Phase = 'loading' | 'ready' | 'signing' | 'done' | 'missing' | 'nokey';

/**
 * The page a performer opens from a signing link.
 *
 * They have no account and will never make one, so everything here comes from
 * the link itself: the token addresses the row, and the key in the fragment
 * decrypts it. Nothing on this screen asks them to sign up, install anything,
 * or understand what a producer is — they read the document, type their name,
 * and are done.
 */
export function SigningPage({ token, signKey }: SigningPageProps) {
  const [phase, setPhase] = useState<Phase>(signKey ? 'loading' : 'nokey');
  const [payload, setPayload] = useState<SigningPayload | null>(null);
  const [docUrl, setDocUrl] = useState<string | null>(null);
  /**
   * The contract itself, drawn page by page.
   *
   * Not an `<object>` any more: iOS Safari will not render a PDF inline, so on
   * most phones the signer was shown a fallback button instead of the
   * agreement. Nobody should be asked to sign a document they were not shown.
   */
  const [pages, setPages] = useState<RenderedPage[]>([]);
  const [pageCount, setPageCount] = useState(0);
  const [docError, setDocError] = useState(false);
  const [signed, setSigned] = useState<SignatureRecord | null>(null);
  const [typedName, setTypedName] = useState('');
  // Keyed by field id, so editing the contract's questions later cannot
  // scramble what a signer typed.
  const [values, setValues] = useState<Record<string, string>>({});
  const [agreed, setAgreed] = useState(false);
  // The headshot, already downscaled, as a data URL. Held here rather than as
  // a File so the preview and what gets sent are provably the same bytes.
  const [headshot, setHeadshot] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!signKey) return;
    let cancelled = false;
    (async () => {
      const view = await fetchSigningRequest(token, signKey);
      if (cancelled) return;
      if (!view) { setPhase('missing'); return; }
      setPayload(view.payload);
      setTypedName(view.payload.signerName);
      // What the show already answers — the date, the venue — arrives filled
      // in. It is an ordinary value in the field, so it can still be corrected.
      setValues(view.payload.prefill ?? {});
      const doc = await fetchSigningDocument(token, signKey, view.payload.total);
      if (cancelled) return;
      setDocUrl(doc);
      if (doc) {
        // Pages appear as they finish rather than all at the end — a long
        // agreement should be readable from page one while the rest draws.
        try {
          await renderPdfPages(doc, (page, total) => {
            if (cancelled) return;
            setPageCount(total);
            setPages((prev) => [...prev, page]);
          });
        } catch (err) {
          // Logged, not swallowed: when a signer says the document did not
          // show, this is the only place that can say why.
          console.error('Could not render the contract:', err);
          if (!cancelled) setDocError(true);
        }
      }
      if (view.signed) {
        setSigned(view.signed);
        setPhase('done');
      } else {
        setPhase('ready');
      }
    })();
    return () => { cancelled = true; };
  }, [token, signKey]);

  const documentReady = !!docUrl && !docError && pageCount > 0 && pages.length === pageCount;

  /**
   * Take a photo down to flyer size before it goes anywhere.
   *
   * Done on this device: a phone camera hands over four megabytes, and the
   * person uploading it is often on venue wifi, so the resize is the
   * difference between a photo arriving and a contract being abandoned.
   */
  async function choosePhoto(file: File) {
    setPhotoBusy(true);
    setPhotoError(null);
    try {
      const small = await downscaleImage(file, FLYER_MAX_DIM);
      const reader = new FileReader();
      const dataUrl = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(small);
      });
      setHeadshot(dataUrl);
    } catch {
      setPhotoError('That image could not be read. Try a JPEG or PNG.');
    } finally {
      setPhotoBusy(false);
    }
  }

  async function handleSign() {
    if (!signKey || !docUrl || !payload || !documentReady || phase !== 'ready') return;
    const name = typedName.trim();
    const missing = missingRequiredFields(payload.fields, values);
    if (!name || !agreed || missing.length > 0) return;
    setPhase('signing');
    setError(null);
    try {
      const record = await submitSignature(
        token,
        signKey,
        name,
        docUrl,
        collectFieldAnswers(payload.fields, values),
        headshot ?? undefined,
      );
      setSigned(record);
      setPhase('done');
    } catch (err) {
      setPhase('ready');
      setError(
        (err as ApiError).status === 413
          ? 'This submission is too large. Remove the optional headshot or choose a smaller photo, then try again. Your answers are still here.'
          : 'That did not go through. Check your connection and try again. Your answers are still here.',
      );
    }
  }

  function download() {
    if (!docUrl || !payload) return;
    const a = document.createElement('a');
    a.href = docUrl;
    a.download = signedFileName(payload.contractName, signed?.typedName || payload.signerName);
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  if (phase === 'nokey' || phase === 'missing') {
    return (
      <div className="signing signing--message">
        <div className="signing__card">
          <h1>This link will not open</h1>
          <p>
            {phase === 'nokey'
              ? 'Part of the link is missing — that usually happens when it is retyped by hand or trimmed by a messaging app. Ask for the link again and open it directly.'
              : 'It may have been withdrawn, or already replaced with a newer one. Ask whoever sent it for a fresh link.'}
          </p>
        </div>
      </div>
    );
  }

  if (phase === 'loading' || !payload) {
    return (
      <div className="signing signing--message">
        <div className="signing__card"><p>Opening the document…</p></div>
      </div>
    );
  }

  return (
    <div className="signing">
      <header className="signing__bar">
        <span className="signing__from">{payload.fromName}</span>
        <h1 className="signing__title">{payload.contractName}</h1>
        <p className="signing__intro">
          Read the full contract below. Fill in your details and sign underneath the last page.
        </p>
      </header>

      <main className="signing__main">
        {!docUrl ? (
          <p className="signing__error" role="alert">
            The document could not be loaded, so there is nothing to agree to yet. Reload the page,
            or ask for the link again.
          </p>
        ) : docError ? (
          /* Drawing the pages failed — an encrypted or malformed PDF. The file
             itself is still here, so offer it rather than leaving them stuck. */
          <div className="signing__doc-fallback">
            <p role="alert">The full contract could not be displayed. Signing is unavailable until every page can be shown. Reload the page or ask the sender for a readable PDF.</p>
            <button className="btn btn--secondary" onClick={download}>Open the PDF</button>
          </div>
        ) : pages.length === 0 ? (
          <p className="signing__doc-loading">Opening the document…</p>
        ) : (
          <div className="signing__doc">
            {pages.map((page) => (
              <figure className="signing__page" key={page.pageNumber}>
                <img
                  src={page.dataUrl}
                  width={page.width}
                  height={page.height}
                  alt={`${payload.contractName}, page ${page.pageNumber} of ${pageCount}`}
                />
                {pageCount > 1 && (
                  <figcaption>
                    Page {page.pageNumber} of {pageCount}
                  </figcaption>
                )}
              </figure>
            ))}
            {pages.length < pageCount && (
              <p className="signing__doc-loading">
                Page {pages.length + 1} of {pageCount}…
              </p>
            )}
          </div>
        )}
      </main>

      {phase === 'done' && signed ? (
        <section className="signing__panel signing__panel--done">
          <h2>Signed</h2>
          <p className="signing__done-line">
            {signed.typedName} · {new Date(signed.signedAt).toLocaleString()}
          </p>
          {signed.fields && signed.fields.length > 0 && (
            <dl className="signing__answers">
              {signed.fields.map((f) => (
                <div key={f.label} className="signing__answer">
                  <dt>{f.label}</dt>
                  <dd>{f.value}</dd>
                </div>
              ))}
            </dl>
          )}
          <p className="signing__ref">Document reference {shortHash(signed.documentHash)}</p>
          <button className="btn btn--primary signing__cta" onClick={download}>
            Save a copy
          </button>
          <p className="signing__note">
            {payload.fromName} can see that you have signed. Keep a copy for yourself — this
            link is the only place it lives.
          </p>
        </section>
      ) : documentReady ? (
        <section className="signing__panel" aria-labelledby="signing-form-title">
          <h2 id="signing-form-title">Your details and signature</h2>
          {error && <p className="signing__error" role="alert">{error}</p>}

          <label className="signing__field signing__field--name">
            <span>Your full name</span>
            <input
              type="text"
              value={typedName}
              autoComplete="name"
              onChange={(e) => setTypedName(e.target.value)}
              placeholder="Type your name"
            />
          </label>

          {(payload.fields ?? []).map((f) => (
            <label className="signing__field" key={f.id}>
              <span>
                {f.label}
                {!f.required && <em className="signing__optional"> optional</em>}
              </span>
              {f.multiline ? (
                <textarea
                  rows={3}
                  value={values[f.id] ?? ''}
                  placeholder={f.placeholder}
                  onChange={(e) => setValues((v) => ({ ...v, [f.id]: e.target.value }))}
                />
              ) : (
                <input
                  type="text"
                  value={values[f.id] ?? ''}
                  placeholder={f.placeholder}
                  onChange={(e) => setValues((v) => ({ ...v, [f.id]: e.target.value }))}
                />
              )}
            </label>
          ))}

          {/* The flyer needs a face, and this is the one moment the performer
              is already filling something in for you. Optional, because a
              missing photo must never be why a contract goes unsigned. */}
          <div className="signing__field signing__photo">
            <span>
              Headshot <em className="signing__optional">optional — used on the flyer</em>
            </span>
            <div className="signing__photo-row">
              {headshot ? (
                <img className="signing__photo-preview" src={headshot} alt="Your headshot" />
              ) : (
                <span className="signing__photo-empty" aria-hidden="true">
                  ☺
                </span>
              )}
              <div className="signing__photo-actions">
                <label className="btn btn--secondary btn--sm signing__photo-pick">
                  {photoBusy ? 'Adding…' : headshot ? 'Choose a different one' : 'Add a photo'}
                  <input
                    type="file"
                    accept="image/*"
                    hidden
                    disabled={photoBusy}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = '';
                      if (file) void choosePhoto(file);
                    }}
                  />
                </label>
                {headshot && (
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() => setHeadshot(null)}
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>
            {photoError && <p className="signing__photo-error">{photoError}</p>}
          </div>

          <label className="signing__agree">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
            />
            <span>
              I have read this document and I agree to it. I understand that typing my name here
              is my signature.
            </span>
          </label>

          <button
            className="btn btn--primary signing__cta"
            disabled={
              !typedName.trim() ||
              !agreed ||
              !documentReady ||
              phase === 'signing' ||
              missingRequiredFields(payload.fields, values).length > 0
            }
            onClick={handleSign}
          >
            {phase === 'signing' ? 'Signing…' : 'Agree and sign'}
          </button>

          {missingRequiredFields(payload.fields, values).length > 0 && (
            <p className="signing__hint">
              Still needed: {missingRequiredFields(payload.fields, values).join(', ')}
            </p>
          )}

          <p className="signing__note">
            You can save your own copy once you have signed, or{' '}
            <button className="signing__link" onClick={download}>open the original PDF</button>.
            You will not need an account.
          </p>
        </section>
      ) : null}
    </div>
  );
}

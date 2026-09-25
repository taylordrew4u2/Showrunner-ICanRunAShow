import { clarifyIntroductionCredits } from '../utils/introductionCredits';
import { useEffect, useRef, useState } from 'react';
import { Modal } from './Modal';
import { decryptWithKey, encryptWithKey } from '../utils/encryption';
import type { ApiError } from '../utils/api';
import {
  downscaleImage,
  FLYER_MAX_DIM,
  HEADSHOT_FALLBACK_DIMS,
  shrinkDataUrl,
} from '../utils/imageResize';
import { photoFailureMessage, photoProblem } from '../utils/photoProblem';
import { submitFailureMessage } from '../utils/submitFailure';
import {
  clearPendingSignature,
  loadPendingSignature,
  retryDelayMs,
  savePendingSignature,
} from '../utils/pendingSignature';
import type { SignatureRecord } from '../types';
import {
  collectFieldAnswers,
  fetchSigningDocument,
  fetchSigningRequest,
  shortHash,
  signedFileName,
  prepareSignature,
  sendSignature,
  isRetryableSignatureError,
  type SigningPayload,
  DAY_OF_CANCELLATION_RULE,
} from '../utils/contracts';
import { renderPdfPages, type RenderedPage } from '../utils/pdfPages';
import { clearSignerDraft, loadSignerDraft, saveSignerDraft } from '../utils/signerDraft';
import './SigningPage.css';

interface SigningPageProps {
  token: string;
  signKey: string | null;
}

type Phase = 'loading' | 'load-error' | 'ready' | 'done' | 'missing' | 'nokey';

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
  /**
   * Their name, as the producer already has it filed. Prefilled, because they
   * should not have to retype what was known before the link was sent — and
   * editable, because the producer's spelling of it is a guess.
   */
  const [signerName, setSignerName] = useState('');
  /**
   * The signature, and deliberately not prefilled.
   *
   * Typing your name here is the signature — so arriving with it already typed
   * is a document that signed itself, which is exactly what an agreement
   * cannot be. The name above is a detail; this is the act.
   */
  const [typedName, setTypedName] = useState('');
  // Keyed by field id, so editing the contract's questions later cannot
  // scramble what a signer typed.
  const [values, setValues] = useState<Record<string, string>>({});
  const [agreed, setAgreed] = useState(false);
  // The day-of cancellation rule, ticked on its own. One box for "I agree to
  // the document" cannot also carry a rule the document does not contain.
  const [ruleAgreed, setRuleAgreed] = useState(false);
  // The headshot, already downscaled, as a data URL. Held here rather than as
  // a File so the preview and what gets sent are provably the same bytes.
  const [headshot, setHeadshot] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  /** Set when the headshot had to be made smaller to fit. */
  const [photoShrunk, setPhotoShrunk] = useState(false);
  /**
   * A signature that has been given but has not reached the server yet.
   *
   * Its presence is what turns "this did not go through" into "signed, and
   * sending" — the page keeps trying in the background and this is what it
   * keeps trying to send.
   */
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<'missing' | 'submit' | 'photo' | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [pendingSaved, setPendingSaved] = useState(false);
  const retryDeliveryRef = useRef<(() => void) | null>(null);
  const busyRef = useRef(false);

  useEffect(() => {
    if (!signKey) return;
    let cancelled = false;
    setPhase('loading');
    setDocError(false);
    setPages([]);
    setPageCount(0);
    (async () => {
      try {
        const view = await fetchSigningRequest(token, signKey);
        if (cancelled) return;
        if (!view) { setPhase('missing'); return; }
        setPayload(view.payload);
        const draft = loadSignerDraft(token);
        setSignerName(draft?.signerName ?? view.payload.signerName);
        setTypedName(draft?.typedName ?? '');
        setAgreed(draft?.agreed ?? false);
        setRuleAgreed(draft?.ruleAgreed ?? false);
        setValues({ ...view.payload.prefill, ...draft?.values });
        const held = loadPendingSignature(token);
        let resumed = false;
        if (view.signed) {
          setSigned(view.signed);
          setPending(null);
          clearPendingSignature(token);
          clearSignerDraft(token);
          setPhase('done');
        } else if (held) {
          try {
            const record = decryptWithKey<SignatureRecord>(held.signature, signKey);
            if (!record?.typedName || !record.documentHash || !record.headshot?.startsWith('data:image/')) {
              throw new Error('A saved signature needs a headshot before delivery');
            }
            setHeadshot(record.headshot);
            setSigned(record);
            setPendingSaved(true);
            setPending(held.signature);
            resumed = true;
            setPhase('done');
          } catch {
            clearPendingSignature(token);
          }
        }
        const doc = await fetchSigningDocument(token, signKey, view.payload.total);
        if (cancelled) return;
        setDocUrl(doc);
        if (!doc) {
          if (!view.signed && !resumed) setPhase('load-error');
          return;
        }
        try {
          await renderPdfPages(doc, (page, total) => {
            if (cancelled) return;
            setPageCount(total);
            setPages(prev => [...prev, page]);
          });
        } catch (err) {
          console.error('Could not render the contract:', err);
          if (!cancelled) setDocError(true);
        }
        if (!cancelled && !view.signed && !resumed) setPhase('ready');
      } catch {
        if (!cancelled) setPhase(current => current === 'done' ? current : 'load-error');
      }
    })();
    return () => { cancelled = true; };
  }, [token, signKey, loadAttempt]);

  const documentReady = !!docUrl && !docError && pageCount > 0 && pages.length === pageCount;

  // Only a confirmed server response earns the "Signed" receipt. Keep the
  // exact ciphertext for retries so a lost response cannot create a new act.
  useEffect(() => {
    if (!pending || !signKey) return;
    let stopped = false;
    let inFlight = false;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const delivered = (record?: SignatureRecord) => {
      clearPendingSignature(token);
      clearSignerDraft(token);
      if (record) setSigned(record);
      setPending(null);
      setError(null);
      setPhase('done');
    };
    const deliver = async () => {
      if (stopped || inFlight) return;
      inFlight = true;
      try {
        await sendSignature(token, pending, { attempts: 1 });
        if (!stopped) delivered();
      } catch (err) {
        if (stopped) return;
        const status = (err as ApiError)?.status;
        // The response may have been lost after the server saved it.
        let verificationFailed = false;
        try {
          const landed = await fetchSigningRequest(token, signKey);
          if (stopped) return;
          if (landed?.signed) { delivered(landed.signed); return; }
        } catch {
          // Neither success nor rejection is established while status is offline.
          verificationFailed = true;
        }
        if (stopped) return;
        if (status === 413) {
          const record = decryptWithKey<SignatureRecord>(pending, signKey);
          if (record.headshot) {
            // Retry with a smaller photo, but never send the agreement without it.
            const smaller = !photoShrunk
              ? await shrinkDataUrl(record.headshot, HEADSHOT_FALLBACK_DIMS.at(-1)!).catch(() => null)
              : null;
            if (stopped) return;
            if (smaller) {
              record.headshot = smaller;
              setPhotoShrunk(true);
              setHeadshot(smaller);
              const replacement = encryptWithKey(record, signKey);
              setPendingSaved(savePendingSignature(token, replacement));
              setSigned(record);
              setPending(replacement);
              return;
            }
          }
        }
        if (isRetryableSignatureError(err) || (status === 409 && verificationFailed)) {
          timer = setTimeout(() => void deliver(), retryDelayMs(attempt++));
        } else {
          // Do not silently discard a rejection or show a success receipt.
          clearPendingSignature(token);
          setPending(null);
          setPhase('ready');
          setError(submitFailureMessage(err, { hasPhoto: true }));
          setNotice('submit');
        }
      } finally {
        inFlight = false;
      }
    };
    void deliver();
    const onOnline = () => {
      attempt = 0;
      clearTimeout(timer);
      void deliver();
    };
    retryDeliveryRef.current = onOnline;
    window.addEventListener('online', onOnline);
    return () => {
      stopped = true;
      retryDeliveryRef.current = null;
      clearTimeout(timer);
      window.removeEventListener('online', onOnline);
    };
  }, [pending, token, signKey, photoShrunk]);

  /*
   * Written on every change rather than on a timer: the events this protects
   * against — a tab killed in the background, a reload, a back gesture — do
   * not announce themselves first.
   */
  useEffect(() => {
    if (phase !== 'ready') return;
    saveSignerDraft(token, { signerName, typedName, values, agreed, ruleAgreed });
  }, [token, signerName, typedName, values, agreed, ruleAgreed, phase]);

  const missingDetails = payload ? [
    ...(signerName.trim() ? [] : [{ label: 'Your name', id: 'signer-name' }]),
    ...(payload.fields ?? []).filter(f => f.required && !(values[f.id] ?? '').trim())
      .map(clarifyIntroductionCredits).map(f => ({ label: f.label, id: `signer-field-${f.id}` })),
    ...(headshot ? [] : [{ label: 'Headshot', id: 'signer-headshot' }]),
    ...(typedName.trim() ? [] : [{ label: 'Your signature', id: 'signer-signature' }]),
    ...(payload.cancellationRule && !ruleAgreed
      ? [{ label: 'Tick the day-of cancellation rule', id: 'signer-rule-agreed' }] : []),
    ...(agreed ? [] : [{ label: 'Tick the agreement checkbox', id: 'signer-agreed' }]),
  ] : [];
  const stillNeeded = missingDetails.map(field => field.label);

  function focusMissing() {
    const id = missingDetails[0]?.id;
    setNotice(null);
    // Run after the modal restores focus, then take the signer to the field.
    setTimeout(() => {
      const field = id ? document.getElementById(id) : null;
      field?.focus();
      field?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, 0);
  }

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
    // Checked before the resize is attempted: a HEIC fails somewhere inside the
    // decode with nothing useful attached, and by then the reason is gone.
    const known = photoProblem(file);
    if (known) {
      setPhotoError(known);
      setPhotoBusy(false);
      return;
    }
    try {
      const small = await downscaleImage(file, FLYER_MAX_DIM);
      const reader = new FileReader();
      const dataUrl = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(small);
      });
      if (!dataUrl.startsWith('data:image/')) throw new Error('not an image');
      setHeadshot(dataUrl);
      setPhotoShrunk(false);
    } catch {
      setPhotoError(photoFailureMessage(file));
    } finally {
      setPhotoBusy(false);
    }
  }

  function handleSign() {
    if (busyRef.current || pending) return;
    if (photoBusy) { setNotice('photo'); return; }
    if (missingDetails.length) { setNotice('missing'); return; }
    if (!signKey || !docUrl || !payload || !documentReady || phase !== 'ready') {
      setError('The contract is still opening. Use Try again above if it does not finish. Your answers are kept.');
      setNotice('submit');
      return;
    }
    busyRef.current = true;
    try {
      const { record, signature } = prepareSignature(
        signKey, typedName.trim(), docUrl,
        collectFieldAnswers(payload.fields, values), headshot ?? undefined, signerName.trim(),
        payload.cancellationRule,
      );
      // Save before the first network attempt, including if the tab closes
      // while the server is receiving the upload.
      setPendingSaved(savePendingSignature(token, signature));
      setSigned(record);
      setError(null);
      setNotice(null);
      setPending(signature);
      setPhase('done');
    } catch (err) {
      setError(submitFailureMessage(err, { hasPhoto: !!headshot }));
      setNotice('submit');
    } finally { busyRef.current = false; }
  }

  function download() {
    if (!docUrl || !payload) return;
    const a = document.createElement('a');
    a.href = docUrl;
    a.download = signedFileName(
      payload.contractName,
      signed?.signerName || signed?.typedName || payload.signerName,
    );
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

  if (phase === 'load-error') {
    return <div className="signing signing--message"><div className="signing__card">
      <h1>Let’s try opening that again</h1>
      <p role="alert">The contract could not finish loading. Your answers are kept. Check your connection and try again.</p>
      <button className="btn btn--primary" onClick={() => setLoadAttempt(value => value + 1)}>Try again</button>
    </div></div>;
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
            <p role="alert">The full contract could not be displayed. Try loading it again, or open the PDF to check the file. Your answers are kept.</p>
            <button className="btn btn--secondary" onClick={download}>Open the PDF</button>
            <button className="btn btn--primary" onClick={() => setLoadAttempt(value => value + 1)}>Try again</button>
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
          <h2>{pending ? 'Sending your signature' : 'Signed'}</h2>

          {pending && (
            <p className="signing__sending" role="status">
              <span className="signing__sending-dot" aria-hidden="true" />
              {pendingSaved
                ? 'Your signature is saved on this device and is being sent. Keep this page open until it says Signed. If you close it, reopen this same link to resume.'
                : 'Keep this page open until it says Signed. This browser could not save a backup, so closing it before delivery could lose your submission.'}
            </p>
          )}
          {pending && <button className="btn btn--secondary" onClick={() => retryDeliveryRef.current?.()}>Retry now</button>}
          <p className="signing__done-line">
            {signed.typedName} · {new Date(signed.signedAt).toLocaleString()}
          </p>
          {signed.cancellationRuleAcknowledged && (
            <p className="signing__done-rule">Day-of cancellation rule acknowledged.</p>
          )}
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
          {docUrl && <button className="btn btn--primary signing__cta" onClick={download}>
            Save a copy
          </button>}
          {photoShrunk && (
            <p className="signing__note" role="status">
              Your photo was made smaller so it would send.
              {pending ? 'It is still sending.' : 'Nothing is outstanding.'}
            </p>
          )}
          <p className="signing__note">
            {pending
              ? `${payload.fromName} will see this as soon as it sends.`
              : `${payload.fromName} can see that you have signed.`}{' '}
            Keep a copy for yourself.
          </p>
        </section>
      ) : documentReady ? (
        <section className="signing__panel" aria-labelledby="signing-form-title">
          <h2 id="signing-form-title">Your details and signature</h2>
          {error && notice !== 'submit' && <p className="signing__error" role="alert">{error}</p>}

          <label className="signing__field signing__field--name">
            <span>Your name</span>
            <input
              id="signer-name"
              aria-invalid={notice === 'missing' && !signerName.trim()}
              type="text"
              value={signerName}
              autoComplete="name"
              onChange={(e) => setSignerName(e.target.value)}
              placeholder="Your name"
            />
          </label>

          {(payload.fields ?? []).map(clarifyIntroductionCredits).map((f) => (
            <label className="signing__field" key={f.id}>
              <span>
                {f.label}
                {!f.required && <em className="signing__optional"> optional</em>}
              </span>
              {f.multiline ? (
                <textarea
                  id={`signer-field-${f.id}`}
                  aria-invalid={notice === 'missing' && f.required && !(values[f.id] ?? '').trim()}
                  rows={3}
                  value={values[f.id] ?? ''}
                  placeholder={f.placeholder}
                  onChange={(e) => setValues((v) => ({ ...v, [f.id]: e.target.value }))}
                />
              ) : (
                <input
                  id={`signer-field-${f.id}`}
                  aria-invalid={notice === 'missing' && f.required && !(values[f.id] ?? '').trim()}
                  type="text"
                  value={values[f.id] ?? ''}
                  placeholder={f.placeholder}
                  onChange={(e) => setValues((v) => ({ ...v, [f.id]: e.target.value }))}
                />
              )}
            </label>
          ))}

          {/* The headshot and signature must be delivered together. */}
          <div className="signing__field signing__photo">
            <span>
              Headshot{' '}
              <em className="signing__optional">
                required, used on the flyer
              </em>
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
                <label id="signer-headshot" tabIndex={0} className="btn btn--secondary btn--sm signing__photo-pick">
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
            {photoError && <p className="signing__photo-error" role="alert">{photoError}</p>}

          </div>

          {/* Last, next to the agreement, and empty. Whatever was known about
              this person before they opened the link, the signature is the one
              thing only they can put here. */}
          <label className="signing__field signing__field--signature">
            <span>Signature</span>
            <input
              id="signer-signature"
              aria-invalid={notice === 'missing' && !typedName.trim()}
              type="text"
              value={typedName}
              autoComplete="off"
              onChange={(e) => setTypedName(e.target.value)}
              placeholder="Type your full name to sign"
            />
          </label>

          {/* The house rule, stated here in the producer's own words rather
              than left to the PDF, and ticked on its own so nobody can say
              they never saw it. Only on links that carry it. */}
          {payload.cancellationRule && (
            <aside className="signing__rule" aria-labelledby="signing-rule-title">
              <h3 id="signing-rule-title">{DAY_OF_CANCELLATION_RULE.title}</h3>
              <p>{payload.cancellationRule}</p>
              <label className="signing__agree signing__rule-agree">
                <input
                  id="signer-rule-agreed"
                  aria-invalid={notice === 'missing' && !ruleAgreed}
                  type="checkbox"
                  checked={ruleAgreed}
                  onChange={(e) => setRuleAgreed(e.target.checked)}
                />
                <span>{DAY_OF_CANCELLATION_RULE.acknowledgement}</span>
              </label>
            </aside>
          )}

          <label className="signing__agree">
            <input
              id="signer-agreed"
              aria-invalid={notice === 'missing' && !agreed}
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
            disabled={!!pending}
            onClick={() => handleSign()}
          >
            Agree and sign
          </button>

          {stillNeeded.length > 0 && (
            <p className="signing__hint" role="status">
              Still needed: {stillNeeded.join(', ')}
            </p>
          )}

          <p className="signing__note">
            You can save your own copy once you have signed, or{' '}
            <button className="signing__link" onClick={download}>open the original PDF</button>.
            You will not need an account.
          </p>
        </section>
      ) : null}
      {notice && <Modal onClose={() => setNotice(null)} labelledBy="signing-notice-title">
        <div className="signing__notice">
          <h2 id="signing-notice-title">{notice === 'missing' ? 'Finish these details' : notice === 'photo' ? 'Your photo is still preparing' : 'Your signature has not been submitted yet'}</h2>
          {notice === 'missing' ? <>
            <p>Complete these items, then press Agree and sign. Your answers are still here.</p>
            <ul>{missingDetails.map(field => <li key={field.id}>{field.label}</li>)}</ul>
            <button className="btn btn--primary" onClick={focusMissing}>Go to first missing field</button>
          </> : notice === 'photo' ? <>
            <p>Your headshot is required. Wait for its preview before signing.</p>
            <button className="btn btn--primary" onClick={() => setNotice(null)}>Wait for photo</button>
          </> : <>
            <p role="alert">{error}</p>
            <button className="btn btn--primary" onClick={() => setNotice(null)}>Back to form</button>
          </>}
        </div>
      </Modal>}
    </div>
  );
}

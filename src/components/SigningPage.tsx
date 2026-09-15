import { clarifyIntroductionCredits } from '../utils/introductionCredits';
import { useEffect, useState } from 'react';
import type { ApiError } from '../utils/api';
import {
  downscaleImage,
  FLYER_MAX_DIM,
  HEADSHOT_FALLBACK_DIMS,
  shrinkDataUrl,
} from '../utils/imageResize';
import { submitFailureMessage } from '../utils/submitFailure';
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
import { clearSignerDraft, loadSignerDraft, saveSignerDraft } from '../utils/signerDraft';
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
  // The headshot, already downscaled, as a data URL. Held here rather than as
  // a File so the preview and what gets sent are provably the same bytes.
  const [headshot, setHeadshot] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  /** Set when the contract was signed but the headshot would not fit at all. */
  const [photoDropped, setPhotoDropped] = useState(false);
  /** Set when the headshot had to be made smaller to fit. */
  const [photoShrunk, setPhotoShrunk] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!signKey) return;
    let cancelled = false;
    (async () => {
      const view = await fetchSigningRequest(token, signKey);
      if (cancelled) return;
      if (!view) { setPhase('missing'); return; }
      setPayload(view.payload);
      setSignerName(view.payload.signerName);
      // What the show already answers — the date, the venue — arrives filled
      // in. It is an ordinary value in the field, so it can still be corrected.
      setValues(view.payload.prefill ?? {});
      /*
       * Then whatever they had already typed, which wins over both the
       * prefill and the producer's spelling of their name — it is the most
       * recent thing this person said, and they said it on this device.
       */
      const draft = loadSignerDraft(token);
      if (draft) {
        if (draft.signerName) setSignerName(draft.signerName);
        if (draft.typedName) setTypedName(draft.typedName);
        if (draft.values && Object.keys(draft.values).length) {
          setValues((prev) => ({ ...prev, ...draft.values }));
        }
        if (draft.agreed) setAgreed(true);
      }
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
        // Already signed — from another device, or from a submission this
        // phone never heard the answer to. Either way the draft is spent.
        clearSignerDraft(token);
        setPhase('done');
      } else {
        setPhase('ready');
      }
    })();
    return () => { cancelled = true; };
  }, [token, signKey]);

  const documentReady = !!docUrl && !docError && pageCount > 0 && pages.length === pageCount;

  /*
   * Written on every change rather than on a timer: the events this protects
   * against — a tab killed in the background, a reload, a back gesture — do
   * not announce themselves first.
   */
  useEffect(() => {
    if (phase === 'loading' || phase === 'done' || phase === 'nokey' || phase === 'missing') return;
    saveSignerDraft(token, { signerName, typedName, values, agreed });
  }, [token, signerName, typedName, values, agreed, phase]);

  /**
   * What the signer still has to do, in the order the page asks for it, so the
   * hint under the button reads down the form rather than in whatever order
   * the checks happen to be written.
   */
  const stillNeeded = payload
    ? [
        ...(signerName.trim() ? [] : ['your name']),
        ...missingRequiredFields(payload.fields, values),
        ...(typedName.trim() ? [] : ['your signature']),
        ...(agreed ? [] : ['the agreement ticked']),
      ]
    : [];

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
    const signature = typedName.trim();
    const name = signerName.trim();
    const missing = missingRequiredFields(payload.fields, values);
    if (!signature || !name || !agreed || missing.length > 0) return;
    setPhase('signing');
    setError(null);
    try {
      const record = await submitSignature(
        token,
        signKey,
        signature,
        docUrl,
        collectFieldAnswers(payload.fields, values),
        headshot ?? undefined,
        name,
      );
      setSigned(record);
      clearSignerDraft(token);
      setPhase('done');
    } catch (err) {
      /*
       * Before telling someone their signature failed, find out whether it
       * did.
       *
       * A write that landed and lost its answer looks identical to one that
       * never arrived — the connection drops, or the request times out after
       * the server has already recorded it. Only the server knows, and it will
       * now say the request is signed. Getting this wrong told a performer who
       * had signed that they had not, so they pressed again, got "already
       * signed" reported as a connection problem, and texted the producer.
       */
      const landed = await fetchSigningRequest(token, signKey).catch(() => null);
      if (landed?.signed) {
        setSigned(landed.signed);
        clearSignerDraft(token);
        setPhase('done');
        return;
      }
      const status = (err as ApiError).status;

      /*
       * Too large, and the only thing that can be large is the headshot. So
       * make it smaller and send it again, down a ladder, rather than losing
       * it or asking the performer to go and edit a photo on their phone.
       *
       * The server is the judge of what fits: the payload is encrypted before
       * it goes, so its final size is not something this page can work out in
       * advance. Hence trying rather than calculating.
       */
      if (status === 413 && headshot) {
        let smaller: string | null = headshot;
        for (const dim of HEADSHOT_FALLBACK_DIMS) {
          setError(`That photo was too large, so it is being made smaller — still sending…`);
          smaller = await shrinkDataUrl(headshot, dim);
          if (!smaller) break;
          try {
            const record = await submitSignature(
              token, signKey, signature, docUrl,
              collectFieldAnswers(payload.fields, values), smaller, name,
            );
            setSigned(record);
            clearSignerDraft(token);
            setHeadshot(smaller);
            setPhotoShrunk(true);
            setError(null);
            setPhase('done');
            return;
          } catch (again) {
            // Still too big? Down another rung. Anything else is a real
            // failure and is reported as itself.
            if ((again as ApiError).status !== 413) {
              setPhase('ready');
              setError(submitFailureMessage(again, { hasPhoto: true }));
              return;
            }
          }
        }

        // Even the smallest would not fit. The agreement is the point and the
        // photo is optional, so sign without it and say so plainly.
        try {
          const record = await submitSignature(
            token, signKey, signature, docUrl,
            collectFieldAnswers(payload.fields, values), undefined, name,
          );
          setSigned(record);
          clearSignerDraft(token);
          setHeadshot(null);
          // Said on the receipt, not on the form — the form is gone by then.
          setPhotoDropped(true);
          setError(null);
          setPhase('done');
          return;
        } catch (last) {
          setPhase('ready');
          setError(submitFailureMessage(last, { hasPhoto: false }));
          return;
        }
      }

      setPhase('ready');
      setError(submitFailureMessage(err, { hasPhoto: !!headshot }));
    }
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
          {photoShrunk && (
            <p className="signing__note" role="status">
              Your photo was made smaller so it would send. The contract is signed and
              nothing is outstanding.
            </p>
          )}
          {photoDropped && (
            <p className="signing__note" role="status">
              Your photo was too large to send, so it was left off. The contract is signed —
              nothing else is outstanding. {payload.fromName} can ask for the photo separately.
            </p>
          )}
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
            <span>Your name</span>
            <input
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

          {/* Last, next to the agreement, and empty. Whatever was known about
              this person before they opened the link, the signature is the one
              thing only they can put here. */}
          <label className="signing__field signing__field--signature">
            <span>Signature</span>
            <input
              type="text"
              value={typedName}
              autoComplete="off"
              onChange={(e) => setTypedName(e.target.value)}
              placeholder="Type your full name to sign"
            />
          </label>

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
            disabled={stillNeeded.length > 0 || !documentReady || phase === 'signing'}
            onClick={handleSign}
          >
            {phase === 'signing' ? 'Signing…' : 'Agree and sign'}
          </button>

          {/* Everything the button is waiting on, named. A greyed-out button
              with no explanation is where a signer gives up and texts the
              producer instead, and the signature and the tick-box were not in
              this list before — which made an empty signature field look like
              the page being broken. */}
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
    </div>
  );
}

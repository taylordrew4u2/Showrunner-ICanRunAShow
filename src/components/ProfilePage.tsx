import { clarifyIntroductionCredits } from '../utils/introductionCredits';
import { useEffect, useState } from 'react';
import type { ProfileSubmission } from '../types';
import { collectFieldAnswers, missingRequiredFields } from '../utils/contracts';
import { downscaleImage, FLYER_MAX_DIM } from '../utils/imageResize';
import { readFileAsDataURL } from '../utils/media';
import { clearSignerDraft, loadSignerDraft, saveSignerDraft } from '../utils/signerDraft';
import { isEmail } from '../utils/social';
import { submitFailureMessage } from '../utils/submitFailure';
import {
  fetchProfileRequest,
  submitProfile,
  uploadProfilePhoto,
  type ProfilePayload,
} from '../utils/profileLink';
import './SigningPage.css';

interface ProfilePageProps {
  token: string;
  /** From the fragment; null when the link was pasted without it. */
  profileKey: string | null;
}

type Phase = 'nokey' | 'loading' | 'load-error' | 'missing' | 'ready' | 'sending' | 'done';

/**
 * The page a performer sees when a producer sends them a profile link.
 *
 * Same shape as the signing page, deliberately: one bar saying who is asking,
 * one panel of questions, one button. The person opening this is on their
 * phone between two other things, and the whole design goal is that it takes
 * less effort than typing the same answers into a text message.
 *
 * Styled with the signing page's own stylesheet rather than a copy of it, so
 * the two pages a performer might be sent look like they came from the same
 * producer.
 */
export function ProfilePage({ token, profileKey }: ProfilePageProps) {
  const [phase, setPhase] = useState<Phase>(profileKey ? 'loading' : 'nokey');
  const [payload, setPayload] = useState<ProfilePayload | null>(null);
  const [submitted, setSubmitted] = useState<ProfileSubmission | null>(null);
  const [typedName, setTypedName] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  // Already downscaled, as a data URL — the preview and what is sent are the
  // same bytes.
  const [headshot, setHeadshot] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);

  useEffect(() => {
    if (!profileKey) return;
    let cancelled = false;
    setPhase('loading');
    (async () => {
      try {
        const view = await fetchProfileRequest(token, profileKey);
        if (cancelled) return;
        if (!view) {
          setPhase('missing');
          return;
        }
        setPayload(view.payload);
        // What they typed before the tab was killed comes first; the
        // producer's spelling of their name is only the starting point.
        const draft = loadSignerDraft(token);
        setTypedName(draft?.signerName ?? view.payload.personName);
        setValues(draft?.values ?? {});
        if (view.submitted) {
          setSubmitted(view.submitted);
          clearSignerDraft(token);
          setPhase('done');
        } else {
          setPhase('ready');
        }
      } catch {
        // The request died, which says nothing about the link. Offer another
        // go rather than telling them it was withdrawn.
        if (!cancelled) setPhase('load-error');
      }
    })();
    return () => { cancelled = true; };
  }, [token, profileKey, loadAttempt]);

  /*
   * Written on every change, as the signing page does: a tab discarded in the
   * background while they go to find a headshot does not warn first, and an
   * empty form on return is where someone gives up and texts instead.
   */
  useEffect(() => {
    if (phase !== 'ready') return;
    saveSignerDraft(token, { signerName: typedName, values });
  }, [token, typedName, values, phase]);

  /**
   * Take the photo down to flyer size on this device, before it goes
   * anywhere. A phone camera hands over four megabytes, and the person on
   * venue wifi is the one who gives up halfway.
   */
  async function choosePhoto(file: File) {
    setPhotoBusy(true);
    setPhotoError(null);
    try {
      setHeadshot(await readFileAsDataURL(await downscaleImage(file, FLYER_MAX_DIM)));
    } catch {
      setPhotoError('That image could not be read. Try a JPEG or PNG.');
    } finally {
      setPhotoBusy(false);
    }
  }

  /**
   * An email the producer's import would drop. It only files an answer that
   * looks like an address, so "mona at gmail dot com" sealed the link and
   * then vanished — the one required answer, gone without a trace.
   */
  const emailProblem = (() => {
    const typed = (values.email ?? '').trim();
    return typed && !isEmail(typed) ? 'That does not look like an email address.' : null;
  })();

  async function handleSend() {
    if (!profileKey || !payload) return;
    const name = typedName.trim();
    const missing = missingRequiredFields(payload.fields, values);
    // The photo is still being shrunk: sending now would send without it, and
    // the link takes answers only once.
    if (!name || missing.length > 0 || emailProblem || photoBusy) return;
    setPhase('sending');
    setError(null);
    try {
      // The photo goes first, because the answers are accepted once and seal
      // the link. If the photo fails, nothing is sent and they can try again —
      // sending the answers without it would mean the photo can never follow.
      let photoChunks = 0;
      if (headshot) {
        try {
          photoChunks = await uploadProfilePhoto(token, profileKey, headshot);
        } catch {
          setPhase('ready');
          setError('Your photo did not go through. Try again, or remove it and send without — nothing has been sent yet.');
          return;
        }
      }
      const record = await submitProfile(
        token,
        profileKey,
        name,
        collectFieldAnswers(payload.fields, values),
        photoChunks,
      );
      setSubmitted(record);
      clearSignerDraft(token);
      setPhase('done');
    } catch (err) {
      // Same as the signing page: a write that lost its answer is not a write
      // that failed. "Nothing has been sent yet" was a claim this code was in
      // no position to make.
      const landed = await fetchProfileRequest(token, profileKey!).catch(() => null);
      if (landed?.submitted) {
        setSubmitted(landed.submitted);
        clearSignerDraft(token);
        setPhase('done');
        return;
      }
      setPhase('ready');
      // Say which thing went wrong, not "check your connection" for all of
      // them — half the reasons have nothing to do with the connection.
      setError(submitFailureMessage(err));
    }
  }

  if (phase === 'nokey' || phase === 'missing') {
    return (
      <div className="signing signing--message">
        <div className="signing__card">
          <h1>This link is not working</h1>
          <p>
            {phase === 'nokey'
              ? 'The link is missing its key. Open it exactly as it was sent — copying only part of it leaves the key behind.'
              : 'It may have been withdrawn, or the address was not copied in full. Ask whoever sent it for a fresh one.'}
          </p>
        </div>
      </div>
    );
  }

  if (phase === 'load-error') {
    return (
      <div className="signing signing--message">
        <div className="signing__card">
          <h1>Let’s try opening that again</h1>
          <p role="alert">The page could not finish loading. Check your connection and try again.</p>
          <button className="btn btn--primary" onClick={() => setLoadAttempt((n) => n + 1)}>Try again</button>
        </div>
      </div>
    );
  }

  if (phase === 'loading' || !payload) {
    return (
      <div className="signing signing--message">
        <div className="signing__card"><p>Opening…</p></div>
      </div>
    );
  }

  const missing = missingRequiredFields(payload.fields, values);

  return (
    <div className="signing">
      <header className="signing__bar">
        <span className="signing__from">{payload.fromName}</span>
        <h1 className="signing__title">Your details</h1>
      </header>

      <main className="signing__main">
        {phase === 'done' && submitted ? (
          <section className="signing__panel signing__panel--done">
            <h2>Sent — thank you</h2>
            <p className="signing__done-line">
              {payload.fromName} has what they need to book you and put you on the flyer.
            </p>
            {/* Only a photo that went with the answers. One chosen after
                pressing Send was never uploaded, and the link is sealed. */}
            {headshot && submitted.photoChunks
              ? <img className="signing__photo-preview" src={headshot} alt="Your headshot" />
              : null}
            <dl className="signing__answers">
              <div className="signing__answer">
                <dt>Name</dt>
                <dd>{submitted.typedName}</dd>
              </div>
              {submitted.fields.map((f) => (
                <div key={f.label} className="signing__answer">
                  <dt>{f.label}</dt>
                  <dd>{f.value}</dd>
                </div>
              ))}
            </dl>
            <p className="signing__note">
              This link has done its job and will not take a second set of answers. If something
              is wrong, tell {payload.fromName} directly.
            </p>
          </section>
        ) : (
          <section className="signing__panel">
            <p className="signing__hint">
              {payload.fromName} is asking for the details they need to book you. It takes about a
              minute, and nothing here is shared with anyone else.
            </p>

            {error && <p className="signing__error" role="alert">{error}</p>}

            <label className="signing__field signing__field--name">
              <span>Your name, as you want it billed</span>
              <input
                type="text"
                value={typedName}
                autoComplete="name"
                onChange={(e) => setTypedName(e.target.value)}
              />
            </label>

            {payload.fields.map(clarifyIntroductionCredits).map((f) => (
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
                    type={f.id === 'email' ? 'email' : f.id === 'phone' ? 'tel' : 'text'}
                    value={values[f.id] ?? ''}
                    placeholder={f.placeholder}
                    autoComplete={f.id === 'email' ? 'email' : f.id === 'phone' ? 'tel' : 'off'}
                    aria-invalid={f.id === 'email' && !!emailProblem}
                    onChange={(e) => setValues((v) => ({ ...v, [f.id]: e.target.value }))}
                  />
                )}
                {f.id === 'email' && emailProblem && (
                  <small className="signing__photo-error" role="alert">{emailProblem}</small>
                )}
              </label>
            ))}

            {/* The flyer needs a face, and this is the one moment they are
                already filling something in. Optional: a missing photo must
                never be why the details do not arrive. */}
            <div className="signing__field signing__photo">
              <span>
                Headshot <em className="signing__optional">optional — for the flyer</em>
              </span>
              <div className="signing__photo-row">
                {headshot ? (
                  <img className="signing__photo-preview" src={headshot} alt="Your headshot" />
                ) : (
                  <span className="signing__photo-empty" aria-hidden="true">☺</span>
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
                    <button type="button" className="btn btn--ghost btn--sm" onClick={() => setHeadshot(null)}>
                      Remove
                    </button>
                  )}
                </div>
              </div>
              {photoError && <p className="signing__photo-error">{photoError}</p>}
            </div>

            <button
              className="btn btn--primary signing__cta"
              onClick={handleSend}
              disabled={phase === 'sending' || !typedName.trim() || missing.length > 0 || !!emailProblem || photoBusy}
            >
              {phase === 'sending' ? 'Sending…' : photoBusy ? 'Adding your photo…' : 'Send my details'}
            </button>
            {missing.length > 0 && (
              <p className="signing__hint">Still needed: {missing.join(', ')}</p>
            )}
          </section>
        )}
      </main>
    </div>
  );
}

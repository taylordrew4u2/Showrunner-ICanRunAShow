import { useEffect, useState } from 'react';
import type { ProfileSubmission } from '../types';
import { collectFieldAnswers, missingRequiredFields } from '../utils/contracts';
import { fetchProfileRequest, submitProfile, type ProfilePayload } from '../utils/profileLink';
import './SigningPage.css';

interface ProfilePageProps {
  token: string;
  /** From the fragment; null when the link was pasted without it. */
  profileKey: string | null;
}

type Phase = 'nokey' | 'loading' | 'missing' | 'ready' | 'sending' | 'done';

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

  useEffect(() => {
    if (!profileKey) return;
    let cancelled = false;
    (async () => {
      const view = await fetchProfileRequest(token, profileKey);
      if (cancelled) return;
      if (!view) {
        setPhase('missing');
        return;
      }
      setPayload(view.payload);
      setTypedName(view.payload.personName);
      if (view.submitted) {
        setSubmitted(view.submitted);
        setPhase('done');
      } else {
        setPhase('ready');
      }
    })();
    return () => { cancelled = true; };
  }, [token, profileKey]);

  async function handleSend() {
    if (!profileKey || !payload) return;
    const name = typedName.trim();
    const missing = missingRequiredFields(payload.fields, values);
    if (!name || missing.length > 0) return;
    setPhase('sending');
    setError(null);
    try {
      const record = await submitProfile(
        token,
        profileKey,
        name,
        collectFieldAnswers(payload.fields, values),
      );
      setSubmitted(record);
      setPhase('done');
    } catch {
      setPhase('ready');
      setError('That did not go through. Check your connection and try again — nothing has been sent yet.');
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

            {payload.fields.map((f) => (
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
                    onChange={(e) => setValues((v) => ({ ...v, [f.id]: e.target.value }))}
                  />
                )}
              </label>
            ))}

            {/* No photo here, and it says why: the producer's contract link
                takes one. Said rather than silently absent, or the performer
                goes looking for the upload that is not there. */}
            <p className="signing__note">
              Your headshot is not asked for here — {payload.fromName} will collect it with your
              contract.
            </p>

            <button
              className="btn btn--primary signing__cta"
              onClick={handleSend}
              disabled={phase === 'sending' || !typedName.trim() || missing.length > 0}
            >
              {phase === 'sending' ? 'Sending…' : 'Send my details'}
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

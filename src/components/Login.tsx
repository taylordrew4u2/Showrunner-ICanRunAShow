import { BrandMark } from './BrandMark';
import { useId, useState } from 'react';
import { isNativeShell } from '../utils/nativeShell';
import './Login.css';

interface LoginProps {
  onSignIn: (username: string, password: string) => void;
  onSignUp: (username: string, password: string) => void;
  loading?: boolean;
  errorMessage?: string;
  /** Filled in when the app signed someone out itself, so they sign back in to the same account. */
  defaultUsername?: string;
}

// New accounts need eight characters. Accounts made when three was enough
// still sign in with the password they chose.
const MIN_NEW_PASSWORD = 8;
const MIN_PASSWORD = 3;

export function Login({ onSignIn, onSignUp, loading = false, errorMessage = '', defaultUsername = '' }: LoginProps) {
  // Labels have to point at the field they name: written as a plain <label>
  // beside an input they are decoration — not announced as the field's name,
  // and not tappable to focus it.
  const fieldId = useId();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [username, setUsername] = useState(defaultUsername);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  // The sales page opens inside the iOS app, where App Store guideline 3.1.1
  // keeps the plan's price out of sight (public/tour/index.html hides it
  // there), so the links there don't promise pricing.
  const native = isNativeShell();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    const normalizedUsername = username.trim();

    if (!normalizedUsername) {
      setError('Username is required');
      return;
    }

    if (normalizedUsername.length < 3) {
      setError('Username must be at least 3 characters');
      return;
    }

    if (!password.trim()) {
      setError('Password is required');
      return;
    }

    const minimum = mode === 'signup' ? MIN_NEW_PASSWORD : MIN_PASSWORD;
    if (password.length < minimum) {
      setError(`Password must be at least ${minimum} characters`);
      return;
    }

    if (mode === 'signup') {
      onSignUp(normalizedUsername, password);
      return;
    }

    onSignIn(normalizedUsername, password);
  }

  return (
    <div className="landing">
      <div className="landing__center">
        <div className="landing__intro">
        <div className="landing__wordmark">
          <BrandMark />
          <span className="landing__wordmark-text">I Can Run A Show</span>
        </div>

        <h1 className="landing__headline">Make it a <em>great night.</em></h1>
        <p className="landing__lede">
          Build the lineup, import the schedule, and run the night.
          Your whole production, in one place.
        </p>
        <ol className="landing__steps" aria-label="Your show workflow">
          <li><span>01</span> Plan the lineup</li>
          <li><span>02</span> Set the cues</li>
          <li><span>03</span> Run the show</li>
        </ol>
        <a className="landing__tour" href="/tour/">
          {native ? 'See everything it does →' : 'See everything it does, and pricing →'}
        </a>
        </div>

        <div className="login__container">
          <div className="login__header">
            <h2 className="login__title">
              {mode === 'signup' ? 'Create your account' : 'Welcome back'}
            </h2>
          </div>

          <form className="login__form" onSubmit={handleSubmit}>
            <div className="login__field">
              <label className="login__label" htmlFor={`${fieldId}-username`}>Username</label>
              <input id={`${fieldId}-username`}
                className="login__input"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Enter username"
                disabled={loading}
                autoComplete="username"
                // A phone keyboard capitalises the first letter of a text field
                // on its own, and "Taylor" and "taylor" look like two different
                // people to anything filed on this device by name.
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
              />
            </div>

            <div className="login__field">
              <label className="login__label" htmlFor={`${fieldId}-password`}>Password</label>
              <input id={`${fieldId}-password`}
                className="login__input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                disabled={loading}
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              />
            </div>

            {(error || errorMessage) && (
              <div className="login__error" role="alert">{error || errorMessage}</div>
            )}

            <button className="login__button" type="submit" disabled={loading}>
              {loading ? 'Please wait…' : mode === 'signup' ? 'Create account' : 'Sign in'}
            </button>

            <button
              className="login__button login__button--secondary"
              type="button"
              disabled={loading}
              onClick={() => {
                setError('');
                setMode((prev) => (prev === 'signin' ? 'signup' : 'signin'));
              }}
            >
              {mode === 'signup' ? 'Already have an account? Sign in' : 'New here? Create an account'}
            </button>
          </form>

          <div className="login__footer">
            {/* Someone who was sent a contract has no account and should never
                make one. They reach this screen only when the link they opened
                lost its token on the way — a preview card that went to the
                homepage instead, or a link broken across two lines in a text.
                Saying so here is the difference between them asking for the
                link again and them signing up for a producer's tool. */}
            <details className="login__no-account">
              <summary>Were you sent a link to sign or fill in?</summary>
              <p>
                You do not need an account. Open the link itself again — tap the address,
                not a preview card, and make sure you have the whole thing, including
                everything after the <code>#</code>.
              </p>
            </details>
            <p className="login__legal">
              <a href="/tour/">{native ? 'Features' : 'Features & pricing'}</a>
              <a href="/guides/">Guides</a>
              <a href="/privacy.html">Privacy</a>
              <a href="/terms.html">Terms</a>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

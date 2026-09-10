import { useId, useState } from 'react';
import './Login.css';

interface LoginProps {
  onSignIn: (username: string, password: string) => void;
  onSignUp: (username: string, password: string) => void;
  loading?: boolean;
  errorMessage?: string;
}

export function Login({ onSignIn, onSignUp, loading = false, errorMessage = '' }: LoginProps) {
  // Labels have to point at the field they name: written as a plain <label>
  // beside an input they are decoration — not announced as the field's name,
  // and not tappable to focus it.
  const fieldId = useId();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

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

    if (password.length < 3) {
      setError('Password must be at least 3 characters');
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
        <div className="landing__wordmark">
          <span className="landing__wordmark-dot" />
          <span className="landing__wordmark-text">I Can Run A Show</span>
        </div>

        {/* One line, not a pitch. Whoever is here either has an account and
            wants the form, or was sent the link by someone who already sold
            them on it. The guides carry the rest. */}
        <p className="landing__lede">
          Build the lineup, import the schedule, and run the night.
        </p>

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
              <div className="login__error">{error || errorMessage}</div>
            )}

            <button className="login__button" type="submit" disabled={loading}>
              {loading ? 'Please wait…' : mode === 'signup' ? 'Create Account' : 'Sign In'}
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
              {mode === 'signup' ? 'Already have an account? Sign In' : "New here? Create Account"}
            </button>
          </form>

          <div className="login__footer">
            <p className="login__legal">
              <a href="/guides/">Guides</a>
              <span aria-hidden="true"> · </span>
              <a href="/privacy.html">Privacy Policy</a>
              <span aria-hidden="true"> · </span>
              <a href="/terms.html">Terms of Service</a>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

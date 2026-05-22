import { useState } from 'react';
import './Login.css';

interface LoginProps {
  onSignIn: (username: string, password: string) => void;
  onSignUp: (username: string, password: string) => void;
  loading?: boolean;
  errorMessage?: string;
}

export function Login({ onSignIn, onSignUp, loading = false, errorMessage = '' }: LoginProps) {
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
    <div className="login">
      <div className="login__container">
        <div className="login__header">
          <div className="login__wordmark">
            <span className="login__wordmark-dot" />
            <span className="login__wordmark-text">Showrunner</span>
          </div>
          <p className="login__tagline">Professional show management for live events</p>
          <p className="login__subtitle">
            {mode === 'signup' ? 'Create an account — your data is encrypted and stays private.' : 'Sign in to access your shows, lineup, and schedule.'}
          </p>
        </div>

        <form className="login__form" onSubmit={handleSubmit}>
          <div className="login__field">
            <label className="login__label">Username</label>
            <input
              className="login__input"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Enter username"
              disabled={loading}
              autoFocus
            />
          </div>

          <div className="login__field">
            <label className="login__label">Password</label>
            <input
              className="login__input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              disabled={loading}
            />
          </div>

          {(error || errorMessage) && <div className="login__error">{error || errorMessage}</div>}

          <button
            className="login__button"
            type="submit"
            disabled={loading}
          >
            {loading ? 'Please wait...' : mode === 'signup' ? 'Create Account' : 'Sign In'}
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
            {mode === 'signup' ? 'Already have an account? Sign In' : 'New here? Create Account'}
          </button>
        </form>

        <div className="login__footer">
          <p className="login__note">
            💾 Your data is encrypted and saved under your account.
          </p>
        </div>
      </div>
    </div>
  );
}

import { useState } from 'react';
import './Login.css';

interface LoginProps {
  onLogin: (password: string) => void;
  loading?: boolean;
}

export function Login({ onLogin, loading = false }: LoginProps) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (!password.trim()) {
      setError('Password is required');
      return;
    }

    if (password.length < 3) {
      setError('Password must be at least 3 characters');
      return;
    }

    onLogin(password);
  }

  return (
    <div className="login">
      <div className="login__container">
        <div className="login__header">
          <h1 className="login__title">🎬 Showrunner</h1>
          <p className="login__subtitle">Secure Show Management</p>
        </div>

        <form className="login__form" onSubmit={handleSubmit}>
          <div className="login__field">
            <label className="login__label">Enter Password</label>
            <input
              className="login__input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              disabled={loading}
              autoFocus
            />
          </div>

          {error && <div className="login__error">{error}</div>}

          <button
            className="login__button"
            type="submit"
            disabled={loading}
          >
            {loading ? 'Unlocking...' : 'Unlock'}
          </button>
        </form>

        <div className="login__footer">
          <p className="login__note">
            💾 Your data is encrypted and stored securely. Use the same password on any device to access your shows.
          </p>
        </div>
      </div>
    </div>
  );
}

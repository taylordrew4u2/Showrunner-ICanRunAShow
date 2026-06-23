import { useState } from 'react';
import './Login.css';

interface LoginProps {
  onSignIn: (username: string, password: string) => void;
  onSignUp: (username: string, password: string) => void;
  loading?: boolean;
  errorMessage?: string;
}

const FEATURES = [
  {
    icon: '🎤',
    title: 'Build the lineup',
    text: 'Order performers, attach walk-on music, and keep every cue in one place.',
  },
  {
    icon: '📸',
    title: 'Import by photo',
    text: 'Snap a printed run-of-show and let it parse the schedule for you.',
  },
  {
    icon: '⏱️',
    title: 'Run it live',
    text: 'Full-screen live mode with per-cue countdowns keeps the night on time.',
  },
  {
    icon: '🔗',
    title: 'Share a viewer link',
    text: 'Broadcast the on-stage state to your team with a public link — no login.',
  },
];

const STEPS = [
  { num: '1', title: 'Plan', text: 'Create a show and build the lineup, staff, and schedule.' },
  { num: '2', title: 'Prep', text: 'Import a schedule, add walk-on music, and collect artist details.' },
  { num: '3', title: 'Run', text: 'Go live with cue timing and broadcast to your team.' },
];

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

  function scrollToAuth() {
    document.getElementById('login-auth')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  return (
    <div className="landing">
      <header className="landing__nav">
        <div className="landing__wordmark">
          <span className="landing__wordmark-dot" />
          <span className="landing__wordmark-text">I Can Run A Show</span>
        </div>
        <button type="button" className="landing__nav-cta" onClick={scrollToAuth}>
          Sign in
        </button>
      </header>

      <section className="landing__hero">
        <div className="landing__hero-copy">
          <span className="landing__badge">For live-event coordinators</span>
          <h1 className="landing__headline">
            Run a flawless show, <span className="landing__headline-accent">from lineup to last cue.</span>
          </h1>
          <p className="landing__lede">
            One tool for the full live-show lifecycle — build the lineup, import the schedule,
            and operate the night in real time with per-cue countdowns and a live viewer link.
          </p>

          <ul className="landing__highlights">
            <li>🎤 Lineups &amp; walk-on music</li>
            <li>📸 Photo &amp; PDF schedule import</li>
            <li>⏱️ Live mode with cue timing</li>
            <li>🔒 Encrypted, private by default</li>
          </ul>

          <div className="landing__hero-actions">
            <button type="button" className="landing__cta" onClick={scrollToAuth}>
              Get started — it's free
            </button>
            <span className="landing__cta-note">Installable as an app · works offline</span>
          </div>
        </div>

        <div className="landing__auth" id="login-auth">
          <div className="login__container">
            <div className="login__header">
              <h2 className="login__title">{mode === 'signup' ? 'Create your account' : 'Welcome back'}</h2>
              <p className="login__subtitle">
                {mode === 'signup'
                  ? 'Your data is encrypted and stays private.'
                  : 'Sign in to access your shows, lineup, and schedule.'}
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
                  autoComplete="username"
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
                  autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                />
              </div>

              {(error || errorMessage) && <div className="login__error">{error || errorMessage}</div>}

              <button className="login__button" type="submit" disabled={loading}>
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
              <p className="login__note">💾 Your data is encrypted and saved under your account.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="landing__features" aria-label="Features">
        <h2 className="landing__section-title">Everything you need on show night</h2>
        <div className="landing__feature-grid">
          {FEATURES.map((f) => (
            <article key={f.title} className="landing__feature">
              <span className="landing__feature-icon" aria-hidden="true">{f.icon}</span>
              <h3 className="landing__feature-title">{f.title}</h3>
              <p className="landing__feature-text">{f.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="landing__steps" aria-label="How it works">
        <h2 className="landing__section-title">How it works</h2>
        <div className="landing__step-grid">
          {STEPS.map((s) => (
            <div key={s.num} className="landing__step">
              <span className="landing__step-num">{s.num}</span>
              <div>
                <h3 className="landing__step-title">{s.title}</h3>
                <p className="landing__step-text">{s.text}</p>
              </div>
            </div>
          ))}
        </div>
        <div className="landing__steps-cta">
          <button type="button" className="landing__cta" onClick={scrollToAuth}>
            Create your first show
          </button>
        </div>
      </section>

      <footer className="landing__footer-bar">
        <span className="landing__wordmark-dot" />
        <span>I Can Run A Show — show management for live events</span>
      </footer>
    </div>
  );
}

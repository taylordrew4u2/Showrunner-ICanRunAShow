import { useState } from 'react';
import { Icon } from './Icon';
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
    <div className="landing">
      <div className="landing__center">
        <div className="landing__wordmark">
          <span className="landing__wordmark-dot" />
          <span className="landing__wordmark-text">I Can Run A Show</span>
        </div>

        <h1 className="landing__headline">
          Run a flawless show,{' '}
          <span className="landing__headline-accent">from lineup to last cue.</span>
        </h1>

        <p className="landing__lede">
          Build the lineup, import the schedule, and operate the night in real time.
        </p>

        <div className="login__container">
          <div className="login__header">
            <h2 className="login__title">
              {mode === 'signup' ? 'Create your account' : 'Welcome back'}
            </h2>
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
            {/* Three specifics beat one vague reassurance. This is the first
                screen anyone sees, and it's where they decide whether their
                real show is safe to put in here. */}
            <ul className="login__trust">
              <li>
                <Icon name="lock" size={13} aria-hidden />
                Encrypted on your device — your password is never stored
              </li>
              <li>
                <Icon name="cloud" size={13} aria-hidden />
                Saves as you work, and retries if the venue Wi-Fi drops
              </li>
              <li>
                <Icon name="download" size={13} aria-hidden />
                Export a full copy of everything, anytime
              </li>
            </ul>
            <p className="login__legal">
              <a href="/guides/">Guides</a>
              <span aria-hidden="true"> · </span>
              <a href="/privacy.html">Privacy Policy</a>
              <span aria-hidden="true"> · </span>
              <a href="/terms.html">Terms of Service</a>
            </p>
          </div>
        </div>

        <section className="landing__section" aria-label="What I Can Run A Show does">
          <h2 className="landing__section-title">Everything a live show needs, in one place</h2>
          <div className="landing__features">
            <div className="landing__feature">
              <h3>Lineups &amp; Rolodex</h3>
              <p>Book performers with credits, socials, and walk-on music. Every act you've worked with stays in your Rolodex for the next show.</p>
            </div>
            <div className="landing__feature">
              <h3>Run-of-show builder</h3>
              <p>Cue-by-cue schedules with times, notes, and drag-to-reorder. Import an existing schedule from a photo or PDF.</p>
            </div>
            <div className="landing__feature">
              <h3>Live show mode</h3>
              <p>A full-screen countdown timer with on-stage and up-next cards — plus a public live view your performers can watch from the green room.</p>
            </div>
            <div className="landing__feature">
              <h3>Expenses &amp; recaps</h3>
              <p>Track what each show costs and how it went, so the next one is easier to plan and price.</p>
            </div>
            <div className="landing__feature">
              <h3>Private by design</h3>
              <p>Your show data is encrypted on your device before it's stored. No email required to sign up.</p>
            </div>
          </div>
        </section>

        <section className="landing__section" aria-label="Guides">
          <h2 className="landing__section-title">Guides for producers</h2>
          <ul className="landing__guides">
            <li><a href="/guides/how-to-build-a-run-of-show.html">How to build a run-of-show for a live comedy show</a></li>
            <li><a href="/guides/keep-your-show-on-time.html">How to keep a live show on time (without being the bad guy)</a></li>
            <li><a href="/guides/first-show-checklist.html">The first-time producer's checklist</a></li>
            <li><a href="/guides/booking-a-balanced-lineup.html">How to book a balanced lineup</a></li>
          </ul>
        </section>

        <section className="landing__section" aria-label="Frequently asked questions">
          <h2 className="landing__section-title">FAQ</h2>
          <dl className="landing__faq">
            <dt>Who is this for?</dt>
            <dd>Comedians, drag promoters, burlesque and variety producers, open-mic hosts — anyone who runs live shows and is tired of juggling notes apps, spreadsheets, and group chats.</dd>
            <dt>How much does it cost?</dt>
            <dd>It's free to use.</dd>
            <dt>Do my performers need accounts?</dt>
            <dd>No. The public live viewer link works in any browser with no account.</dd>
            <dt>Does it work on my phone?</dt>
            <dd>Yes. It's built phone-first and installs to your home screen like a native app, and it keeps working when the venue Wi-Fi doesn't.</dd>
            <dt>What happens to my data?</dt>
            <dd>It's encrypted on your device with a key derived from your password before it's stored — we can't read it. You can export a full backup anytime. See the <a href="/privacy.html">privacy policy</a>.</dd>
          </dl>
        </section>
      </div>
    </div>
  );
}

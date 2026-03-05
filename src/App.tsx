import { useState, useEffect } from 'react';
import type { Show, AppSettings } from './types';
import { DEFAULT_SETTINGS } from './types';
import { generateId } from './utils/id';
import { 
  loadEncryptedShows, 
  saveEncryptedShows,
  loadEncryptedSettings,
  saveEncryptedSettings,
  createAccount,
  authenticateUser,
  isOfflineMode,
} from './utils/secure-storage';
import { Login } from './components/Login';
import { Settings } from './components/Settings';
import { ShowCard } from './components/ShowCard';
import { ShowForm } from './components/ShowForm';
import { ShowDetail } from './components/ShowDetail';
import { Modal } from './components/Modal';
import './App.css';

type View = 'list' | 'detail' | 'settings';

type Session = {
  username: string;
  password: string;
};

const SESSION_STORAGE_KEY = 'showrunner_session';

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState('');

  const [shows, setShows] = useState<Show[]>([]);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [offlineMode, setOfflineMode] = useState(false);
  const [view, setView] = useState<View>('list');
  const [selectedShow, setSelectedShow] = useState<Show | null>(null);
  const [showForm, setShowForm] = useState(false);

  // Restore session from localStorage on mount
  useEffect(() => {
    const savedSession = localStorage.getItem(SESSION_STORAGE_KEY);
    if (savedSession) {
      try {
        const parsed = JSON.parse(savedSession) as Session;
        setSession(parsed);
      } catch (error) {
        console.error('Failed to restore session:', error);
        localStorage.removeItem(SESSION_STORAGE_KEY);
      }
    }
  }, []);

  // Load data for signed in user
  useEffect(() => {
    if (!session) return;
    const currentSession = session;

    async function loadData() {
      try {
        const [loadedShows, loadedSettings] = await Promise.all([
          loadEncryptedShows(currentSession.username, currentSession.password),
          loadEncryptedSettings(currentSession.username, currentSession.password),
        ]);
        setShows(loadedShows);
        setSettings(loadedSettings);
        setOfflineMode(isOfflineMode());
      } catch (error) {
        console.error('Failed to load shows:', error);
        setShows([]);
        setSettings(DEFAULT_SETTINGS);
      }
    }

    loadData();
  }, [session]);

  // Save shows when changed
  useEffect(() => {
    if (!session || shows.length === 0) return;
    const currentSession = session;

    const timeout = setTimeout(async () => {
      try {
        await saveEncryptedShows(shows, currentSession.username, currentSession.password);
      } catch (error) {
        console.error('Failed to save shows:', error);
      }
    }, 1000); // Debounce saves

    return () => clearTimeout(timeout);
  }, [shows, session]);

  async function handleSignIn(username: string, password: string) {
    setAuthError('');
    setAuthLoading(true);

    try {
      const isValid = await authenticateUser(username, password);

      if (!isValid) {
        setAuthError('Invalid username or password');
        return;
      }

      const newSession = { username, password };
      setSession(newSession);
      localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(newSession));
      setOfflineMode(isOfflineMode());
    } catch (error) {
      console.error('Sign in failed:', error);
      setAuthError('Failed to sign in. Please try again.');
    } finally {
      setAuthLoading(false);
    }
  }

  async function handleSignUp(username: string, password: string) {
    setAuthError('');
    setAuthLoading(true);

    try {
      await createAccount(username, password);
      const newSession = { username, password };
      setSession(newSession);
      localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(newSession));
      setOfflineMode(isOfflineMode());
    } catch (error) {
      console.error('Sign up failed:', error);
      const message = error instanceof Error ? error.message : '';
      if (message === 'ACCOUNT_EXISTS') {
        setAuthError('Account already exists. Please sign in.');
      } else {
        setAuthError('Failed to create account. Please try again.');
      }
    } finally {
      setAuthLoading(false);
    }
  }

  function handleLogout() {
    setSession(null);
    localStorage.removeItem(SESSION_STORAGE_KEY);
    setShows([]);
    setSettings(DEFAULT_SETTINGS);
    setView('list');
    setSelectedShow(null);
    setShowForm(false);
    setAuthError('');
    setOfflineMode(false);
  }

  async function handleSaveSettings(updatedSettings: AppSettings) {
    if (!session) return;

    setSettingsSaving(true);
    try {
      await saveEncryptedSettings(updatedSettings, session.username, session.password);
      setSettings(updatedSettings);
      setView('list');
    } catch (error) {
      console.error('Failed to save settings:', error);
      alert('Failed to save settings. Please try again.');
    } finally {
      setSettingsSaving(false);
    }
  }

  function handleCreateShow(data: Omit<Show, 'id' | 'createdAt' | 'updatedAt' | 'scenes'>) {
    const newShow: Show = {
      ...data,
      id: generateId(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      scenes: [],
    };
    setShows((prev) => [newShow, ...prev]);
    setShowForm(false);
  }

  function handleDeleteShow(id: string) {
    setShows((prev) => {
      const updatedShows = prev.filter((s) => s.id !== id);
      
      // Recalculate totalSpent across remaining shows
      const totalSpent = updatedShows.reduce((sum, show) => {
        const showTotal = show.expenses.reduce((expSum, exp) => expSum + exp.cost, 0);
        return sum + showTotal;
      }, 0);
      
      // Update settings with new totalSpent
      if (settings.totalSpent !== totalSpent && session) {
        const updatedSettings = { ...settings, totalSpent };
        setSettings(updatedSettings);
        saveEncryptedSettings(updatedSettings, session.username, session.password).catch(console.error);
      }
      
      return updatedShows;
    });
  }

  function handleSelectShow(show: Show) {
    setSelectedShow(show);
    setView('detail');
  }

  function handleUpdateShow(updated: Show) {
    setShows((prev) => {
      const updatedShows = prev.map((s) => (s.id === updated.id ? updated : s));
      
      // Recalculate totalSpent across all shows
      const totalSpent = updatedShows.reduce((sum, show) => {
        const showTotal = show.expenses.reduce((expSum, exp) => expSum + exp.cost, 0);
        return sum + showTotal;
      }, 0);
      
      // Update settings with new totalSpent
      if (settings.totalSpent !== totalSpent && session) {
        const updatedSettings = { ...settings, totalSpent };
        setSettings(updatedSettings);
        saveEncryptedSettings(updatedSettings, session.username, session.password).catch(console.error);
      }
      
      return updatedShows;
    });
    setSelectedShow(updated);
  }

  function handleBack() {
    setView('list');
    setSelectedShow(null);
  }

  const inShowsArea = view === 'list' || view === 'detail';
  const appTitle =
    view === 'detail'
      ? selectedShow?.name ?? 'Show details'
      : view === 'settings'
        ? 'Settings'
        : 'Showrunner';

  return (
    <>
      {!session ? (
        <Login
          onSignIn={handleSignIn}
          onSignUp={handleSignUp}
          loading={authLoading}
          errorMessage={authError}
        />
      ) : (
        <div className="app">
          <header className="app-header">
            <div className="app-header__inner">
              <div className="app-header__left">
                {view === 'detail' && (
                  <button
                    className="app-header__icon-btn"
                    onClick={handleBack}
                    aria-label="Back to shows"
                  >
                    ←
                  </button>
                )}
                <h1 className="app-header__title">{appTitle}</h1>
              </div>
              <div className="app-header__actions">
                {view === 'list' && (
                  <button
                    className="btn btn--primary app-header__new-show"
                    onClick={() => setShowForm(true)}
                  >
                    + New
                  </button>
                )}
                <button
                  className="app-header__icon-btn"
                  onClick={handleLogout}
                  title="Logout"
                  aria-label="Logout"
                >
                  🔓
                </button>
              </div>
            </div>
          </header>

          <main className="app-main">
            {offlineMode && (
              <div className="offline-banner">
                📴 Offline mode - data is saved locally on this device.
              </div>
            )}
            {view === 'list' && (
              <div className="shows-list">
                {shows.length === 0 ? (
                  <div className="empty-state">
                    <div className="empty-state__icon">🎬</div>
                    <h2>No shows yet</h2>
                    <p>Tap <strong>+ New Show</strong> to get started.</p>
                  </div>
                ) : (
                  <div className="shows-grid">
                    {shows.map((show) => (
                      <ShowCard
                        key={show.id}
                        show={show}
                        onSelect={handleSelectShow}
                        onDelete={handleDeleteShow}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}

            {view === 'detail' && selectedShow && (
              <ShowDetail
                show={selectedShow}
                settings={settings}
                onBack={handleBack}
                onUpdate={handleUpdateShow}
              />
            )}

            {view === 'settings' && (
              <Settings
                settings={settings}
                onSave={handleSaveSettings}
                onBack={handleBack}
                saving={settingsSaving}
              />
            )}
          </main>

          <nav className="bottom-nav" aria-label="Primary navigation">
            <button
              className={`bottom-nav__item ${inShowsArea ? 'is-active' : ''}`}
              onClick={handleBack}
              aria-current={inShowsArea ? 'page' : undefined}
            >
              <span className="bottom-nav__icon" aria-hidden="true">🎬</span>
              <span className="bottom-nav__label">Shows</span>
            </button>

            <button
              className="bottom-nav__item bottom-nav__item--action"
              onClick={() => setShowForm(true)}
              aria-label="Create a new show"
            >
              <span className="bottom-nav__icon" aria-hidden="true">➕</span>
              <span className="bottom-nav__label">New</span>
            </button>

            <button
              className={`bottom-nav__item ${view === 'settings' ? 'is-active' : ''}`}
              onClick={() => {
                setView('settings');
                setSelectedShow(null);
              }}
              aria-current={view === 'settings' ? 'page' : undefined}
            >
              <span className="bottom-nav__icon" aria-hidden="true">⚙️</span>
              <span className="bottom-nav__label">Settings</span>
            </button>
          </nav>

          {showForm && (
            <Modal onClose={() => setShowForm(false)}>
              <ShowForm
                onSave={handleCreateShow}
                onCancel={() => setShowForm(false)}
              />
            </Modal>
          )}
        </div>
      )}
    </>
  );
}

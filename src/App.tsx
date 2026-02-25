import { useState, useEffect } from 'react';
import type { Show } from './types';
import { generateId } from './utils/id';
import { 
  loadEncryptedShows, 
  saveEncryptedShows,
  initializeUser,
  verifyUserPassword,
} from './utils/secure-storage';
import { Login } from './components/Login';
import { ShowCard } from './components/ShowCard';
import { ShowForm } from './components/ShowForm';
import { ShowDetail } from './components/ShowDetail';
import { Modal } from './components/Modal';
import './App.css';

type View = 'list' | 'detail';

export default function App() {
  const [password, setPassword] = useState<string | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);
  
  const [shows, setShows] = useState<Show[]>([]);
  const [view, setView] = useState<View>('list');
  const [selectedShow, setSelectedShow] = useState<Show | null>(null);
  const [showForm, setShowForm] = useState(false);

  // Load data when password is set
  useEffect(() => {
    if (!password) return;

    async function loadData() {
      try {
        const loadedShows = await loadEncryptedShows(password as string);
        setShows(loadedShows);
      } catch (error) {
        console.error('Failed to load shows:', error);
        setShows([]);
      }
    }

    loadData();
  }, [password]);

  // Save shows when changed
  useEffect(() => {
    if (!password || shows.length === 0) return;

    const timeout = setTimeout(async () => {
      try {
        await saveEncryptedShows(shows, password as string);
      } catch (error) {
        console.error('Failed to save shows:', error);
      }
    }, 1000); // Debounce saves

    return () => clearTimeout(timeout);
  }, [shows, password]);

  async function handleLogin(pwd: string) {
    setLoggingIn(true);

    try {
      // Try to verify existing user
      const isExisting = await verifyUserPassword(pwd);
      
      if (!isExisting) {
        // New user - initialize
        await initializeUser(pwd);
      }

      setPassword(pwd);
    } catch (error) {
      console.error('Login failed:', error);
      alert('Failed to access secure storage. Please try again.');
    } finally {
      setLoggingIn(false);
    }
  }

  function handleLogout() {
    setPassword(null);
    setShows([]);
    setView('list');
    setSelectedShow(null);
    setShowForm(false);
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
    setShows((prev) => prev.filter((s) => s.id !== id));
  }

  function handleSelectShow(show: Show) {
    setSelectedShow(show);
    setView('detail');
  }

  function handleUpdateShow(updated: Show) {
    setShows((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
    setSelectedShow(updated);
  }

  function handleBack() {
    setView('list');
    setSelectedShow(null);
  }

  return (
    <>
      {!password ? (
        <Login onLogin={handleLogin} loading={loggingIn} />
      ) : (
        <div className="app">
          <header className="app-header">
            <div className="app-header__inner">
              <button
                className="app-header__logo"
                onClick={handleBack}
                aria-label="Go to shows list"
              >
                🎬 <span>Showrunner</span>
              </button>
              {view === 'list' && (
                <div className="app-header__actions">
                  <button
                    className="btn btn--primary"
                    onClick={() => setShowForm(true)}
                  >
                    + New Show
                  </button>
                  <button
                    className="btn btn--ghost"
                    onClick={handleLogout}
                    title="Logout"
                  >
                    🔓
                  </button>
                </div>
              )}
            </div>
          </header>

          <main className="app-main">
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
                onBack={handleBack}
                onUpdate={handleUpdateShow}
              />
            )}
          </main>

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

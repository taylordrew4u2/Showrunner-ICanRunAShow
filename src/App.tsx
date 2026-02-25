import { useState, useEffect } from 'react';
import type { Show, AppSettings } from './types';
import { DEFAULT_SETTINGS } from './types';
import { loadShows, saveShows, saveShow, deleteShow, loadSettings } from './utils/storage';
import { generateId } from './utils/id';
import { ShowCard } from './components/ShowCard';
import { ShowForm } from './components/ShowForm';
import { ShowDetail } from './components/ShowDetail';
import { Settings } from './components/Settings';
import { Modal } from './components/Modal';
import './App.css';

type View = 'list' | 'detail' | 'settings';

export default function App() {
  const [shows, setShows] = useState<Show[]>(() => loadShows());
  const [view, setView] = useState<View>('list');
  const [selectedShow, setSelectedShow] = useState<Show | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());

  useEffect(() => {
    saveShows(shows);
  }, [shows]);

  // Reload settings when returning to list
  useEffect(() => {
    if (view === 'list') {
      setSettings(loadSettings());
    }
  }, [view]);

  function handleCreateShow(data: Pick<Show, 'name' | 'date' | 'time' | 'location' | 'venueName'>) {
    const now = new Date().toISOString();
    const newShow: Show = {
      ...data,
      id: generateId(),
      status: 'upcoming',
      performers: [],
      artists: [],
      schedule: [],
      hosts: [],
      djSongs: [],
      staff: [],
      expenses: [],
      createdAt: now,
      updatedAt: now,
    };
    setShows((prev) => [newShow, ...prev]);
    setShowForm(false);
    setSelectedShow(newShow);
    setView('detail');
  }

  function handleDeleteShow(id: string) {
    setShows((prev) => prev.filter((s) => s.id !== id));
  }

  function handleSelectShow(show: Show) {
    setSelectedShow(show);
    setView('detail');
  }

  function handleUpdateShow(updated: Show) {
    const withTimestamp = { ...updated, updatedAt: new Date().toISOString() };
    setShows((prev) => prev.map((s) => (s.id === withTimestamp.id ? withTimestamp : s)));
    setSelectedShow(withTimestamp);
  }

  function handleBack() {
    setView('list');
    setSelectedShow(null);
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-header__inner">
          <button
            className="app-header__logo"
            onClick={handleBack}
            aria-label="Go to shows list"
          >
            🎤 <span>{settings.brandName || 'Show Producer'}</span>
          </button>
          <div className="app-header__actions">
            {view === 'list' && (
              <button
                className="btn btn--ghost"
                onClick={() => setView('settings')}
                title="Settings"
              >
                ⚙️
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="app-main">
        {view === 'list' && (
          <div className="shows-list">
            {/* Brand header */}
            <div className="brand-header">
              <h1 className="brand-header__name">{settings.brandName || 'Show Producer'}</h1>
              {settings.producerNames && (
                <p className="brand-header__producers">Producers: {settings.producerNames}</p>
              )}
              {settings.rules && (
                <p className="brand-header__rules">{settings.rules}</p>
              )}
            </div>

            {/* Create button */}
            <button
              className="btn btn--primary create-show-btn"
              onClick={() => setShowForm(true)}
            >
              + Create a Show
            </button>

            {shows.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state__icon">🎤</div>
                <h2>No shows yet</h2>
                <p>Tap <strong>+ Create a Show</strong> to get started.</p>
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

        {view === 'settings' && (
          <Settings onBack={handleBack} />
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
  );
}

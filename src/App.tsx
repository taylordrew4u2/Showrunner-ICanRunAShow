import { useState, useEffect } from 'react';
import type { Show } from './types';
import { loadShows, saveShows } from './utils/storage';
import { generateId } from './utils/id';
import { ShowCard } from './components/ShowCard';
import { ShowForm } from './components/ShowForm';
import { ShowDetail } from './components/ShowDetail';
import { Modal } from './components/Modal';
import './App.css';

type View = 'list' | 'detail';

export default function App() {
  const [shows, setShows] = useState<Show[]>(() => loadShows());
  const [view, setView] = useState<View>('list');
  const [selectedShow, setSelectedShow] = useState<Show | null>(null);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    saveShows(shows);
  }, [shows]);

  function handleCreateShow(data: Omit<Show, 'id' | 'createdAt' | 'scenes'>) {
    const newShow: Show = {
      ...data,
      id: generateId(),
      createdAt: new Date().toISOString(),
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
            <button
              className="btn btn--primary"
              onClick={() => setShowForm(true)}
            >
              + New Show
            </button>
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
  );
}

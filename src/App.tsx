import { useState, useEffect, useRef } from 'react';
import type { Show, AppSettings, PotentialComic } from './types';
import { DEFAULT_SETTINGS } from './types';
import { generateId } from './utils/id';
import { 
  loadEncryptedShows, 
  saveEncryptedShows,
  loadEncryptedSettings,
  saveEncryptedSettings,
  exportUserData,
  createAccount,
  authenticateUser,
} from './utils/secure-storage';
import { Login } from './components/Login';
import { Settings } from './components/Settings';
import { ShowCard } from './components/ShowCard';
import { ShowForm } from './components/ShowForm';
import { ShowDetail } from './components/ShowDetail';
import { Expenses } from './components/Expenses';
import { Modal } from './components/Modal';
import { RolodexProfile } from './components/sections/RolodexProfile';
import './App.css';

type View = 'list' | 'detail' | 'settings' | 'expenses' | 'rolodex';

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
  const dataLoaded = useRef(false);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [view, setView] = useState<View>('list');
  const [selectedShow, setSelectedShow] = useState<Show | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [newComicName, setNewComicName] = useState('');
  const [newComicNotes, setNewComicNotes] = useState('');
  const [selectedComicId, setSelectedComicId] = useState<string | null>(null);

  // Restore session from localStorage on mount (persists until logout)
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
        // Ensure backward compatibility: add files array if missing
        const migratedShows = loadedShows.map((show) => ({
          ...show,
          files: show.files || [],
        }));

        // Migrate per-show expenses into global settings.expenses
        let migratedSettings = { ...loadedSettings, expenses: loadedSettings.expenses || [] };
        const perShowExpenses = migratedShows.flatMap((s) => s.expenses || []);
        if (perShowExpenses.length > 0) {
          const existingIds = new Set(migratedSettings.expenses.map((e: { id: string }) => e.id));
          const newExpenses = perShowExpenses.filter((e) => !existingIds.has(e.id));
          if (newExpenses.length > 0) {
            migratedSettings = { ...migratedSettings, expenses: [...migratedSettings.expenses, ...newExpenses] };
          }
          // Clear per-show expenses after migration
          for (const show of migratedShows) {
            show.expenses = [];
          }
        }

        setShows(migratedShows);
        setSettings(migratedSettings);
        dataLoaded.current = true;
      } catch (error) {
        console.error('Failed to load shows:', error);
        // Never overwrite in-memory shows on load failure — leave state unchanged
        // so the auto-save effect cannot wipe the database.
      }
    }

    loadData();
  }, [session]);

  // Save shows when changed
  useEffect(() => {
    if (!session || !dataLoaded.current) return;
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

  // Close menu when clicking outside
  useEffect(() => {
    if (!menuOpen) return;

    function handleClickOutside(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (!target.closest('.bottom-nav')) {
        setMenuOpen(false);
      }
    }

    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [menuOpen]);

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
    dataLoaded.current = false;
    setShows([]);
    setSettings(DEFAULT_SETTINGS);
    setView('list');
    setSelectedShow(null);
    setShowForm(false);
    setAuthError('');
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

  function handleCreateShow(data: Omit<Show, 'id' | 'createdAt' | 'updatedAt' | 'scenes' | 'files'>) {
    const newShow: Show = {
      ...data,
      id: generateId(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      scenes: [],
      files: [],
    };
    setShows((prev) => [newShow, ...prev]);
    setShowForm(false);
  }

  function handleDeleteShow(id: string) {
    setShows((prev) => {
      const showToDelete = prev.find((s) => s.id === id);
      if (!showToDelete) return prev;
      
      const updatedShows = prev.filter((s) => s.id !== id);
      
      // Recalculate totalSpent across remaining shows
      const totalSpent = updatedShows.reduce((sum, show) => {
        const showTotal = show.expenses.reduce((expSum, exp) => expSum + exp.cost, 0);
        return sum + showTotal;
      }, 0);
      
      // Move to trash instead of permanent deletion
      const deletedItem = {
        id: generateId(),
        type: 'show' as const,
        data: showToDelete,
        deletedAt: new Date().toISOString(),
      };
      
      const updatedSettings = { 
        ...settings, 
        totalSpent,
        trash: [deletedItem, ...(settings.trash || [])],
      };
      setSettings(updatedSettings);
      
      if (session) {
        saveEncryptedSettings(updatedSettings, session.username, session.password).catch(console.error);
      }
      
      return updatedShows;
    });
  }

  function handleRecoverShow(trashItemId: string) {
    const trashItem = (settings.trash || []).find((item) => item.id === trashItemId);
    if (!trashItem || trashItem.type !== 'show') return;

    // Add show back to list
    setShows((prev) => [trashItem.data, ...prev]);

    // Remove from trash
    const updatedSettings = {
      ...settings,
      trash: (settings.trash || []).filter((item) => item.id !== trashItemId),
    };
    setSettings(updatedSettings);

    if (session) {
      saveEncryptedSettings(updatedSettings, session.username, session.password).catch(console.error);
    }
  }

  function handlePermanentlyDeleteShow(trashItemId: string) {
    const updatedSettings = {
      ...settings,
      trash: (settings.trash || []).filter((item) => item.id !== trashItemId),
    };
    setSettings(updatedSettings);

    if (session) {
      saveEncryptedSettings(updatedSettings, session.username, session.password).catch(console.error);
    }
  }

  function handleAddPotentialComic() {
    const trimmedName = newComicName.trim();
    const trimmedNotes = newComicNotes.trim();
    if (!trimmedName || !session) return;

    const newComic: PotentialComic = {
      id: generateId(),
      name: trimmedName,
      notes: trimmedNotes || undefined,
    };

    const updatedSettings = {
      ...settings,
      potentialComics: [newComic, ...settings.potentialComics],
    };

    setSettings(updatedSettings);
    saveEncryptedSettings(updatedSettings, session.username, session.password).catch(console.error);
    setNewComicName('');
    setNewComicNotes('');
  }

  function handleSavePerformerToRolodex(comic: PotentialComic) {
    if (!session) return;
    const existing = settings.potentialComics.find(c => c.name.toLowerCase() === comic.name.toLowerCase());
    const updated = existing
      ? settings.potentialComics.map(c => c.id === existing.id ? { ...c, ...comic, id: c.id } : c)
      : [comic, ...settings.potentialComics];
    const updatedSettings = { ...settings, potentialComics: updated };
    setSettings(updatedSettings);
    saveEncryptedSettings(updatedSettings, session.username, session.password).catch(console.error);
  }

  function handleUpdateRolodexComic(updated: PotentialComic) {
    if (!session) return;
    const updatedComics = settings.potentialComics.map(c => c.id === updated.id ? updated : c);
    const updatedSettings = { ...settings, potentialComics: updatedComics };
    setSettings(updatedSettings);
    saveEncryptedSettings(updatedSettings, session.username, session.password).catch(console.error);

    // Sync matching performers in all shows (match by name, update profile fields)
    setShows(prev =>
      prev.map(show => ({
        ...show,
        performers: show.performers.map(p =>
          p.name.toLowerCase() === updated.name.toLowerCase()
            ? {
                ...p,
                photo: updated.photo ?? p.photo,
                socialMedia: updated.socialMedia ?? p.socialMedia,
                credits: updated.credits ?? p.credits,
                walkOnMusic: updated.walkOnMusic ?? p.walkOnMusic,
                walkOnMusicName: updated.walkOnMusicName ?? p.walkOnMusicName,
                walkOnMusicArtist: updated.walkOnMusicArtist ?? p.walkOnMusicArtist,
                walkOnMusicTimestamp: updated.walkOnMusicTimestamp ?? p.walkOnMusicTimestamp,
                walkOnMusicLink: updated.walkOnMusicLink ?? p.walkOnMusicLink,
              }
            : p
        ),
      }))
    );
  }

  function handleRemovePotentialComic(id: string) {
    if (!session) return;

    const updatedSettings = {
      ...settings,
      potentialComics: settings.potentialComics.filter((comic) => comic.id !== id),
    };

    setSettings(updatedSettings);
    saveEncryptedSettings(updatedSettings, session.username, session.password).catch(console.error);
  }

  function handleUpdateShow(updated: Show) {
    setShows((prev) => {
      // Ensure files array always exists and is never lost
      const safeUpdated = {
        ...updated,
        files: updated.files || [],
        // Ensure all artists have their file fields preserved
        artists: (updated.artists || []).map(a => ({
          ...a,
          file: a.file,
          fileName: a.fileName
        })),
        // Ensure all performers have their file fields preserved
        performers: (updated.performers || []).map(p => ({
          ...p,
          walkOnMusic: p.walkOnMusic,
          walkOnMusicName: p.walkOnMusicName,
          photo: p.photo,
          video: p.video
        }))
      };
      const updatedShows = prev.map((s) => (s.id === safeUpdated.id ? safeUpdated : s));
      
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
    // Update selectedShow with the safe version that preserves files
    setSelectedShow({
      ...updated,
      files: updated.files || []
    });
  }

  function handleSelectShow(show: Show) {
    setSelectedShow(show);
    setView('detail');
  }

  function handleBack() {
    setView('list');
    setSelectedShow(null);
  }

  const upcomingCount = shows.filter((show) => show.status === 'upcoming').length;
  const inProgressCount = shows.filter((show) => show.status === 'in-progress').length;
  const completedCount = shows.filter((show) => show.status === 'completed').length;
  const totalSceneCount = shows.reduce((sum, show) => sum + (show.scenes?.length ?? 0), 0);

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
          {/* Left sidebar — desktop only */}
          <nav className="sidebar" aria-label="Primary navigation">
            <div className="sidebar__brand">
              <span className="sidebar__brand-icon">🎬</span>
              <span className="sidebar__brand-name">Showrunner</span>
            </div>
            <div className="sidebar__nav-list">
              <button
                className={`sidebar__item ${(view === 'list' || view === 'detail') ? 'sidebar__item--active' : ''}`}
                onClick={handleBack}
              >
                <span className="sidebar__item-icon">🎬</span>
                <span>Shows</span>
              </button>
              <button
                className="sidebar__item"
                onClick={() => setShowForm(true)}
              >
                <span className="sidebar__item-icon">➕</span>
                <span>New Show</span>
              </button>
              <button
                className={`sidebar__item ${view === 'rolodex' ? 'sidebar__item--active' : ''}`}
                onClick={() => { setView('rolodex'); setSelectedShow(null); }}
              >
                <span className="sidebar__item-icon">🎤</span>
                <span>Rolodex</span>
              </button>
              <button
                className={`sidebar__item ${view === 'expenses' ? 'sidebar__item--active' : ''}`}
                onClick={() => { setView('expenses'); setSelectedShow(null); }}
              >
                <span className="sidebar__item-icon">💰</span>
                <span>Expenses</span>
              </button>
            </div>
            <div className="sidebar__footer">
              <button
                className={`sidebar__item ${view === 'settings' ? 'sidebar__item--active' : ''}`}
                onClick={() => { setView('settings'); setSelectedShow(null); }}
              >
                <span className="sidebar__item-icon">⚙️</span>
                <span>Settings</span>
              </button>
              <button className="sidebar__item" onClick={handleLogout}>
                <span className="sidebar__item-icon">🔓</span>
                <span>Log out</span>
              </button>
            </div>
          </nav>

          <main className="app-main">
            {view === 'list' && (
              <div className="shows-list">
                <section className="bento-strip" aria-label="Show summary">
                  <article className="bento-tile bento-tile--hero">
                    <p className="bento-tile__label">Showrunner</p>
                    <h1 className="bento-tile__value">{shows.length}</h1>
                    <p className="bento-tile__meta">Total shows in your workspace</p>
                  </article>
                  <article className="bento-tile">
                    <p className="bento-tile__label">Upcoming</p>
                    <p className="bento-tile__value">{upcomingCount}</p>
                  </article>
                  <article className="bento-tile">
                    <p className="bento-tile__label">In progress</p>
                    <p className="bento-tile__value">{inProgressCount}</p>
                  </article>
                  <article className="bento-tile">
                    <p className="bento-tile__label">Completed</p>
                    <p className="bento-tile__value">{completedCount}</p>
                  </article>
                  <article className="bento-tile bento-tile--wide">
                    <p className="bento-tile__label">Total scenes</p>
                    <p className="bento-tile__value">{totalSceneCount}</p>
                    <p className="bento-tile__meta">Across all shows</p>
                  </article>
                </section>

                {shows.length === 0 ? (
                  <div className="shows-grid">
                    <div className="empty-state">
                      <div className="empty-state__icon">🎬</div>
                      <h2>No shows yet</h2>
                      <p>Tap <strong>+ New Show</strong> to get started.</p>
                    </div>
                    <div className="show-card rolodex-tile" onClick={() => setView('rolodex')}>
                      <div className="rolodex-tile__icon">🎤</div>
                      <h3 className="rolodex-tile__title">Comic Rolodex</h3>
                      <p className="rolodex-tile__count">{settings.potentialComics.length} comic{settings.potentialComics.length !== 1 ? 's' : ''}</p>
                    </div>
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
                    <div className="show-card rolodex-tile" onClick={() => setView('rolodex')}>
                      <div className="rolodex-tile__icon">🎤</div>
                      <h3 className="rolodex-tile__title">Comic Rolodex</h3>
                      <p className="rolodex-tile__count">{settings.potentialComics.length} comic{settings.potentialComics.length !== 1 ? 's' : ''}</p>
                    </div>
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
                onSaveToRolodex={handleSavePerformerToRolodex}
              />
            )}

            {view === 'expenses' && (
              <Expenses
                settings={settings}
                onBack={handleBack}
                onUpdateSettings={handleSaveSettings}
              />
            )}

            {view === 'rolodex' && (
              <div className="rolodex-page">
                <div className="rolodex-page__topbar">
                  <button className="btn btn--ghost" onClick={handleBack}>← Back</button>
                  <h2 className="rolodex-page__title">🎤 Comic Rolodex</h2>
                </div>
                <p className="rolodex-page__subtitle">Keep a running list of comics you want to book next.</p>

                <div className="rolodex__form">
                  <input
                    className="rolodex__input"
                    value={newComicName}
                    onChange={(e) => setNewComicName(e.target.value)}
                    placeholder="Comic name"
                  />
                  <input
                    className="rolodex__input"
                    value={newComicNotes}
                    onChange={(e) => setNewComicNotes(e.target.value)}
                    placeholder="Notes (style, contact, socials, etc.)"
                  />
                  <button
                    className="btn btn--secondary"
                    type="button"
                    onClick={handleAddPotentialComic}
                    disabled={!newComicName.trim()}
                  >
                    Add
                  </button>
                </div>

                {settings.potentialComics.length === 0 ? (
                  <p className="rolodex__empty">No comics saved yet.</p>
                ) : (
                  <div className="rolodex__list">
                    {settings.potentialComics.map((comic) => (
                      <article key={comic.id} className="rolodex__item">
                        {comic.photo && (
                          <img src={comic.photo} alt={comic.name} className="rolodex__photo" />
                        )}
                        {!comic.photo && (
                          <div className="rolodex__photo-placeholder">
                            {comic.name.charAt(0).toUpperCase()}
                          </div>
                        )}
                        <div className="rolodex__item-content">
                          <p className="rolodex__name">{comic.name}</p>
                          {comic.socialMedia && <p className="rolodex__meta">📱 {comic.socialMedia}</p>}
                          {(comic.walkOnMusicName || comic.walkOnMusicArtist) && (
                            <p className="rolodex__meta">🎵 {[comic.walkOnMusicName, comic.walkOnMusicArtist].filter(Boolean).join(' — ')}</p>
                          )}
                          {comic.notes && <p className="rolodex__notes">{comic.notes}</p>}
                        </div>
                        <button
                          className="btn btn--secondary btn--sm"
                          type="button"
                          onClick={() => setSelectedComicId(comic.id)}
                        >
                          Edit
                        </button>
                      </article>
                    ))}
                  </div>
                )}

                {/* Rolodex edit drawer */}
                {selectedComicId && (() => {
                  const comic = settings.potentialComics.find(c => c.id === selectedComicId);
                  if (!comic) return null;
                  return (
                    <>
                      <div className="perf-drawer__backdrop" onClick={() => setSelectedComicId(null)} />
                      <div className="perf-drawer">
                        <RolodexProfile
                          comic={comic}
                          onBack={() => setSelectedComicId(null)}
                          onChange={handleUpdateRolodexComic}
                          onDelete={id => { handleRemovePotentialComic(id); setSelectedComicId(null); }}
                        />
                      </div>
                    </>
                  );
                })()}
              </div>
            )}

            {view === 'settings' && (
              <Settings
                settings={settings}
                onSave={handleSaveSettings}
                onBack={handleBack}
                saving={settingsSaving}
                onRecoverShow={handleRecoverShow}
                onPermanentlyDelete={handlePermanentlyDeleteShow}
                onExport={session ? async () => {
                  const url = await exportUserData(session.username, session.password);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `showrunner-backup-${new Date().toISOString().slice(0, 10)}.json`;
                  a.click();
                  URL.revokeObjectURL(url);
                } : undefined}
              />
            )}
          </main>

          {/* Right panel — desktop only */}
          <aside className="right-panel">
            <div className="right-panel__cta">
              <button className="btn btn--primary btn--block" onClick={() => setShowForm(true)}>
                ➕ New Show
              </button>
            </div>
            <div className="right-panel__section">
              <h3 className="right-panel__title">Your shows</h3>
              <div className="right-panel__stats-grid">
                <div className="right-panel__stat">
                  <p className="right-panel__stat-value">{upcomingCount}</p>
                  <p className="right-panel__stat-label">Upcoming</p>
                </div>
                <div className="right-panel__stat">
                  <p className="right-panel__stat-value">{inProgressCount}</p>
                  <p className="right-panel__stat-label">In Progress</p>
                </div>
                <div className="right-panel__stat">
                  <p className="right-panel__stat-value">{completedCount}</p>
                  <p className="right-panel__stat-label">Completed</p>
                </div>
                <div className="right-panel__stat">
                  <p className="right-panel__stat-value">{totalSceneCount}</p>
                  <p className="right-panel__stat-label">Scenes</p>
                </div>
              </div>
            </div>
            {shows.length > 0 && (
              <div className="right-panel__section">
                <h3 className="right-panel__title">
                  {shows.some(s => s.status === 'upcoming') ? 'Upcoming shows' : 'Recent shows'}
                </h3>
                <div className="right-panel__show-list">
                  {(shows.some(s => s.status === 'upcoming')
                    ? shows.filter(s => s.status === 'upcoming')
                    : shows
                  ).slice(0, 3).map(show => (
                    <button
                      key={show.id}
                      className="right-panel__show-item"
                      onClick={() => handleSelectShow(show)}
                    >
                      <span className="right-panel__show-name">{show.name}</span>
                      {show.date && <span className="right-panel__show-date">{show.date}</span>}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="right-panel__user">
              <span className="right-panel__username">@{session.username}</span>
            </div>
          </aside>

          <nav className="bottom-nav" aria-label="Primary navigation">
            <button
              className="bottom-nav__menu-btn"
              onClick={() => setMenuOpen(!menuOpen)}
              aria-label="Menu"
            >
              <span className="bottom-nav__icon">☰</span>
              <span className="bottom-nav__label">Menu</span>
            </button>
            {menuOpen && (
              <div className="bottom-nav__dropdown">
                <button
                  className="bottom-nav__dropdown-item"
                  onClick={() => {
                    handleBack();
                    setMenuOpen(false);
                  }}
                >
                  <span className="bottom-nav__icon">🎬</span>
                  <span>Shows</span>
                </button>
                <button
                  className="bottom-nav__dropdown-item"
                  onClick={() => {
                    setShowForm(true);
                    setMenuOpen(false);
                  }}
                >
                  <span className="bottom-nav__icon">➕</span>
                  <span>New Show</span>
                </button>
                <button
                  className="bottom-nav__dropdown-item"
                  onClick={() => {
                    setView('expenses');
                    setSelectedShow(null);
                    setMenuOpen(false);
                  }}
                >
                  <span className="bottom-nav__icon">💰</span>
                  <span>Expenses</span>
                </button>
                <button
                  className="bottom-nav__dropdown-item"
                  onClick={() => {
                    setView('settings');
                    setSelectedShow(null);
                    setMenuOpen(false);
                  }}
                >
                  <span className="bottom-nav__icon">⚙️</span>
                  <span>Settings</span>
                </button>
                <button
                  className="bottom-nav__dropdown-item"
                  onClick={() => {
                    handleLogout();
                    setMenuOpen(false);
                  }}
                >
                  <span className="bottom-nav__icon">🔓</span>
                  <span>Logout</span>
                </button>
              </div>
            )}
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

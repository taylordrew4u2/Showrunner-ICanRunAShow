import { useState, useEffect, useRef } from 'react';
import type { Show, ShowStatus, AppSettings, PotentialComic } from './types';
import { DEFAULT_SETTINGS } from './types';
import { generateId } from './utils/id';
import { syncPerformerCover } from './utils/performer';
import { ServerNotConfiguredError } from './utils/api';
import { applyColorScheme, loadColorScheme, type ColorScheme } from './utils/theme';
import { getRolodexTerm } from './utils/terminology';
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
import { Onboarding } from './components/Onboarding';
import { Settings } from './components/Settings';
import { ShowCard } from './components/ShowCard';
import { ShowForm } from './components/ShowForm';
import { ShowDetail, type ShowDetailHandle } from './components/ShowDetail';
import { exportShowToPDF } from './utils/pdfExport';
import { Expenses } from './components/Expenses';
import { Modal } from './components/Modal';
import { RolodexProfile } from './components/sections/RolodexProfile';
import { LiveViewer } from './components/LiveViewer';
import { ArtistSignup } from './components/ArtistSignup';
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
  const [colorScheme, setColorScheme] = useState<ColorScheme>(() => loadColorScheme());

  // Apply the chosen color scheme app-wide and persist it.
  useEffect(() => {
    applyColorScheme(colorScheme);
  }, [colorScheme]);

  const [shows, setShows] = useState<Show[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [loadingData, setLoadingData] = useState(false);
  const dataLoaded = useRef(false);
  const showDetailRef = useRef<ShowDetailHandle>(null);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [onboardingSaving, setOnboardingSaving] = useState(false);
  const [view, setView] = useState<View>('list');
  const [selectedShow, setSelectedShow] = useState<Show | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [newComicName, setNewComicName] = useState('');
  const [newComicNotes, setNewComicNotes] = useState('');
  const [selectedComicId, setSelectedComicId] = useState<string | null>(null);
  const [expandOrigin, setExpandOrigin] = useState({ x: 50, y: 30 });
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | ShowStatus>('all');
  const [sortBy, setSortBy] = useState<'added' | 'date-asc' | 'date-desc' | 'name'>(() => {
    try {
      const saved = localStorage.getItem('showrunner:showSort');
      if (saved === 'added' || saved === 'date-asc' || saved === 'date-desc' || saved === 'name') {
        return saved;
      }
    } catch {
      /* ignore */
    }
    return 'added';
  });

  // Remember the sort preference so the shows list feels familiar each visit.
  useEffect(() => {
    try {
      localStorage.setItem('showrunner:showSort', sortBy);
    } catch {
      /* ignore */
    }
  }, [sortBy]);

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

    if (!dataLoaded.current) setLoadingData(true);
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
      } finally {
        setLoadingData(false);
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
        setSaveError(null);
      } catch (error) {
        console.error('Failed to save shows:', error);
        setSaveError(
          "Couldn't save your latest changes. This is usually caused by an uploaded file (often a video) being too large. Try removing it or using a link instead — your other edits are safe.",
        );
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
      setAuthError(
        error instanceof ServerNotConfiguredError
          ? "The server isn't connected to the database yet. Check the deployment's environment variables."
          : 'Failed to sign in. Please try again.',
      );
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
      if (error instanceof ServerNotConfiguredError) {
        setAuthError(
          "The server isn't connected to the database yet. Check the deployment's environment variables.",
        );
      } else if (message === 'ACCOUNT_EXISTS') {
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

  async function handleCompleteOnboarding(data: { brandName: string; showTypes: string[] }) {
    if (!session) return;
    setOnboardingSaving(true);
    // Merge onto whatever loaded for this account so we never clobber existing data.
    const updatedSettings: AppSettings = {
      ...settings,
      brandName: data.brandName || settings.brandName,
      showTypes: data.showTypes,
      onboarded: true,
    };
    try {
      await saveEncryptedSettings(updatedSettings, session.username, session.password);
      setSettings(updatedSettings);
    } catch (error) {
      console.error('Failed to save onboarding:', error);
      // Mark onboarded locally so a save hiccup doesn't trap the user on this screen.
      setSettings(updatedSettings);
    } finally {
      setOnboardingSaving(false);
    }
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
    // Drop the user straight into the new show so create → populate is continuous.
    setSelectedShow(newShow);
    setView('detail');
  }

  function handleDuplicateShow(id: string) {
    const original = shows.find((s) => s.id === id);
    if (!original) return;
    const now = new Date().toISOString();
    const copy: Show = {
      ...structuredClone(original),
      id: generateId(),
      name: `${original.name} (copy)`,
      status: 'upcoming',
      createdAt: now,
      updatedAt: now,
      date: '', // clear the date so the user picks a new one
      // Drop anything tied to the original instance, not the template.
      viewToken: undefined,
      viewNote: undefined,
      artistSignupToken: undefined,
      recap: undefined,
    };
    setShows((prev) => [copy, ...prev]);
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
        performers: show.performers.map(p => {
          if (p.name.toLowerCase() !== updated.name.toLowerCase()) return p;
          // Prefer the comic's gallery; keep the cover (photo) synced to photos[0].
          const photos = updated.photos ?? p.photos;
          const photo = (photos && photos.length) ? photos[0] : (updated.photo ?? p.photo);
          return {
            ...p,
            photo,
            photos,
            socialMedia: updated.socialMedia ?? p.socialMedia,
            credits: updated.credits ?? p.credits,
            walkOnMusic: updated.walkOnMusic ?? p.walkOnMusic,
            walkOnMusicName: updated.walkOnMusicName ?? p.walkOnMusicName,
            walkOnMusicArtist: updated.walkOnMusicArtist ?? p.walkOnMusicArtist,
            walkOnMusicTimestamp: updated.walkOnMusicTimestamp ?? p.walkOnMusicTimestamp,
            walkOnMusicLink: updated.walkOnMusicLink ?? p.walkOnMusicLink,
          };
        }),
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
        // Normalize each performer so the legacy `photo` cover always matches photos[0].
        performers: (updated.performers || []).map(syncPerformerCover)
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

  function handleSelectShow(show: Show, e?: React.MouseEvent) {
    if (e) {
      const main = document.querySelector('.app-main');
      const cardEl = e.currentTarget as HTMLElement;
      if (main) {
        const mainRect = main.getBoundingClientRect();
        const cardRect = cardEl.getBoundingClientRect();
        const x = ((cardRect.left + cardRect.width / 2 - mainRect.left) / mainRect.width) * 100;
        const y = ((cardRect.top + cardRect.height / 2 - mainRect.top) / mainRect.height) * 100;
        setExpandOrigin({ x: Math.max(0, Math.min(100, x)), y: Math.max(0, Math.min(100, y)) });
      }
    }
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

  // Search + status filtering for the shows list.
  const normalizedQuery = searchQuery.trim().toLowerCase();
  const filteredShows = shows.filter((show) => {
    if (statusFilter !== 'all' && show.status !== statusFilter) return false;
    if (!normalizedQuery) return true;
    return [show.name, show.venueName, show.location]
      .some((field) => field?.toLowerCase().includes(normalizedQuery));
  });
  const isFiltering = statusFilter !== 'all' || normalizedQuery !== '';

  // Sort the visible shows. Undated shows always sort to the end for date sorts.
  const sortedShows = [...filteredShows].sort((a, b) => {
    switch (sortBy) {
      case 'name':
        return a.name.localeCompare(b.name);
      case 'date-asc':
        if (!a.date && !b.date) return 0;
        if (!a.date) return 1;
        if (!b.date) return -1;
        return a.date.localeCompare(b.date);
      case 'date-desc':
        if (!a.date && !b.date) return 0;
        if (!a.date) return 1;
        if (!b.date) return -1;
        return b.date.localeCompare(a.date);
      default:
        return 0; // 'added' — preserve existing newest-first order
    }
  });

  function toggleStatusFilter(status: ShowStatus) {
    setStatusFilter((current) => (current === status ? 'all' : status));
  }

  function clearFilters() {
    setStatusFilter('all');
    setSearchQuery('');
  }

  // The three summary tiles that double as status filters.
  const statusFilterTiles: { value: ShowStatus; label: string; count: number }[] = [
    { value: 'upcoming', label: 'Upcoming', count: upcomingCount },
    { value: 'in-progress', label: 'In progress', count: inProgressCount },
    { value: 'completed', label: 'Completed', count: completedCount },
  ];

  // What this producer calls the people in their Rolodex (Comics, Queens, …),
  // derived from their show types and overridable in Settings.
  const rolodexTerm = getRolodexTerm(settings);

  const rolodexTile = (
    <div className="show-card rolodex-tile" onClick={() => setView('rolodex')}>
      <div className="rolodex-tile__icon"></div>
      <h3 className="rolodex-tile__title">{rolodexTerm.singular} Rolodex</h3>
      <p className="rolodex-tile__count">{settings.potentialComics.length} {(settings.potentialComics.length === 1 ? rolodexTerm.singular : rolodexTerm.plural).toLowerCase()}</p>
    </div>
  );

  // Public read-only routes — no auth required.
  const search = new URLSearchParams(window.location.search);
  const viewToken = search.get('view');
  if (viewToken) {
    return <LiveViewer token={viewToken} />;
  }
  const artistToken = search.get('artist');
  if (artistToken) {
    return <ArtistSignup token={artistToken} />;
  }

  return (
    <>
      {!session ? (
        <Login
          onSignIn={handleSignIn}
          onSignUp={handleSignUp}
          loading={authLoading}
          errorMessage={authError}
        />
      ) : !loadingData && !settings.onboarded ? (
        <Onboarding
          username={session.username}
          onComplete={handleCompleteOnboarding}
          saving={onboardingSaving}
        />
      ) : (
        <div className="app">
          {loadingData && (
            <div className="app-loading" role="status" aria-live="polite">
              <div className="app-loading__spinner" aria-hidden="true" />
              <div className="app-loading__text">Loading your shows…</div>
            </div>
          )}
          {saveError && (
            <div className="save-error-banner" role="alert">
              <span className="save-error-banner__text">{saveError}</span>
              <button
                className="save-error-banner__close"
                onClick={() => setSaveError(null)}
                aria-label="Dismiss"
              >
                ×
              </button>
            </div>
          )}
          {/* Left sidebar — desktop only */}
          <nav className="sidebar" aria-label="Primary navigation">
            <div className="sidebar__brand">
              <span className="sidebar__brand-dot" />
              <span className="sidebar__brand-name">Showrunner</span>
            </div>
            <div className="sidebar__nav-list">
              {view === 'detail' && selectedShow ? (
                /* Context actions for the show that's open. */
                <>
                  <button className="sidebar__item" onClick={handleBack}>
                    <span>← All shows</span>
                  </button>
                  <p className="sidebar__context-label">{selectedShow.name}</p>
                  <button className="sidebar__item" onClick={() => showDetailRef.current?.openRunShow()}>
                    <span>Run Show</span>
                  </button>
                  <button className="sidebar__item" onClick={() => showDetailRef.current?.openViewer()}>
                    <span>Viewer link</span>
                  </button>
                  {(!(selectedShow.hiddenSections || []).includes('artists') || !!selectedShow.artistSignupToken) && (
                    <button className="sidebar__item" onClick={() => showDetailRef.current?.openArtistAdmin()}>
                      <span>Artist admin</span>
                    </button>
                  )}
                  <button className="sidebar__item" onClick={() => exportShowToPDF(selectedShow, settings)}>
                    <span>Export PDF</span>
                  </button>
                </>
              ) : (
                <>
                  <button
                    className={`sidebar__item ${view === 'list' ? 'sidebar__item--active' : ''}`}
                    onClick={handleBack}
                  >
                    <span>Shows</span>
                  </button>
                  <button
                    className="sidebar__item"
                    onClick={() => setShowForm(true)}
                  >
                    <span>New Show</span>
                  </button>
                  <button
                    className={`sidebar__item ${view === 'rolodex' ? 'sidebar__item--active' : ''}`}
                    onClick={() => { setView('rolodex'); setSelectedShow(null); }}
                  >
                    <span>{rolodexTerm.singular} Rolodex</span>
                  </button>
                  <button
                    className={`sidebar__item ${view === 'expenses' ? 'sidebar__item--active' : ''}`}
                    onClick={() => { setView('expenses'); setSelectedShow(null); }}
                  >
                    <span>Expenses</span>
                  </button>
                </>
              )}
            </div>
            <div className="sidebar__footer">
              <button
                className={`sidebar__item ${view === 'settings' ? 'sidebar__item--active' : ''}`}
                onClick={() => { setView('settings'); setSelectedShow(null); }}
              >
                <span>Settings</span>
              </button>
              <button className="sidebar__item" onClick={handleLogout}>
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
                  {statusFilterTiles.map(({ value, label, count }) => (
                    <button
                      key={value}
                      type="button"
                      className={`bento-tile bento-tile--filter ${statusFilter === value ? 'bento-tile--active' : ''}`}
                      onClick={() => toggleStatusFilter(value)}
                      aria-pressed={statusFilter === value}
                    >
                      <p className="bento-tile__label">{label}</p>
                      <p className="bento-tile__value">{count}</p>
                    </button>
                  ))}
                  <article className="bento-tile bento-tile--wide">
                    <p className="bento-tile__label">Total scenes</p>
                    <p className="bento-tile__value">{totalSceneCount}</p>
                    <p className="bento-tile__meta">Across all shows</p>
                  </article>
                </section>

                {shows.length > 0 && (
                  <div className="shows-toolbar">
                    <input
                      className="shows-toolbar__search"
                      type="search"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search shows by name, venue, or location…"
                      aria-label="Search shows"
                    />
                    <div className="shows-toolbar__filters" role="group" aria-label="Filter shows by status">
                      {([
                        ['all', 'All'],
                        ['upcoming', 'Upcoming'],
                        ['in-progress', 'In progress'],
                        ['completed', 'Completed'],
                      ] as const).map(([value, label]) => (
                        <button
                          key={value}
                          type="button"
                          className={`shows-chip ${statusFilter === value ? 'shows-chip--active' : ''}`}
                          onClick={() => setStatusFilter(value)}
                          aria-pressed={statusFilter === value}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <select
                      className="shows-toolbar__sort"
                      value={sortBy}
                      onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                      aria-label="Sort shows"
                    >
                      <option value="added">Recently added</option>
                      <option value="date-asc">Date (soonest)</option>
                      <option value="date-desc">Date (latest)</option>
                      <option value="name">Name (A–Z)</option>
                    </select>
                    {isFiltering && (
                      <span className="shows-toolbar__count">
                        {filteredShows.length} of {shows.length}
                      </span>
                    )}
                  </div>
                )}

                {shows.length === 0 ? (
                  <div className="shows-grid">
                    <div className="empty-state">
                      <div className="empty-state__icon"></div>
                      <h2>No shows yet</h2>
                      <p>Tap <strong>+ New Show</strong> to get started.</p>
                    </div>
                    {rolodexTile}
                  </div>
                ) : filteredShows.length === 0 ? (
                  <div className="shows-empty-filter">
                    <p className="shows-empty-filter__text">No shows match your search.</p>
                    <button className="btn btn--secondary btn--sm" onClick={clearFilters}>
                      Clear filters
                    </button>
                  </div>
                ) : (
                  <div className="shows-grid">
                    {sortedShows.map((show) => (
                      <ShowCard
                        key={show.id}
                        show={show}
                        onSelect={handleSelectShow}
                        onDelete={handleDeleteShow}
                        onDuplicate={handleDuplicateShow}
                      />
                    ))}
                    {rolodexTile}
                  </div>
                )}
              </div>
            )}

            {view === 'detail' && selectedShow && (
              <div
                key={selectedShow.id}
                className="show-detail-expand"
                style={{ '--expand-origin-x': `${expandOrigin.x}%`, '--expand-origin-y': `${expandOrigin.y}%` } as React.CSSProperties}
              >
                <ShowDetail
                  ref={showDetailRef}
                  show={selectedShow}
                  settings={settings}
                  onBack={handleBack}
                  onUpdate={handleUpdateShow}
                  onSaveToRolodex={handleSavePerformerToRolodex}
                />
              </div>
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
                  <h2 className="rolodex-page__title">{rolodexTerm.singular} Rolodex</h2>
                </div>
                <p className="rolodex-page__subtitle">Keep a running list of {rolodexTerm.plural.toLowerCase()} you want to book next.</p>

                <div className="rolodex__form">
                  <input
                    className="rolodex__input"
                    value={newComicName}
                    onChange={(e) => setNewComicName(e.target.value)}
                    placeholder={`${rolodexTerm.singular} name`}
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
                  <p className="rolodex__empty">No {rolodexTerm.plural.toLowerCase()} saved yet.</p>
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
                          {comic.socialMedia && <p className="rolodex__meta">{comic.socialMedia}</p>}
                          {(comic.walkOnMusicName || comic.walkOnMusicArtist) && (
                            <p className="rolodex__meta">{[comic.walkOnMusicName, comic.walkOnMusicArtist].filter(Boolean).join(' — ')}</p>
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
                colorScheme={colorScheme}
                onColorSchemeChange={setColorScheme}
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
                New Show
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
                {view === 'detail' && selectedShow && (
                  <>
                    <p className="bottom-nav__dropdown-label">{selectedShow.name}</p>
                    <button
                      className="bottom-nav__dropdown-item"
                      onClick={() => { showDetailRef.current?.openRunShow(); setMenuOpen(false); }}
                    >
                      <span>Run Show</span>
                    </button>
                    <button
                      className="bottom-nav__dropdown-item"
                      onClick={() => { showDetailRef.current?.openViewer(); setMenuOpen(false); }}
                    >
                      <span>Viewer link</span>
                    </button>
                    {(!(selectedShow.hiddenSections || []).includes('artists') || !!selectedShow.artistSignupToken) && (
                      <button
                        className="bottom-nav__dropdown-item"
                        onClick={() => { showDetailRef.current?.openArtistAdmin(); setMenuOpen(false); }}
                      >
                        <span>Artist admin</span>
                      </button>
                    )}
                    <button
                      className="bottom-nav__dropdown-item"
                      onClick={() => { exportShowToPDF(selectedShow, settings); setMenuOpen(false); }}
                    >
                      <span>Export PDF</span>
                    </button>
                    <div className="bottom-nav__dropdown-divider" />
                  </>
                )}
                <button
                  className="bottom-nav__dropdown-item"
                  onClick={() => {
                    handleBack();
                    setMenuOpen(false);
                  }}
                >
                  <span>Shows</span>
                </button>
                <button
                  className="bottom-nav__dropdown-item"
                  onClick={() => {
                    setShowForm(true);
                    setMenuOpen(false);
                  }}
                >
                  <span>New Show</span>
                </button>
                <button
                  className="bottom-nav__dropdown-item"
                  onClick={() => {
                    setView('rolodex');
                    setSelectedShow(null);
                    setMenuOpen(false);
                  }}
                >
                  <span>{rolodexTerm.singular} Rolodex</span>
                </button>
                <button
                  className="bottom-nav__dropdown-item"
                  onClick={() => {
                    setView('expenses');
                    setSelectedShow(null);
                    setMenuOpen(false);
                  }}
                >
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
                  <span>Settings</span>
                </button>
                <button
                  className="bottom-nav__dropdown-item"
                  onClick={() => {
                    handleLogout();
                    setMenuOpen(false);
                  }}
                >
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

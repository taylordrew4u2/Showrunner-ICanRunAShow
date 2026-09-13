# Shared layouts

App.tsx owns the shell, status rail, primary navigation and state-based destination switching. Desktop navigation is a native popover; mobile uses the same destinations in a bottom bar. There is no separate router or sidebar component. Full shell below includes data/state logic because it is not extracted. App.css and final design.css layout styles are included in theme.md.

## Root mount, fonts/global/final CSS order, ErrorBoundary and PWA setup.

### `src/main.tsx`

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// @ts-expect-error - virtual module provided by vite-plugin-pwa
import { registerSW } from 'virtual:pwa-register'
import './fonts.css'
import './index.css'
import App from './App.tsx'
import './design.css'
import { ErrorBoundary } from './components/ErrorBoundary.tsx'
import { applyColorScheme, loadColorScheme } from './utils/theme'

// Apply the saved color scheme before the first paint to avoid a flash.
applyColorScheme(loadColorScheme())

registerSW({ immediate: true })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)

// Fade out the static boot splash now that React has painted, so a cold
// launch from the home-screen icon reads as an app opening rather than a
// page loading in.
requestAnimationFrame(() => {
  const splash = document.getElementById('boot-splash')
  if (!splash) return
  splash.classList.add('boot-splash--hidden')
  setTimeout(() => splash.remove(), 250)
})

```

## Application shell, primary navigation and all destination dispatch.

### `src/App.tsx`

```tsx
import { BrandMark } from './components/BrandMark';
import { recoverShowDraft } from './utils/recoverShowDraft';
import { showBaselineHashes, settingsBaselineHash } from './utils/secure-storage';
import { createPendingStore } from './utils/pendingStore';
import { useState, useEffect, useRef, useCallback } from 'react';
import type { Show, AppSettings, PotentialComic, MusicTrack, ProfileRequest, ScheduleTemplateItem } from './types';
import { DEFAULT_SETTINGS, MAX_DELETED_SHOW_IDS } from './types';
import { generateId } from './utils/id';
import { ServerNotConfiguredError } from './utils/api';
import { applyColorScheme, loadColorScheme, type ColorScheme } from './utils/theme';
import { vibrateTap } from './utils/haptics';
import { getRolodexTerm } from './utils/terminology';
import { expandOriginFrom } from './utils/expandOrigin';
import { addPerformersToRolodex } from './utils/rolodex';
import { buildOverview } from './utils/showsOverview';
import {
  loadEncryptedShows,
  saveEncryptedShows,
  loadEncryptedSettings,
  saveEncryptedSettings,
  exportUserData,
  createAccount,
  authenticateUser,
  healSettings,
  listSnapshots,
  loadShowsSnapshot,
  loadSettingsSnapshot,
  parkSettingsSnapshot,
  PayloadTooLargeError,
  type EncryptedShowRow,
  type Snapshot,
} from './utils/secure-storage';
import { stripShowMediaForTrash, MAX_TRASH_ITEMS } from './utils/trash';
import { stripLegacyShowMedia, stripLegacySettingsMedia } from './utils/stripMedia';
import { healShow } from './utils/showHealing';
import { initMediaStore, clearMediaStore } from './utils/mediaStore';
import {
  type SessionCredentials,
  credentialsFrom,
  hasStoredSession,
  loadSession,
  saveSession,
  clearSession,
} from './utils/session-vault';
import { Login } from './components/Login';
import { Onboarding } from './components/Onboarding';
import { Settings } from './components/Settings';
import { PageHeader } from './components/PageHeader';
import { uploadMedia } from './utils/mediaStore';
import { dataUrlToFile } from './utils/media';
import { ProfilePage } from './components/ProfilePage';
import { RolodexRow } from './components/RolodexRow';
import {
  createProfileLink,
  profileLinkStatus,
  profileUrl,
  refreshProfiles,
  fetchProfilePhoto,
  deleteProfilePhoto,
} from './utils/profileLink';
import { applyProfileChanges, profileChanges, profileFromAnswers } from './utils/signatureImport';
import { ShowCard } from './components/ShowCard';
import { ShowsDashboard, type ShowsFocus } from './components/ShowsDashboard';
import { ShowsCalendar } from './components/ShowsCalendar';
import { ShowForm } from './components/ShowForm';
import { ShowDetail } from './components/ShowDetail';
import { Expenses } from './components/Expenses';
import { Modal } from './components/Modal';
import { RolodexProfile } from './components/sections/RolodexProfile';
import { LiveViewer } from './components/LiveViewer';
import { Contracts } from './components/Contracts';
import { SigningPage } from './components/SigningPage';
import { readSignKeyFromHash, signatureSummary } from './utils/contracts';
import { orphanedRefs, showMediaRefs, sweepUnusedMedia, type SweepReport } from './utils/mediaCleanup';
import { deleteMedia } from './utils/mediaStore';
import { mergePendingShows } from './utils/mergePending';
import { duplicateShow } from './utils/duplicateShow';
import { unpublishAll } from './utils/viewerAudio';
import { MusicLibrary } from './components/MusicLibrary';
import { InstallPrompt } from './components/InstallPrompt';
import { MorePage } from './components/MorePage';
import { SyncStatus, type SyncState } from './components/SyncStatus';
import { Icon } from './components/Icon';
import './App.css';

type View = 'list' | 'detail' | 'settings' | 'expenses' | 'rolodex' | 'emails' | 'music' | 'contracts' | 'more';

/**
 * The app's destinations. Keeping this a plain list — rather than hand-written
 * buttons plus an overflow menu that changed depending on the screen — is what
 * keeps the nav identical everywhere you go.
 */
const NAV_ITEMS: {
  id: Exclude<View, 'detail'>;
  label: string;
  /** Which views light this tab up. A show's detail page still counts as Shows. */
  views: View[];
  icon: string;
}[] = [
  {
    id: 'list',
    label: 'Shows',
    views: ['list', 'detail'],
    icon: 'M2 5a1 1 0 011-1h14a1 1 0 010 2H3a1 1 0 01-1-1zm0 5a1 1 0 011-1h14a1 1 0 010 2H3a1 1 0 01-1-1zm0 5a1 1 0 011-1h8a1 1 0 010 2H3a1 1 0 01-1-1z',
  },
  {
    id: 'rolodex',
    label: 'Rolodex',
    views: ['rolodex'],
    icon: 'M9 6a3 3 0 11-6 0 3 3 0 016 0zM17 6a3 3 0 11-6 0 3 3 0 016 0zM12.93 17c.046-.327.07-.66.07-1a6.97 6.97 0 00-1.5-4.33A5 5 0 0119 16v1h-6.07zM6 11a5 5 0 015 5v1H1v-1a5 5 0 015-5z',
  },
  {
    id: 'music',
    label: 'Music',
    views: ['music'],
    icon: 'M18 3a1 1 0 00-1.196-.98l-8 1.6A1 1 0 008 4.6v6.735A3.5 3.5 0 1010 14V8.42l6-1.2v3.115A3.5 3.5 0 1018 13V3z',
  },
  {
    id: 'more',
    label: 'More',
    views: ['more', 'contracts', 'emails', 'expenses'],
    icon: 'M5 10a2 2 0 11-4 0 2 2 0 014 0zM12 10a2 2 0 11-4 0 2 2 0 014 0zM19 10a2 2 0 11-4 0 2 2 0 014 0z',
  },
  {
    id: 'settings',
    label: 'Settings',
    views: ['settings'],
    icon: 'M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z',
  },
];

/**
 * The signed-in session. Holds only values derived from the password at
 * sign-in (see session-vault) — never the password itself.
 */
type Session = SessionCredentials;

/**
 * Look for profile-link answers that arrived while we were away.
 *
 * Nobody tells the app when a performer replies — their browser writes to a
 * row keyed by their token and walks off. So the one moment to check is when
 * the producer opens the Rolodex, which is also the moment they came to ask.
 * A component rather than an effect in App, so it runs on entering the view
 * and not on every settings write (finding an answer writes settings, and an
 * effect keyed on settings would loop).
 */
function RolodexRefresh({
  requests,
  onFound,
}: {
  requests: ProfileRequest[];
  onFound: (updated: ProfileRequest[]) => void;
}) {
  // The check is slow and the producer is not waiting for it: they may make
  // a new link, or edit anything, before it resolves. Calling the `onFound`
  // captured at mount would hand it the settings from that first render and
  // overwrite whatever they did in between. The ref always points at the
  // latest one, which closes over the latest settings.
  const onFoundRef = useRef(onFound);
  onFoundRef.current = onFound;
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const updated = await refreshProfiles(requests);
      if (!cancelled && updated) onFoundRef.current(updated);
    })();
    return () => { cancelled = true; };
    // On mount only, by design — see above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

// Unsaved-edit backups. When a save fails (offline, server error), the latest
// data is parked here so a closed tab or crashed browser can't lose it — it's
// restored and re-saved on the next launch.
const PENDING_SHOWS_KEY = 'showrunner:pendingShows';
const PENDING_SETTINGS_KEY = 'showrunner:pendingSettings';
const LAST_EXPORT_KEY = 'showrunner:lastExport';
// When this account last had a save confirmed by the server. Kept across
// reloads so the status pill can answer "when did this last reach my account?"
// on a cold start, before the first save of the session.
const LAST_SYNC_KEY = 'showrunner:lastSync';

function readLastSync(username: string): number | null {
  try {
    const raw = localStorage.getItem(LAST_SYNC_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { username: string; at: number };
    return parsed.username === username && typeof parsed.at === 'number' ? parsed.at : null;
  } catch {
    return null;
  }
}

function writeLastSync(username: string, at: number): void {
  try {
    localStorage.setItem(LAST_SYNC_KEY, JSON.stringify({ username, at }));
  } catch {
    /* ignore */
  }
}

/**
 * Says so when the list you're looking at isn't all of your shows.
 *
 * The at-a-glance tiles and the search box both narrow the grid, and until now
 * the only sign of it was a pressed tile above the fold. Tap "Needs a running
 * order", scroll down, and two of your twelve shows are on screen with nothing
 * to say why — which reads exactly like the app losing the other ten. The count
 * and the way back belong next to the list they apply to.
 */
function NarrowedNotice({
  shown,
  total,
  onClear,
}: {
  shown: number;
  total: number;
  onClear: () => void;
}) {
  if (shown >= total) return null;
  return (
    <div className="shows-narrowed" role="status">
      <span className="shows-narrowed__text">
        Showing {shown} of {total} shows
      </span>
      <button
        type="button"
        className="btn btn--secondary btn--sm shows-narrowed__clear"
        onClick={onClear}
      >
        Show all
      </button>
    </div>
  );
}

/** True when the user has 3+ shows and hasn't exported a backup in 30 days. */
function shouldNudgeBackup(showCount: number, lastBackupAt: string | null): boolean {
  if (showCount < 3) return false;
  if (!lastBackupAt) return true;
  const at = new Date(lastBackupAt).getTime();
  if (Number.isNaN(at)) return true;
  return Date.now() - at > 30 * 24 * 60 * 60 * 1000;
}

// Drafts are isolated by tab and account. Recovery uses the saved version,
// not the age of a backup, to decide whether an edit can safely be reapplied.
const pendingStore = createPendingStore(() => localStorage, crypto.randomUUID());
const readPending = pendingStore.read;

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const activeSessionRef = useRef(session);
  activeSessionRef.current = session;
  const [localBackupFailed, setLocalBackupFailed] = useState(false);
  const writePending = useCallback((key: string, username: string, data: unknown): boolean => {
    const written = pendingStore.write(key, username, data, session ? {
      settingsHash: key === PENDING_SETTINGS_KEY ? settingsBaselineHash(session) : undefined,
      showHashes: key === PENDING_SHOWS_KEY ? showBaselineHashes(session) : undefined,
    } : undefined);
    setLocalBackupFailed(!written);
    return written;
  }, [session]);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState('');
  const [colorScheme, setColorScheme] = useState<ColorScheme>(() => loadColorScheme());
  const [desktopNavigation, setDesktopNavigation] = useState(() => window.matchMedia('(min-width: 900px)').matches);
  const [navigationOpen, setNavigationOpen] = useState(false);
  const navigationRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const media = window.matchMedia('(min-width: 900px)');
    const update = () => {
      if (navigationRef.current?.matches(':popover-open')) navigationRef.current.hidePopover();
      setNavigationOpen(false);
      setDesktopNavigation(media.matches);
    };
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);


  // Apply the chosen color scheme app-wide and persist it.
  useEffect(() => {
    applyColorScheme(colorScheme);
  }, [colorScheme]);

  // Light haptic on every control tap (Android only — iOS web has no haptics
  // API). One delegated touch listener covers the whole app.
  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (e.pointerType !== 'touch') return;
      const target = e.target as HTMLElement | null;
      const control = target?.closest('button, .btn, [role="button"]');
      if (!control) return;
      if ((control as HTMLButtonElement).disabled) return;
      if (control.getAttribute('aria-disabled') === 'true') return;
      vibrateTap(10);
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, []);

  const [shows, setShows] = useState<Show[]>([]);
  // Only ever holds problems the user has to act on (a payload that can never
  // fit). Transient failures are handled silently and reported by the sync
  // pill instead — a retry that's already working shouldn't look like an alarm.
  const [saveError, setSaveError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Where the user's work currently is. Drives the always-visible status pill.
  const [syncState, setSyncState] = useState<SyncState>('saved');
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  // True while edits are parked in this device's local backup — i.e. written
  // here but not yet confirmed by the server.
  const [hasLocalCopy, setHasLocalCopy] = useState(false);
  const [lastBackupAt, setLastBackupAt] = useState<string | null>(() => {
    try {
      return localStorage.getItem(LAST_EXPORT_KEY);
    } catch {
      return null;
    }
  });
  // Start in the loading state whenever a session will be restored, so the app
  // never shows an interactive (empty) shows list before the initial load
  // finishes. Creating a show during that window would be silently lost: the
  // save effect is gated on dataLoaded, and the load resolving would overwrite
  // the new show. Blocking interaction until loaded closes that race.
  const [loadingData, setLoadingData] = useState(() => {
    try {
      return hasStoredSession();
    } catch {
      return false;
    }
  });
  const dataLoaded = useRef(false);
  // Rows the last load couldn't decrypt, held as ciphertext so every save can
  // write them back untouched. Never rendered — only carried.
  const unreadableRowsRef = useRef<EncryptedShowRow[]>([]);
  const [unreadableCount, setUnreadableCount] = useState(0);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [onboardingSaving, setOnboardingSaving] = useState(false);
  const [view, setView] = useState<View>('list');
  const [selectedShow, setSelectedShow] = useState<Show | null>(null);
  /**
   * Set when the dashboard's Run Show button opened the show, so ShowDetail
   * mounts straight into live mode. Cleared on the way back out, so returning
   * to the same show by tapping its card doesn't reopen live mode.
   */
  const [startInRunShow, setStartInRunShow] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [newComicName, setNewComicName] = useState('');
  const [newComicNotes, setNewComicNotes] = useState('');
  const [newListEmail, setNewListEmail] = useState('');
  const [selectedComicId, setSelectedComicId] = useState<string | null>(null);
  // Which follow-up list from the at-a-glance row the grid is narrowed to.
  const [showsFocus, setShowsFocus] = useState<ShowsFocus>(null);
  const [expandOrigin, setExpandOrigin] = useState({ x: 50, y: 30 });
  /** Where the shows grid was scrolled to when you last left it. */
  const listScrollRef = useRef(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'added' | 'date-asc' | 'date-desc' | 'name'>(() => {
    try {
      const saved = localStorage.getItem('showrunner:showSort');
      if (saved === 'added' || saved === 'date-asc' || saved === 'date-desc' || saved === 'name') {
        return saved;
      }
    } catch {
      /* ignore */
    }
    // The next show you have to run is the one you came here for, so the list
    // opens on soonest-first rather than in the order things were created.
    return 'date-asc';
  });

  // Remember the sort preference so the shows list feels familiar each visit.
  useEffect(() => {
    try {
      localStorage.setItem('showrunner:showSort', sortBy);
    } catch {
      /* ignore */
    }
  }, [sortBy]);

  const [showsView, setShowsView] = useState<'grid' | 'calendar'>(() => {
    try {
      const saved = localStorage.getItem('showrunner:showsView');
      if (saved === 'grid' || saved === 'calendar') return saved;
    } catch {
      /* ignore */
    }
    return 'grid';
  });

  // Remember whether the user prefers the list or the calendar.
  useEffect(() => {
    try {
      localStorage.setItem('showrunner:showsView', showsView);
    } catch {
      /* ignore */
    }
  }, [showsView]);

  // Restore the session on mount (persists until logout). Reading it is async
  // now — the stored record is decrypted with a key the browser holds and
  // won't hand over — so a failed restore has to clear the loading state
  // itself, or the app would sit on the skeleton forever.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const restored = await loadSession();
        if (cancelled) return;
        if (restored) setSession(restored);
        else setLoadingData(false);
      } catch (error) {
        console.error('Failed to restore session:', error);
        if (!cancelled) setLoadingData(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);


  // Media store (large audio chunks) needs the session credentials for auth
  // headers + the encryption key. Keep it in sync with the session.
  useEffect(() => {
    if (session) initMediaStore(session);
    else clearMediaStore();
  }, [session]);

  // Carry the last confirmed save across reloads, so the status pill can say
  // when your work last reached your account instead of starting blank.
  useEffect(() => {
    setLastSavedAt(session ? readLastSync(session.username) : null);
  }, [session]);

  // Load data for signed in user
  useEffect(() => {
    if (!session) return;
    const currentSession = session;

    if (!dataLoaded.current) setLoadingData(true);
    let cancelled = false;
    async function loadData() {
      try {
        const [loaded, loadedSettings] = await Promise.all([
          loadEncryptedShows(currentSession),
          loadEncryptedSettings(currentSession),
        ]);
        if (cancelled) return;
        // Rows this device couldn't decrypt. They're not in the list, so hold
        // their ciphertext for the saver to write straight back — otherwise the
        // next edit to any other show would delete them off the account.
        unreadableRowsRef.current = loaded.unreadable;
        setUnreadableCount(loaded.unreadable.length);
        // Scrub legacy embedded media (photos, videos, files) that older saves
        // still carry — the next save writes the slimmed-down payload.
        const migratedShows = loaded.shows.map((show) => stripLegacyShowMedia(show));

        // Migrate per-show expenses into global settings.expenses
        let migratedSettings = stripLegacySettingsMedia({ ...loadedSettings, expenses: loadedSettings.expenses || [] });
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

        // Auto-correct: a show still marked 'upcoming' whose date has passed
        // should be 'completed'. Only touch 'upcoming' — leave 'in-progress'
        // and 'cancelled' alone since those are intentional manual states.
        const today = new Date().toISOString().split('T')[0];
        const autoStatusShows = migratedShows.map((show) =>
          show.status === 'upcoming' && show.date && show.date < today
            ? { ...show, status: 'completed' as const }
            : show
        );

        // If a previous session had unsaved edits (save failed, tab closed),
        // recover edits against their original baseline. Conflicting versions
        // get separate show IDs so both survive.
        const showDrafts = pendingStore.readAll<Show[]>(PENDING_SHOWS_KEY, currentSession.username);
        const rawPendingShows = showDrafts.length ? showDrafts.reduce((current, draft) =>
          recoverShowDraft(draft.data, current, draft.metadata?.showHashes), autoStatusShows) : null;
        // Same healing as the server rows: a local backup written by an older
        // build can be missing list fields the list renders without checking.
        const pendingShows = rawPendingShows
          ? rawPendingShows
              .map((s) => healShow(s))
              .filter((s): s is Show => s !== null)
              .map((s) => stripLegacyShowMedia(s))
          : null;
        // Pending backups bypass loadEncryptedSettings, so run them through the
        // same healing (trash media stripping, oversized-audio removal) —
        // otherwise a poisoned backup keeps the account unsavable forever.
        const heldSettings = readPending<AppSettings>(PENDING_SETTINGS_KEY, currentSession.username);
        const healedHeldSettings = heldSettings
          ? stripLegacySettingsMedia(healSettings(heldSettings.data))
          : null;
        // Based on a different saved version — but kept, as an earlier version
        // on the account, and only let go of this device once it is there.
        let pendingSettings: AppSettings | null = null;
        if (healedHeldSettings && heldSettings) {
          if (heldSettings.metadata?.settingsHash !== undefined && heldSettings.metadata.settingsHash === settingsBaselineHash(currentSession)) {
            pendingSettings = healedHeldSettings;
          } else {
            void parkSettingsSnapshot(heldSettings.data, currentSession)
              .then(pendingStore.capture(PENDING_SETTINGS_KEY, currentSession.username))
              .catch((err) => console.error('Failed to park held settings:', err));
          }
        }

        // A held copy is this device's unsaved work, not a picture of the whole
        // account: merged with what the server holds rather than replacing it,
        // so a show added elsewhere since the failed save is not deleted by
        // this launch. See mergePendingShows.
        const initialShows = pendingShows
          ? mergePendingShows(
              pendingShows,
              autoStatusShows,
              (pendingSettings ?? migratedSettings).trash ?? [],
              // The record of what was deleted on purpose has to come from
              // whichever settings this launch is actually going to use, and
              // from the account's copy as well — a deletion made on another
              // device is on the server's record and not on this device's.
              [
                ...(migratedSettings.deletedShowIds ?? []),
                ...(pendingSettings?.deletedShowIds ?? []),
              ],
            )
          : autoStatusShows;
        // A pending copy is by definition *not* what the server has; anything
        // else came straight off it and needs no local copy until it's edited.
        savedShowsRef.current = pendingShows ? null : initialShows;
        latestShowsRef.current = initialShows;
        setShows(initialShows);
        setSettings(pendingSettings ?? migratedSettings);
        dataLoaded.current = true;
        if (pendingSettings) saveSettings(pendingSettings);
        setLoadError(null);
      } catch (error) {
        if (cancelled) return;
        console.error('Failed to load shows:', error);
        // Never overwrite in-memory shows on load failure — leave state unchanged
        // so the auto-save effect cannot wipe the database.
        setLoadError("Couldn't load your shows. Check your connection and refresh the page.");
      } finally {
        if (!cancelled) setLoadingData(false);
      }
    }

    loadData();
    return () => { cancelled = true; };
    // saveSettings is deliberately not a dependency. It is redeclared every
    // render but closes over nothing mutable except `session`, which is this
    // effect's only dependency — so the copy this run calls always agrees with
    // the session it ran for. Listing it would re-run the whole load on every
    // render instead, which is a refetch per keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  // Always points at the latest shows so an in-flight save can re-persist any
  // edits that landed while it was running.
  const latestShowsRef = useRef(shows);
  // The exact set that last reached the server — or came from it. Compared by
  // identity against the live one to answer "is there anything unsaved?", which
  // is the only question the flush below needs and the only one that can be
  // answered without guessing.
  const savedShowsRef = useRef<Show[] | null>(null);
  // Assigned during render rather than in an effect, because both readers run
  // at moments when "after the next paint" is already too late.
  //
  // The visibility flush is the one that cost data. Delete a show and switch
  // away in the same breath — which is what a phone is for — and the flush ran
  // while this ref still held the pre-delete array. That made it compare equal
  // to savedShowsRef, so the flush concluded there was nothing unsaved and
  // wrote no local copy. Backgrounding then froze the save timer, iOS
  // discarded the page, and the next launch read the show straight back off
  // the server. The saver's own mid-flight re-check was reading the same stale
  // value for the same reason.
  latestShowsRef.current = shows;
  // Guards against overlapping saves. The server replaces all rows per request,
  // so two concurrent saves can race and an older one can clobber a newer one.
  const savingRef = useRef(false);
  // Bumped to re-run the save effect for a retry (after a failure backoff, or
  // when the browser comes back online).
  const [saveRetryTick, setSaveRetryTick] = useState(0);
  const retryDelayRef = useRef(5000);
  const settingsSaveSeqRef = useRef(0);
  // Session-scoped dismissal of the backup nudge (it returns next visit).
  const [backupNudgeDismissed, setBackupNudgeDismissed] = useState(false);
  // Whether the install prompt is currently on screen. Both it and the backup
  // nudge are rows that sit between you and your shows; one of them is worth
  // that, two are not — so the backup nudge waits its turn.
  const [installPromptShown, setInstallPromptShown] = useState(false);

  const showSaveConflictRef = useRef(false);
  const settingsSaveFailedRef = useRef(false);

  // Records a confirmed round-trip to the server. Everything the status pill
  // claims about "saved" traces back to this being called.
  function markSynced(username: string) {
    const at = Date.now();
    setLastSavedAt(at);
    writeLastSync(username, at);
    if (!showSaveConflictRef.current && !settingsSaveFailedRef.current && latestShowsRef.current === savedShowsRef.current) setSyncState('saved');
  }

  // A failed save must never be the end of the story: retry as soon as the
  // browser regains connectivity.
  useEffect(() => {
    function onOnline() {
      retryDelayRef.current = 5000;
      setSaveRetryTick((t) => t + 1);
    }
    // Losing signal isn't a failure — say so plainly rather than waiting for a
    // request to time out and reporting it as an error.
    function onOffline() {
      setSyncState((prev) => (prev === 'blocked' ? prev : 'offline'));
    }
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  // Park every edit on this device as soon as it happens, not only after a
  // save fails. The save is debounced and then takes a round-trip; closing the
  // tab inside that window used to drop the edit on the floor. Writing the
  // local copy first narrows the window before the network confirms the save.
  useEffect(() => {
    if (!session || !dataLoaded.current) return;
    if (latestShowsRef.current === savedShowsRef.current) return;
    setHasLocalCopy(writePending(PENDING_SHOWS_KEY, session.username, latestShowsRef.current));
  }, [shows, session, writePending]);

  /**
   * Write the local copy the instant the app is put away.
   *
   * Every edit is held in memory for up to a second before anything durable
   * happens to it: the server save is on a
   * 1000ms debounce, and the save then takes a round trip on top. Close the
   * app inside that window and the edit is gone from everywhere — which is
   * exactly what a phone does. Backgrounding a PWA freezes its timers, and iOS
   * will discard the page outright rather than let them run later, so a delete
   * followed by switching away could simply un-happen.
   *
   * localStorage is synchronous, so a write here always lands, even on the way
   * out. The next launch restores it and re-saves it.
   *
   * Only when there is something unsaved: writing unconditionally would leave a
   * local copy sitting in front of every launch, and a stale one would win over
   * newer work done on another device.
   */
  useEffect(() => {
    if (!session) return;
    const currentSession = session;
    function flush() {
      if (!dataLoaded.current || latestShowsRef.current === savedShowsRef.current) return;
      setHasLocalCopy(writePending(PENDING_SHOWS_KEY, currentSession.username, latestShowsRef.current));
    }
    function onVisibility() {
      if (document.visibilityState === 'hidden') flush();
    }
    document.addEventListener('visibilitychange', onVisibility);
    // pagehide fires where unload doesn't on iOS, including into the back/forward cache.
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', flush);
    };
  }, [session, writePending]);

  // If work exists only on this device, closing the tab risks it being the
  // only copy — worth one confirm. Deliberately not shown while a normal save
  // is simply in flight: that case is already covered by the local copy above
  // and re-sends itself on the next launch.
  useEffect(() => {
    if (!localBackupFailed && syncState !== 'retrying' && syncState !== 'offline' && syncState !== 'blocked') return;
    function onBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
      e.returnValue = '';
    }
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [syncState, localBackupFailed]);

  // Save shows when changed
  useEffect(() => {
    if (!session || !dataLoaded.current) return;
    const currentSession = session;

    const timeout = setTimeout(() => {
      // A save is already running; it will pick up the latest shows before it
      // finishes, so we don't need to start a second one. This pass is spent
      // either way — see the re-check once that save settles.
      if (savingRef.current || latestShowsRef.current === savedShowsRef.current) return;

      void (async () => {
        savingRef.current = true;
        setSyncState((prev) => (prev === 'blocked' ? prev : 'saving'));
        let settledClean = false;
        try {
          // Re-save until the data stops changing mid-flight, so the last edit
          // always wins and is never lost to an overlapping request.
          let saved: Show[] | null = null;
          while (latestShowsRef.current !== saved) {
            if (activeSessionRef.current !== currentSession) return;
            saved = latestShowsRef.current;
            const acknowledge = pendingStore.capture(PENDING_SHOWS_KEY, currentSession.username);
            await saveEncryptedShows(saved, currentSession, unreadableRowsRef.current);
            acknowledge();
            if (activeSessionRef.current !== currentSession) return;
          }
          showSaveConflictRef.current = false;
          settledClean = true;
          savedShowsRef.current = saved;
          setHasLocalCopy(false);
          retryDelayRef.current = 5000;
          if (!settingsSaveFailedRef.current) setSaveError(null);
          markSynced(currentSession.username);
        } catch (error) {
          if (activeSessionRef.current !== currentSession) return;
          console.error('Failed to save shows:', error);
          // Park the unsaved data locally so even closing the tab can't lose it.
          setHasLocalCopy(writePending(PENDING_SHOWS_KEY, currentSession.username, latestShowsRef.current));
          // A too-large payload (client-side guard or a 413 from the server) can
          // never succeed by retrying — the data has to get smaller first. Show
          // an actionable message and skip the backoff loop; the save effect
          // re-runs on its own when the user trims a file, so it recovers then.
          if ((error as { code?: string })?.code === 'save_conflict') {
            showSaveConflictRef.current = true;
            setSyncState('blocked');
            setSaveError('This show changed in another tab or device. Your edits are kept here; the newer saved version has not been overwritten. Download a backup before reloading to reconcile the two versions.');
            return;
          }
          const tooLarge =
            error instanceof PayloadTooLargeError ||
            (error as { status?: number })?.status === 413;
          if (tooLarge) {
            setSyncState('blocked');
            setSaveError(
              error instanceof PayloadTooLargeError
                ? error.message
                : "Your show data is too large to save. Remove or shrink a big uploaded walk-on track.",
            );
          } else {
            // No banner: the retry is already running and the work is already
            // held on this device, so there's nothing for the user to do. The
            // status pill reports it quietly and explains it on tap.
            setSyncState(navigator.onLine ? 'retrying' : 'offline');
            const delay = retryDelayRef.current;
            retryDelayRef.current = Math.min(delay * 2, 60_000);
            setTimeout(() => setSaveRetryTick((t) => t + 1), delay);
          }
        } finally {
          savingRef.current = false;
          // One more look before letting go.
          //
          // The loop above decides it is done by comparing latestShowsRef
          // against what it just wrote — but that ref is assigned in an
          // effect, and effects are flushed after paint. An edit that lands
          // while a save is in flight can therefore still be invisible to the
          // loop's last check, and the debounced pass that would have caught
          // it has already fired and returned because a save was running. The
          // change then belongs to nobody.
          //
          // Deleting is where that goes from an unsaved edit to a resurrected
          // row: a show only leaves the server when a save actually runs, so a
          // deletion dropped here comes back on the next load.
          if ((settledClean || activeSessionRef.current !== currentSession) && activeSessionRef.current && latestShowsRef.current !== savedShowsRef.current) {
            setSaveRetryTick((t) => t + 1);
          }
        }
      })();
    }, 1000); // Debounce saves

    return () => clearTimeout(timeout);
  }, [shows, session, saveRetryTick, writePending]);

  /**
   * Take a freshly entered password and turn it into a stored session.
   *
   * This is the only place the raw password exists, and it does not outlive
   * this call: the keys and the auth hash are derived here, and those derived
   * values are what get held in memory and written to disk.
   */
  async function beginSession(username: string, password: string) {
    const creds = credentialsFrom(username, password);
    await saveSession(creds);
    setSession(creds);
  }

  // Ask the browser not to evict what this device holds. Without it, storage
  // is "best effort": Safari clears a site's data after a week unopened and
  // Chrome sheds it under disk pressure — and the held copy of unsaved work
  // is exactly what goes. Granted silently for an installed app; a no-op
  // where unsupported.
  useEffect(() => {
    if (!session) return;
    void navigator.storage?.persist?.().catch(() => undefined);
  }, [session]);

  /**
   * Bring back a whole earlier save. A restore is itself a save, so the
   * version being replaced is snapshotted first — there is always a way back
   * from a restore, including from a wrong one.
   */
  async function handleListSnapshots(): Promise<Snapshot[]> {
    if (!session) return [];
    return listSnapshots(session);
  }

  async function handleRestoreSnapshot(snapshot: Snapshot): Promise<void> {
    if (!session) return;
    if (snapshot.kind === 'shows') {
      const loaded = await loadShowsSnapshot(session, snapshot.at);
      unreadableRowsRef.current = loaded.unreadable;
      setUnreadableCount(loaded.unreadable.length);
      const restored = loaded.shows.map((show) => stripLegacyShowMedia(show));
      latestShowsRef.current = restored;
      setShows(restored);
      writePending(PENDING_SHOWS_KEY, session.username, restored);
      setHasLocalCopy(true);
      // Bringing a version back retracts every deletion it undoes. A show in
      // the restored list that is still on the deleted record would be read
      // as deliberately deleted and dropped again on the next launch.
      const back = new Set(restored.map((show) => show.id));
      const record = settings.deletedShowIds ?? [];
      if (record.some((id) => back.has(id))) {
        const updated = { ...settings, deletedShowIds: record.filter((id) => !back.has(id)) };
        setSettings(updated);
        saveSettings(updated);
      }
      return;
    }
    const restored = stripLegacySettingsMedia(await loadSettingsSnapshot(session, snapshot.at));
    setSettings(restored);
    saveSettings(restored);
  }

  async function handleSignIn(username: string, password: string) {
    setAuthError('');
    setAuthLoading(true);

    try {
      const isValid = await authenticateUser(username, password);

      if (!isValid) {
        setAuthError('Invalid username or password');
        return;
      }

      await beginSession(username, password);
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
      await beginSession(username, password);
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
    if (session && dataLoaded.current) {
      if (latestShowsRef.current !== savedShowsRef.current) writePending(PENDING_SHOWS_KEY, session.username, latestShowsRef.current);
    }
    ++settingsSaveSeqRef.current;
    activeSessionRef.current = null;
    setSession(null);
    clearSession();
    dataLoaded.current = false;
    setShows([]);
    setSettings(DEFAULT_SETTINGS);
    setView('list');
    setSelectedShow(null);
    setShowForm(false);
    setAuthError('');
  }

  /**
   * Download a plain-JSON copy of everything. The one guarantee that doesn't
   * depend on this app, this device, or this server still being around — so
   * it's reachable from the status pill on every screen, not just Settings.
   */
  async function handleDownloadBackup() {
    if (!session) return;
    try {
      const url = await exportUserData(session, { shows: latestShowsRef.current, unreadable: unreadableRowsRef.current, settings,
        recoveryDrafts: [
          ...pendingStore.list(PENDING_SHOWS_KEY, session.username).map(p => ({ kind: 'shows', at: p.at, data: p.data })),
          ...pendingStore.list(PENDING_SETTINGS_KEY, session.username).map(p => ({ kind: 'settings', at: p.at, data: p.data })),
        ],
      });
      const a = document.createElement('a');
      a.href = url;
      a.download = `showrunner-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      const at = new Date().toISOString();
      try {
        localStorage.setItem(LAST_EXPORT_KEY, at);
      } catch {
        /* ignore */
      }
      setLastBackupAt(at);
      setBackupNudgeDismissed(true);
    } catch (error) {
      console.error('Failed to export backup:', error);
      setSaveError("Couldn't build your backup file. Check your connection and try again.");
    }
  }

  async function handleCompleteOnboarding(data: { brandName: string; showTypes: string[] }) {
    if (!session) return;
    const savingSession = session;
    setOnboardingSaving(true);
    // Merge onto whatever loaded for this account so we never clobber existing data.
    const updatedSettings: AppSettings = {
      ...settings,
      brandName: data.brandName || settings.brandName,
      showTypes: data.showTypes,
      onboarded: true,
    };
    try {
      writePending(PENDING_SETTINGS_KEY, session.username, updatedSettings);
      const acknowledge = pendingStore.capture(PENDING_SETTINGS_KEY, session.username);
      await saveEncryptedSettings(updatedSettings, session);
      acknowledge();
      if (activeSessionRef.current !== savingSession) return;
      setSettings(updatedSettings);
    } catch (error) {
      if (activeSessionRef.current !== savingSession) return;
      console.error('Failed to save onboarding:', error);
      setSettings(updatedSettings);
      saveSettings(updatedSettings);
    } finally {
      if (activeSessionRef.current === savingSession) setOnboardingSaving(false);
    }
  }

  async function handleSaveSettings(updatedSettings: AppSettings) {
    if (!session) return;
    const savingSession = session;

    setSettingsSaving(true);
    try {
      writePending(PENDING_SETTINGS_KEY, session.username, updatedSettings);
      const acknowledge = pendingStore.capture(PENDING_SETTINGS_KEY, session.username);
      await saveEncryptedSettings(updatedSettings, session);
      acknowledge();
      if (activeSessionRef.current !== savingSession) return;
      settingsSaveFailedRef.current = false;
      if (!showSaveConflictRef.current) setSaveError(null);
      setSettings(updatedSettings);
      markSynced(session.username);
      setView('list');
    } catch (error) {
      if (activeSessionRef.current !== savingSession) return;
      console.error('Failed to save settings:', error);
      // Never make someone retype what they just entered. Keep their edits in
      // the app and hand them to the retrying saver, which backs them up on
      // this device and keeps trying — the status pill reports where they are.
      setSettings(updatedSettings);
      saveSettings(updatedSettings);
      setView('list');
    } finally {
      if (activeSessionRef.current === savingSession) setSettingsSaving(false);
    }
  }

  function handleCreateShow(data: Omit<Show, 'id' | 'createdAt' | 'updatedAt'>) {
    const newShow: Show = {
      ...data,
      id: generateId(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      // `scenes` comes through from the form and is undefined unless its box
      // was ticked. An undefined list is what marks a show as never having
      // asked for the section; seeding an empty array unconditionally made
      // every new show read as opted in, which is why it is the form's choice
      // to make and not this function's.
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
    setShows((prev) => [duplicateShow(original), ...prev]);
  }

  /**
   * Book a run of the same show on the dates given.
   *
   * Real shows, not a stored rule: a booked night gets edited constantly —
   * someone drops out, the venue moves, a holiday shifts it a week — and each
   * of these can be edited like any other show. See utils/recurrence.ts.
   */
  function handleRepeatShow(id: string, dates: string[]) {
    const original = shows.find((s) => s.id === id);
    if (!original || dates.length === 0) return;
    const copies = dates.map((date) => duplicateShow(original, { name: original.name, date }));
    setShows((prev) => [...copies, ...prev]);
  }

  function handleDeleteShow(id: string) {
    const showToDelete = shows.find((s) => s.id === id);
    if (!showToDelete) return;

    const remaining = shows.filter((s) => s.id !== id);
    setShows(remaining);
    // Written now, synchronously, rather than left to the next local-copy
    // timer and the 1s save debounce.
    //
    // Deleting and then switching away is one gesture on a phone, and
    // backgrounding freezes both those timers — iOS discards the page rather
    // than running them later. Every other edit lost that way is an edit the
    // user can see is missing; a lost deletion is a show that comes back.
    // localStorage is synchronous, so this lands even on the way out, and the
    // next launch restores it and re-saves it.
    if (session) {
      writePending(PENDING_SHOWS_KEY, session.username, remaining);
      setHasLocalCopy(true);
      latestShowsRef.current = remaining;
    }

    // Move to trash instead of permanent deletion — but strip embedded media
    // first and cap the trash length. Trash lives in the settings blob, which
    // has a hard request-size ceiling; a full show copy (with base64 audio)
    // can make settings permanently unsavable.
    const deletedItem = {
      id: generateId(),
      type: 'show' as const,
      data: stripShowMediaForTrash(showToDelete),
      deletedAt: new Date().toISOString(),
    };

    // Anything pushed past the cap is gone for good — it can no longer be
    // restored — so its uploads go with it rather than outliving every trace
    // of the show they belonged to.
    const nextTrash = [deletedItem, ...(settings.trash || [])];
    const evicted = nextTrash.slice(MAX_TRASH_ITEMS);
    const updatedSettings = {
      ...settings,
      trash: nextTrash.slice(0, MAX_TRASH_ITEMS),
      // The deletion outlives the restorable copy. A device's held copy of
      // unsaved work never expires now, so once this show fell off the end of
      // the trash there was nothing left to stop an old held copy putting it
      // back. An id costs 36 bytes; the show it stands for costs kilobytes.
      deletedShowIds: [id, ...(settings.deletedShowIds ?? []).filter((x) => x !== id)].slice(
        0,
        MAX_DELETED_SHOW_IDS,
      ),
    };
    setSettings(updatedSettings);
    if (session) {
      saveSettings(updatedSettings);
    }
    if (evicted.length > 0) {
      releaseShowMedia(evicted.map((t) => t.data), remaining, updatedSettings);
    }
  }


  /**
   * Free the uploads a permanently-removed show was the last owner of.
   *
   * Called with the state that will exist *after* the removal, so a file that
   * is about to become unreachable is seen as unreachable. Anything another
   * show, the music library, the Rolodex or a still-restorable trash item
   * points at is left alone — sharing is normal here, because duplicating a
   * show copies its media ids rather than the files.
   *
   * Best-effort by design: a failed delete leaves a file behind, which costs
   * storage, while blocking the removal on it would cost the user the thing
   * they asked for.
   */
  function releaseShowMedia(
    removed: Show[],
    remainingShows: Show[],
    remainingSettings: AppSettings,
  ) {
    const candidates = removed.flatMap(showMediaRefs);
    for (const ref of orphanedRefs(candidates, remainingShows, remainingSettings)) {
      deleteMedia(ref);
    }
    // Soundboard audio published for the viewer link lives under the show's
    // token rather than in the media store, so it needs its own sweep.
    if (session) {
      for (const show of removed) {
        if (show.viewToken) void unpublishAll(show.viewToken, session).catch(() => {});
      }
    }
  }

  /** Put a trashed show back in the list. */
  function handleRestoreShow(trashId: string) {
    const item = (settings.trash || []).find((t) => t.id === trashId);
    if (!item) return;

    // A show deleted on this device may already have been restored elsewhere —
    // don't create a duplicate if it's somehow back in the list.
    setShows((prev) => (prev.some((s) => s.id === item.data.id) ? prev : [item.data, ...prev]));

    const updatedSettings = {
      ...settings,
      trash: (settings.trash || []).filter((t) => t.id !== trashId),
      // Putting it back retracts the deletion. Left on the record, the merge
      // would read this show as deliberately deleted on the next launch and
      // drop it off the account again.
      deletedShowIds: (settings.deletedShowIds ?? []).filter((x) => x !== item.data.id),
    };
    setSettings(updatedSettings);
    saveSettings(updatedSettings);
  }

  /** Remove one item from the trash for good. */
  function handleDeleteForever(trashId: string) {
    const item = (settings.trash || []).find((t) => t.id === trashId);
    const updatedSettings = {
      ...settings,
      trash: (settings.trash || []).filter((t) => t.id !== trashId),
    };
    setSettings(updatedSettings);
    saveSettings(updatedSettings);
    if (item?.data) releaseShowMedia([item.data], shows, updatedSettings);
  }

  function handleUpdateMusicLibrary(musicLibrary: MusicTrack[]) {
    const updatedSettings = { ...settings, musicLibrary };
    setSettings(updatedSettings);
    saveSettings(updatedSettings);
  }

  function handleEmptyTrash() {
    const emptied = (settings.trash || []).map((t) => t.data).filter(Boolean);
    const updatedSettings = { ...settings, trash: [] };
    setSettings(updatedSettings);
    saveSettings(updatedSettings);
    if (emptied.length > 0) releaseShowMedia(emptied, shows, updatedSettings);
  }


  /**
   * Sweep files earlier versions of the app left behind.
   *
   * Deletion only started freeing uploads recently, so an account carries the
   * audio and headshots of every show deleted before that — unreachable, and
   * invisible to anything but a scan like this one. The server cannot do it
   * alone: what points at a file lives inside the user's encrypted blobs, so
   * only the browser can tell used from unused.
   *
   * Gated on `dataLoaded`, and that gate is the whole safety of it. A client
   * that failed to load would see no references at all and cheerfully delete
   * every file in the account.
   */
  async function handleSweepMedia(dryRun: boolean): Promise<SweepReport> {
    if (!session || !dataLoaded.current) {
      throw new Error('Your shows are still loading. Try again in a moment.');
    }
    return sweepUnusedMedia(latestShowsRef.current ?? shows, settings, session, { dryRun });
  }

  function saveSettings(updatedSettings: typeof settings) {
    if (!session) return;
    const currentSession = session;
    // Each call supersedes any still-retrying older one, so a stale snapshot
    // can never land after (and clobber) a newer save.
    const seq = ++settingsSaveSeqRef.current;
    settingsSaveFailedRef.current = true;
    setHasLocalCopy(writePending(PENDING_SETTINGS_KEY, currentSession.username, updatedSettings));
    setSyncState(prev => prev === 'blocked' ? prev : 'saving');
    void (async () => {
      // Retry with backoff until the save lands; back the data up locally in
      // the meantime so a closed tab can't lose it.
      let delay = 5000;
      const toSave = updatedSettings;
      while (seq === settingsSaveSeqRef.current) {
        try {
          const acknowledge = pendingStore.capture(PENDING_SETTINGS_KEY, currentSession.username);
          await saveEncryptedSettings(toSave, currentSession);
          acknowledge();
          if (seq === settingsSaveSeqRef.current) {
            settingsSaveFailedRef.current = false;
            if (!showSaveConflictRef.current) setSaveError(null);
            markSynced(currentSession.username);
          }
          return;
        } catch (err) {
          console.error('Failed to save settings:', err);
          if (seq !== settingsSaveSeqRef.current) return;
          const tooLarge =
            err instanceof PayloadTooLargeError ||
            (err as { status?: number })?.status === 413;
          if ((err as { code?: string })?.code === 'save_conflict') {
            setSyncState('blocked');
            setSaveError('Settings changed in another tab or device. Your local edits are still here. Download a backup before reviewing the saved version.');
            return;
          }
          if (tooLarge) {
            setHasLocalCopy(writePending(PENDING_SETTINGS_KEY, currentSession.username, toSave));
            setSyncState('blocked');
            setSaveError(
              err instanceof PayloadTooLargeError
                ? err.message
                : 'Your settings are too large to save — usually an over-full trash. Empty the trash to fix it.',
            );
            return;
          }
          setHasLocalCopy(writePending(PENDING_SETTINGS_KEY, currentSession.username, toSave));
          // Same as shows: a retry in progress is not an error to shout about.
          setSyncState(navigator.onLine ? 'retrying' : 'offline');
          await new Promise((resolve) => setTimeout(resolve, delay));
          delay = Math.min(delay * 2, 60_000);
        }
      }
    })();
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
    saveSettings(updatedSettings);
    setNewComicName('');
    setNewComicNotes('');
  }

  function handleAddEmailToList() {
    const trimmed = newListEmail.trim();
    if (!trimmed || !session) return;

    // Don't store the same address twice.
    const exists = settings.emailList.some(
      (entry) => entry.email.toLowerCase() === trimmed.toLowerCase()
    );
    if (exists) {
      setNewListEmail('');
      return;
    }

    const updatedSettings = {
      ...settings,
      emailList: [
        { id: generateId(), email: trimmed, addedAt: new Date().toISOString() },
        ...settings.emailList,
      ],
    };

    setSettings(updatedSettings);
    saveSettings(updatedSettings);
    setNewListEmail('');
  }

  function handleRemoveEmailFromList(id: string) {
    if (!session) return;

    const updatedSettings = {
      ...settings,
      emailList: settings.emailList.filter((entry) => entry.id !== id),
    };

    setSettings(updatedSettings);
    saveSettings(updatedSettings);
  }

  function handleSavePerformerToRolodex(comic: PotentialComic) {
    if (!session) return;
    const existing = settings.potentialComics.find(c => c.name.toLowerCase() === comic.name.toLowerCase());
    const updated = existing
      ? settings.potentialComics.map(c => c.id === existing.id ? { ...c, ...comic, id: c.id } : c)
      : [comic, ...settings.potentialComics];
    const updatedSettings = { ...settings, potentialComics: updated };
    setSettings(updatedSettings);
    saveSettings(updatedSettings);
  }

  // The profile link just made, shown on its row until the producer moves on.
  const [freshLink, setFreshLink] = useState<{ contactId: string; url: string } | null>(null);
  const [linkBusyFor, setLinkBusyFor] = useState<string | null>(null);
  const [linkErrorFor, setLinkErrorFor] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  // Headshots that came back with a reply, opened once and kept by token.
  // '' means "fetched, there was none", so a missing photo is not refetched
  // on every render.
  const [profilePhotos, setProfilePhotos] = useState<Record<string, string>>({});
  const photoTokens = (settings.profileRequests ?? [])
    .filter(r => r.submitted?.photoChunks)
    .map(r => r.token)
    .join('|');
  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    (async () => {
      for (const r of settings.profileRequests ?? []) {
        if (!r.submitted?.photoChunks || profilePhotos[r.token] !== undefined) continue;
        const url = await fetchProfilePhoto(r, session);
        if (cancelled) return;
        setProfilePhotos(prev => ({ ...prev, [r.token]: url ?? '' }));
      }
    })();
    return () => { cancelled = true; };
    // Keyed on which replies carry a photo, not on the settings object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photoTokens, session]);

  /**
   * Ask someone for their own details.
   *
   * Makes the link, files the request, and copies the link where the clipboard
   * allows — the producer's next move is always to send it. Shown on the row
   * regardless, because a link you cannot see is a link you cannot paste.
   */
  async function handleRequestDetails(comic: PotentialComic) {
    if (!session) return;
    setLinkBusyFor(comic.id);
    setLinkErrorFor(null);
    try {
      const request = await createProfileLink(
        { name: comic.name, contactId: comic.id },
        settings.brandName,
        session,
      );
      const url = profileUrl(window.location.origin, request.token, request.key);
      const updatedSettings = {
        ...settings,
        profileRequests: [request, ...(settings.profileRequests ?? [])],
      };
      setSettings(updatedSettings);
      saveSettings(updatedSettings);
      setFreshLink({ contactId: comic.id, url });
      try { await navigator.clipboard?.writeText(url); } catch { /* shown on the row anyway */ }
    } catch {
      // Venue wifi. Nothing was filed, so the row goes back to offering the
      // ask rather than pretending a link exists somewhere.
      setLinkErrorFor(comic.id);
      setLinkError('That link could not be made. Check your connection and try again.');
    } finally {
      setLinkBusyFor(null);
    }
  }

  /**
   * What an answered link would change on its person's profile.
   *
   * Returned even when the answer changes nothing — every answer they gave
   * was blank or already on file — so the row can say so and let the link go.
   * Otherwise it sits "answered" forever with nothing to press and no way to
   * ask again.
   */
  function pendingProfileImport(comic: PotentialComic) {
    const request = (settings.profileRequests ?? []).find(
      r => r.contactId === comic.id && r.submitted,
    );
    if (!request?.submitted) return null;
    const changes = profileChanges(comic, profileFromAnswers(request.submitted.fields));
    // Only offered where the profile has no picture, so a headshot the
    // producer chose is never displaced by one that arrived in the post.
    const photo = !comic.photo ? profilePhotos[request.token] || undefined : undefined;
    return { request, changes, photo };
  }

  /** File their answers — and their photo, into the media store — and retire the link. */
  async function handleImportProfile(comic: PotentialComic) {
    const pending = pendingProfileImport(comic);
    if (!pending || !session) return;

    // The headshot arrives as a data URL under the link's key; filing it means
    // putting it into the producer's media store, where every other photo
    // lives. A photo that will not store is a failure said out loud, not a
    // silent absence — the producer would otherwise believe the flyer has a
    // face.
    let photoRef: string | undefined;
    let photoFailed = false;
    if (pending.photo) {
      try {
        const file = dataUrlToFile(pending.photo, `${comic.name.trim() || 'headshot'}.jpg`);
        if (!file) photoFailed = true;
        else photoRef = await uploadMedia(file);
      } catch {
        photoFailed = true;
      }
    }

    const next = applyProfileChanges(comic, pending.changes);
    handleUpdateRolodexComic(photoRef ? { ...next, photo: photoRef } : next, {
      profileRequests: (settings.profileRequests ?? []).filter(r => r.token !== pending.request.token),
    });
    void deleteProfilePhoto(pending.request, session);

    setLinkErrorFor(photoFailed ? comic.id : null);
    setLinkError(photoFailed ? `${comic.name}'s details were saved, but their photo could not be stored.` : null);
  }

  /**
   * Wave a reply off. The link is retired, not hidden: a skipped reply that
   * stayed on file would keep "Ask for details" off the row for good, when
   * declining an answer is the moment you most want to be able to ask again.
   */
  function handleSkipProfile(comic: PotentialComic) {
    const pending = pendingProfileImport(comic);
    if (!pending || !session) return;
    const updatedSettings = {
      ...settings,
      profileRequests: (settings.profileRequests ?? []).filter(r => r.token !== pending.request.token),
    };
    setSettings(updatedSettings);
    saveSettings(updatedSettings);
    void deleteProfilePhoto(pending.request, session);
  }

  function handleUpdateRolodexComic(updated: PotentialComic, extra: Partial<AppSettings> = {}) {
    if (!session) return;
    const updatedComics = settings.potentialComics.map(c => c.id === updated.id ? updated : c);
    // `extra` rides in the same save: two writes in a row would race, and the
    // second — computed from settings that had not caught up — would put the
    // first one back the way it was.
    const updatedSettings = { ...settings, ...extra, potentialComics: updatedComics };
    setSettings(updatedSettings);
    saveSettings(updatedSettings);

    // Sync matching performers in all shows (match by name, update profile fields)
    setShows(prev =>
      prev.map(show => ({
        ...show,
        performers: show.performers.map(p => {
          if (p.name.toLowerCase() !== updated.name.toLowerCase()) return p;
          return {
            ...p,
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

  /** Save the current run-of-show as a reusable template (account-wide). */
  function handleSaveScheduleTemplate(name: string, items: ScheduleTemplateItem[]) {
    if (!session) return;
    const updatedSettings: AppSettings = {
      ...settings,
      scheduleTemplates: [
        { id: generateId(), name, items, createdAt: new Date().toISOString() },
        ...(settings.scheduleTemplates || []),
      ],
    };
    setSettings(updatedSettings);
    saveSettings(updatedSettings);
  }

  function handleDeleteScheduleTemplate(id: string) {
    if (!session) return;
    const updatedSettings: AppSettings = {
      ...settings,
      scheduleTemplates: (settings.scheduleTemplates || []).filter((t) => t.id !== id),
    };
    setSettings(updatedSettings);
    saveSettings(updatedSettings);
  }

  function handleRemovePotentialComic(id: string) {
    if (!session) return;

    const removed = settings.potentialComics.find((comic) => comic.id === id);
    const updatedSettings = {
      ...settings,
      potentialComics: settings.potentialComics.filter((comic) => comic.id !== id),
    };

    setSettings(updatedSettings);
    saveSettings(updatedSettings);

    // A Rolodex entry can carry a walk-on track. Filing someone onto a show
    // copies the reference rather than the audio, so this only frees it when
    // no show is still using it.
    if (removed?.walkOnMusic) {
      for (const ref of orphanedRefs([removed.walkOnMusic], shows, updatedSettings)) {
        deleteMedia(ref);
      }
    }
  }

  function handleUpdateShow(incoming: Show) {
    const previous = shows.find((s) => s.id === incoming.id);
    // Stamp the edit. Every change to a show comes through here, and until now
    // `updatedAt` was written once at creation and never again — so two copies
    // of a show, one from this device and one from the account, carried no
    // evidence of which was edited more recently. Reconciling them after a
    // failed save needs exactly that evidence.
    const updated: Show = { ...incoming, updatedAt: new Date().toISOString() };
    const nextShows = shows.map((s) => (s.id === updated.id ? updated : s));
    setShows(nextShows);
    setSelectedShow(updated);
    fileNewPerformers(updated);

    // Every edit to a show lands here, which makes this the one place that can
    // notice an upload going out of use: a cue deleted with its intro music, a
    // performer dropped from the bill with their headshot, a walk-on replaced
    // by a different track. Comparing what the show pointed at before with
    // what it points at now gives that set without every section having to
    // remember to clean up after itself.
    //
    // This treats a reference leaving the show as final, which it is — cue and
    // lineup edits have no undo. Only whole shows are recoverable, and those
    // go through the trash, which keeps their references alive until the trash
    // itself is emptied.
    if (previous) {
      const before = showMediaRefs(previous);
      const after = new Set(showMediaRefs(updated));
      const dropped = before.filter((ref) => !after.has(ref));
      if (dropped.length > 0) {
        for (const ref of orphanedRefs(dropped, nextShows, settings)) deleteMedia(ref);
      }
    }
  }

  /**
   * Anyone booked onto a show joins the Rolodex, without being filed by hand.
   *
   * Every route a performer can arrive by — typed in, picked from the Rolodex,
   * pulled off an imported schedule — lands in handleUpdateShow, so this is the
   * one place that needs to know.
   *
   * It compares performer **ids** against the show as it was, not names against
   * the Rolodex. Renaming someone keeps their id, so fixing a spelling doesn't
   * file a second copy under the corrected name; only a genuinely new row on
   * the lineup counts as a booking.
   */
  function fileNewPerformers(updated: Show) {
    if (!session) return;
    const before = shows.find((s) => s.id === updated.id);
    const alreadyOnBill = new Set(before?.performers.map((p) => p.id) ?? []);
    const added = updated.performers.filter((p) => !alreadyOnBill.has(p.id));
    if (added.length === 0) return;

    const merged = addPerformersToRolodex(settings.potentialComics, added);
    if (!merged) return; // everyone was already filed — no write needed

    const updatedSettings = { ...settings, potentialComics: merged };
    setSettings(updatedSettings);
    saveSettings(updatedSettings);
  }

  function handleSelectShow(show: Show, e?: React.MouseEvent, runShow = false) {
    // Remember where the list was, so Back returns you to the show you tapped
    // rather than the top of a long grid.
    listScrollRef.current = window.scrollY;
    // Set on every selection, not just the Run Show one: leaving a show by the
    // bottom nav rather than Back doesn't clear it, and a stale flag would
    // drop the *next* show you tapped straight into live mode.
    setStartInRunShow(runShow);
    // Open the show first. Measuring the card to set the expand animation's
    // origin is decoration, and it used to run ahead of the navigation it
    // decorates — so anything it touched (a missing .app-main, an element
    // already detached from the DOM) threw inside the click handler and the
    // show simply never opened. React does not route event-handler errors to
    // an error boundary, which made that failure completely silent: no error
    // screen, no blank page, just a tap that did nothing.
    setSelectedShow(show);
    setView('detail');

    if (!e) return;
    try {
      const origin = expandOriginFrom(
        (e.currentTarget as HTMLElement | null)?.getBoundingClientRect(),
        document.querySelector('.app-main')?.getBoundingClientRect(),
      );
      if (origin) setExpandOrigin(origin);
    } catch {
      // The animation is the only thing that can be lost here.
    }
  }

  function handleBack() {
    setView('list');
    setSelectedShow(null);
    setStartInRunShow(false);
  }

  /**
   * Run Show, straight from the dashboard.
   *
   * The show page still mounts underneath — live mode is a layer over it, and
   * closing live mode should land on the show, not back on the list you came
   * from. Passing no event skips the expand animation, which has no card to
   * expand from here.
   */
  function handleRunShowFromDashboard(show: Show) {
    handleSelectShow(show, undefined, true);
  }

  /**
   * Opening something puts you at the top of it.
   *
   * Nothing reset the scroll position when the view changed, and the whole app
   * lives in one scrolling document — so tapping a show inherited wherever the
   * shows grid happened to be. On a phone the grid is a single very tall
   * column, so a show a few rows down opened with its title and its Back
   * button a thousand pixels above the viewport: you'd be looking at the
   * bottom of the show page, which reads exactly like the tap having done
   * nothing at all.
   *
   * Going back is the one direction that shouldn't jump — returning to the
   * list drops you where you left it, next to the show you just opened.
   */
  useEffect(() => {
    window.scrollTo(0, view === 'list' ? listScrollRef.current : 0);
  }, [view, selectedShow?.id]);

  // totalSceneCount retained for future use

  // Search + status filtering for the shows list.
  const normalizedQuery = searchQuery.trim().toLowerCase();
  // The at-a-glance row narrows this list; the ids come from the same
  // buildOverview the row counts with, so the count and the grid can't disagree.
  const focusIds = (() => {
    if (!showsFocus) return null;
    const overview = buildOverview(shows);
    return new Set(overview.attention.map((item) => item.show.id));
  })();

  const filteredShows = shows.filter((show) => {
    if (focusIds && !focusIds.has(show.id)) return false;
    if (!normalizedQuery) return true;
    return [show.name, show.venueName, show.location]
      .some((field) => field?.toLowerCase().includes(normalizedQuery));
  });


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

  function clearFilters() {
    setSearchQuery('');
    setShowsFocus(null);
  }


  // What this producer calls the people in their Rolodex (Comics, Queens, …),
  // derived from their show types and overridable in Settings.
  const rolodexTerm = getRolodexTerm(settings);

  // Public read-only routes — no auth required.
  const search = new URLSearchParams(window.location.search);
  const viewToken = search.get('view');
  if (viewToken) {
    return <LiveViewer token={viewToken} />;
  }
  // A contract someone was asked to sign. No account, and none offered — the
  // token addresses the row and the key rides in the fragment.
  // A performer answering a profile link. Checked before the signing link
  // for the same reason that one is checked before the app: the person
  // holding it has no account, and must never be shown a login.
  const profileToken = search.get('profile');
  if (profileToken) {
    return (
      <ProfilePage token={profileToken} profileKey={readSignKeyFromHash(window.location.hash)} />
    );
  }

  const signToken = search.get('sign');
  if (signToken) {
    return <SigningPage token={signToken} signKey={readSignKeyFromHash(window.location.hash)} />;
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
      ) : loadingData ? (
        <div className="app">
          <div className="app-loading" role="status" aria-live="polite" aria-label="Loading your shows">
            <div className="app-loading__skeletons" aria-hidden="true">
              <div className="skeleton-tile-row">
                <div className="skeleton skeleton--tile" />
                <div className="skeleton skeleton--tile" />
              </div>
              <div className="skeleton skeleton--bar" />
              <div className="skeleton skeleton--card" />
              <div className="skeleton skeleton--card" />
              <div className="skeleton skeleton--card" />
            </div>
          </div>
        </div>
      ) : !settings.onboarded ? (
        <Onboarding
          username={session.username}
          onComplete={handleCompleteOnboarding}
          saving={onboardingSaving}
        />
      ) : (
        <div className="app">
          {/* Everything that reports on the state of your data, in one stack:
              problems that need you first, then the always-on sync pill. */}
          <div className="status-rail">
            {/* Some rows came back but wouldn't decrypt on this device. Say so
                plainly — a short list with no explanation reads as lost data,
                and these shows are neither lost nor at risk: they're carried
                back to the server untouched on every save. */}
            {unreadableCount > 0 && (
              <div className="system-notice" role="alert">
                <Icon name="alert" size={16} className="system-notice__icon" aria-hidden />
                <div className="system-notice__body">
                  <span className="system-notice__text">
                    {unreadableCount === 1
                      ? "1 show couldn't be opened on this device, so it isn't in your shows list."
                      : `${unreadableCount} shows couldn't be opened on this device, so they aren't in your shows list.`}
                  </span>
                  <span className="system-notice__reassurance">
                    They're still on your account and nothing here will overwrite them. Try
                    refreshing, or signing out and back in.
                  </span>
                </div>
                <button
                  className="system-notice__close"
                  onClick={() => setUnreadableCount(0)}
                  aria-label="Dismiss"
                >
                  ×
                </button>
              </div>
            )}
            {loadError && (
              <div className="system-notice" role="alert">
                <Icon name="alert" size={16} className="system-notice__icon" aria-hidden />
                <div className="system-notice__body">
                  <span className="system-notice__text">{loadError}</span>
                  <span className="system-notice__reassurance">
                    Nothing has been deleted — this is a connection problem, not a data problem.
                  </span>
                </div>
                <button
                  className="system-notice__close"
                  onClick={() => setLoadError(null)}
                  aria-label="Dismiss"
                >
                  ×
                </button>
              </div>
            )}
            {localBackupFailed && <div className="system-notice" role="alert">This browser could not store a backup. Keep this page open and download a backup of your work.</div>}
            {saveError && (
              <div className="system-notice" role="alert">
                <Icon name="alert" size={16} className="system-notice__icon" aria-hidden />
                <div className="system-notice__body">
                  <span className="system-notice__text">{saveError}</span>
                  <span className="system-notice__reassurance">
                    Download a backup to keep a separate copy of your current work.
                  </span>
                </div>
                <button
                  className="system-notice__close"
                  onClick={() => setSaveError(null)}
                  aria-label="Dismiss"
                >
                  ×
                </button>
              </div>
            )}
            <div className="status-rail__pill-row">
              <button
                className="navigation-toggle"
                type="button"
                popoverTarget="primary-navigation"
                aria-label="Open navigation menu"
                aria-expanded={navigationOpen}
                aria-controls="primary-navigation"
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>
              <span className="mobile-brand"><BrandMark /><span>I Can Run A Show</span></span>
              <SyncStatus
                state={syncState}
                lastSavedAt={lastSavedAt}
                hasLocalCopy={hasLocalCopy}
                lastBackupAt={lastBackupAt}
                onDownloadBackup={handleDownloadBackup}
              />
            </div>
          </div>
          <main className="app-main">
            {/* In the flow, at the top. It used to be a fixed banner floating
                just above the bottom nav, and on iOS Safari it shows on every
                visit until dismissed — 121px of it, at z-index 200, sitting
                over the bottom of the shows list. Cards underneath took the
                tap and did nothing, which reads as the app being broken. A
                prompt to install is never worth covering the thing you came
                to use. */}
            <InstallPrompt onShownChange={setInstallPromptShown} />

            {view === 'list' && (
              <div className="shows-list">
                <PageHeader
                  title="Shows"
                  subtitle="Your production desk. From first booking to final bow."
                  actions={
                    // With no shows yet the empty state carries the call to
                    // action, so there's only ever one "New Show" button on
                    // screen at a time.
                    shows.length > 0 ? (
                      <button
                        className="btn btn--primary btn--sm page-header__new"
                        onClick={() => setShowForm(true)}
                        // The noun below is hidden with display: none at phone
                        // width, which takes it out of the accessible name as
                        // well as off the screen — leaving the button called
                        // "+ New". Named explicitly so what it is called does
                        // not depend on how wide the screen is.
                        aria-label="New show"
                      >
                        {/* On a phone the filled button measured 153px against
                            a 98px page title — the loudest object on the
                            screen was the secondary action. The page is called
                            "Shows"; the button does not need to say it again,
                            so the noun drops away at phone width and the
                            button comes back to the title's size. */}
                        + New<span className="page-header__new-noun"> Show</span>
                      </button>
                    ) : undefined
                  }
                />
                {!backupNudgeDismissed && !installPromptShown
                  && shouldNudgeBackup(shows.length, lastBackupAt) && (
                  <div className="backup-nudge" role="status">
                    <Icon name="shield" size={16} className="backup-nudge__icon" aria-hidden />
                    <span className="backup-nudge__text">Keep your own copy</span>
                    <div className="backup-nudge__actions">
                      <button
                        className="btn btn--secondary btn--sm backup-nudge__btn"
                        onClick={handleDownloadBackup}
                        aria-label="Download a backup file of your shows"
                      >
                        Back up
                      </button>
                      <button
                        className="backup-nudge__close"
                        onClick={() => setBackupNudgeDismissed(true)}
                        aria-label="Dismiss backup reminder"
                      >
                        ×
                      </button>
                    </div>
                  </div>
                )}
                {shows.length > 0 && (
                  <div className="shows-toolbar">
                    <input
                      className="shows-toolbar__search"
                      type="search"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      // One word, because on a phone this field is ~155px wide
                      // once the sort and view controls have taken theirs, and
                      // a placeholder does not ellipsize — the longer version
                      // rendered as "Search shov".
                      placeholder="Search"
                      aria-label="Search shows"
                    />
                    {showsView === 'grid' && (
                      <select
                        className="shows-toolbar__sort"
                        value={sortBy}
                        onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                        aria-label="Sort shows"
                      >
                        <option value="added">Recent</option>
                        <option value="date-asc">Soonest</option>
                        <option value="date-desc">Latest</option>
                        <option value="name">A–Z</option>
                      </select>
                    )}
                    <div className="shows-toolbar__view" role="group" aria-label="View mode">
                      <button
                        className={`shows-toolbar__view-btn${showsView === 'grid' ? ' shows-toolbar__view-btn--active' : ''}`}
                        onClick={() => setShowsView('grid')}
                        aria-pressed={showsView === 'grid'}
                        aria-label="List view"
                        title="List view"
                      >
                        <svg viewBox="0 0 20 20" fill="currentColor" width="18" height="18" aria-hidden="true"><path d="M2 5a1 1 0 011-1h14a1 1 0 010 2H3a1 1 0 01-1-1zm0 5a1 1 0 011-1h14a1 1 0 010 2H3a1 1 0 01-1-1zm0 5a1 1 0 011-1h14a1 1 0 010 2H3a1 1 0 01-1-1z"/></svg>
                      </button>
                      <button
                        className={`shows-toolbar__view-btn${showsView === 'calendar' ? ' shows-toolbar__view-btn--active' : ''}`}
                        onClick={() => setShowsView('calendar')}
                        aria-pressed={showsView === 'calendar'}
                        aria-label="Calendar view"
                        title="Calendar view"
                      >
                        <svg viewBox="0 0 20 20" fill="currentColor" width="18" height="18" aria-hidden="true"><path fillRule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clipRule="evenodd"/></svg>
                      </button>
                    </div>
                  </div>
                )}

                <ShowsDashboard
                  shows={shows}
                  focus={showsFocus}
                  onFocusChange={setShowsFocus}
                  onSelectShow={handleSelectShow}
                  onRunShow={handleRunShowFromDashboard}
                />

                {shows.length === 0 ? (
                  <div className="empty-state">
                    <h2 className="empty-state__title">No shows yet</h2>
                    <p className="empty-state__text">
                      Create a show to build its lineup, run-of-show, and live mode.
                    </p>
                    <button className="btn btn--primary" onClick={() => setShowForm(true)}>
                      + New Show
                    </button>
                  </div>
                ) : filteredShows.length === 0 ? (
                  <div className="empty-state">
                    <h2 className="empty-state__title">No matches</h2>
                    <p className="empty-state__text">
                      {searchQuery.trim()
                        ? `No shows match “${searchQuery.trim()}”.`
                        : 'Nothing left in this list.'}
                    </p>
                    <button className="btn btn--secondary" onClick={clearFilters}>
                      {searchQuery.trim() ? 'Clear search' : 'Show all'}
                    </button>
                  </div>
                ) : shows.length === 1 &&
                  buildOverview(shows).nextShow?.id === shows[0].id &&
                  showsView === 'grid' &&
                  !showsFocus &&
                  !searchQuery.trim() ? (
                  // One show, printed twice: the panel above already gives its
                  // name, its date, what it still needs and a way into it, and
                  // then "ALL SHOWS 1" repeated the same show underneath. A
                  // list of one is not a list. The calendar still draws it,
                  // because a month with one show on it is a different answer —
                  // and a search or a filter is a question about the list, so
                  // the list comes back to answer it.
                  //
                  // Only when the panel is genuinely showing *this* show. It
                  // leads with a show that is dated and still ahead, so an
                  // undated one, a cancelled one, or — the one that would have
                  // bitten — the morning after the only show on the books,
                  // once it auto-completes, all leave the panel saying
                  // "Nothing dated yet". Hiding the list on top of that would
                  // leave the producer's only show nowhere on the page.
                  null
                ) : (
                  <>
                    {/* Above both views: whichever one you're in, the question
                        "where are the rest of my shows?" is the same. */}
                    {/* Names the list now that panels sit above it — without
                        a heading the grid reads as a continuation of the
                        dashboard rather than as the full set of shows. */}
                    <div className="shows-list__heading">
                      <h2 className="shows-list__heading-text">All shows</h2>
                      <span className="shows-list__heading-count">{filteredShows.length}</span>
                    </div>
                    <NarrowedNotice
                      shown={filteredShows.length}
                      total={shows.length}
                      onClear={clearFilters}
                    />
                    {showsView === 'calendar' ? (
                      <ShowsCalendar shows={filteredShows} onSelectShow={handleSelectShow} />
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
                      </div>
                    )}
                  </>
                )}

              </div>
            )}

            {view === 'music' && (
              <MusicLibrary
                tracks={settings.musicLibrary ?? []}
                shows={shows}
                onChange={handleUpdateMusicLibrary}
                onBack={handleBack}
              />
            )}

            {view === 'more' && (
              <MorePage
                onBack={handleBack}
                destinations={[
                  {
                    key: 'contracts',
                    label: 'Contracts',
                    description: signatureSummary(settings.signatureRequests ?? []).waiting > 0
                      ? `${signatureSummary(settings.signatureRequests ?? []).waiting} waiting to be signed`
                      : 'Agreements to be signed',
                    icon: 'file',
                    badge: signatureSummary(settings.signatureRequests ?? []).waiting || undefined,
                    onSelect: () => setView('contracts'),
                  },
                  {
                    key: 'emails',
                    label: 'Email list',
                    description: 'Addresses you collect at shows',
                    icon: 'mail',
                    onSelect: () => setView('emails'),
                  },
                  {
                    key: 'expenses',
                    label: 'Expenses',
                    description: 'What the shows are costing you',
                    icon: 'dollar',
                    onSelect: () => setView('expenses'),
                  },
                ]}
              />
            )}

            {view === 'emails' && (
              <div className="email-list-page">
                <PageHeader
                  title="Email List"
                  subtitle="Emails you collect at shows, kept in one place. Nothing is ever sent from here — they're only stored."
                  onBack={() => setView('more')}
                  backLabel="More"
                />

                <form
                  className="email-list__form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleAddEmailToList();
                  }}
                >
                  <input
                    className="rolodex__input"
                    type="email"
                    inputMode="email"
                    autoComplete="off"
                    value={newListEmail}
                    onChange={(e) => setNewListEmail(e.target.value)}
                    placeholder="name@example.com"
                    aria-label="Email address"
                  />
                  <button
                    className="btn btn--secondary"
                    type="submit"
                    disabled={!newListEmail.trim()}
                  >
                    Add
                  </button>
                </form>

                {settings.emailList.length === 0 ? (
                  <div className="empty-state">
                    <h2 className="empty-state__title">No emails yet</h2>
                    <p className="empty-state__text">
                      Add an address above to start building your list.
                    </p>
                  </div>
                ) : (
                  <>
                    <p className="email-list__count">
                      {settings.emailList.length} {settings.emailList.length === 1 ? 'email' : 'emails'} collected
                    </p>
                    <ul className="email-list__entries">
                      {settings.emailList.map((entry) => (
                        <li key={entry.id} className="email-list__entry">
                          <span className="email-list__address">{entry.email}</span>
                          <button
                            className="email-list__remove"
                            type="button"
                            onClick={() => handleRemoveEmailFromList(entry.id)}
                            aria-label={`Remove ${entry.email}`}
                          >
                            ×
                          </button>
                        </li>
                      ))}
                    </ul>
                  </>
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
                  show={selectedShow}
                  settings={settings}
                  startInRunShow={startInRunShow}
                  onBack={handleBack}
                  onUpdate={handleUpdateShow}
                  session={session ?? undefined}
                  onUpdateSettings={(updated) => {
                    setSettings(updated);
                    saveSettings(updated);
                  }}
                  onSaveToRolodex={handleSavePerformerToRolodex}
                  onSaveScheduleTemplate={handleSaveScheduleTemplate}
                  onDeleteScheduleTemplate={handleDeleteScheduleTemplate}
                  onDuplicate={handleDuplicateShow}
                  onRepeat={handleRepeatShow}
                  onDelete={handleDeleteShow}
                />
              </div>
            )}

            {view === 'contracts' && session && (
              <Contracts
                settings={settings}
                session={session}
                onBack={() => setView('more')}
                backLabel="More"
                onUpdateSettings={(updated) => {
                  setSettings(updated);
                  saveSettings(updated);
                }}
              />
            )}

            {view === 'expenses' && (
              <Expenses
                settings={settings}
                onBack={() => setView('more')}
                backLabel="More"
                onUpdateSettings={(updated) => {
                  // Persist through the retrying saver (with local backup),
                  // and stay on this page — handleSaveSettings is the Settings
                  // form's submit (it navigates away and drops edits on error).
                  setSettings(updated);
                  saveSettings(updated);
                }}
              />
            )}

            {view === 'rolodex' && (
              <div className="rolodex-page">
                <RolodexRefresh
                  requests={settings.profileRequests ?? []}
                  onFound={(updated) => {
                    // Merge by token rather than replace: `updated` is the list
                    // as it stood when the check began, and a link made since
                    // then is not in it.
                    const found = new Map(updated.filter(r => r.submitted).map(r => [r.token, r]));
                    const merged = (settings.profileRequests ?? []).map(r => found.get(r.token) ?? r);
                    const updatedSettings = { ...settings, profileRequests: merged };
                    setSettings(updatedSettings);
                    saveSettings(updatedSettings);
                  }}
                />
                <PageHeader
                  title={`${rolodexTerm.singular} Rolodex`}
                  subtitle={`Keep a running list of ${rolodexTerm.plural.toLowerCase()} you want to book next.`}
                  onBack={handleBack}
                  backLabel="Shows"
                />

                {/* A form rather than a div: a name box beside an Add button
                    should take Enter, which is how everyone tries it first. */}
                <form
                  className="rolodex__form"
                  onSubmit={(e) => { e.preventDefault(); handleAddPotentialComic(); }}
                >
                  <input
                    className="rolodex__input"
                    value={newComicName}
                    onChange={(e) => setNewComicName(e.target.value)}
                    placeholder={`${rolodexTerm.singular} name`}
                  />
                  {/* Only once there is a name to attach them to. A second
                      full-width box for optional notes sat above the list
                      permanently, and filing someone in a rolodex is a name —
                      the notes are something you have or you don't. */}
                  {newComicName.trim() !== '' && (
                    <input
                      className="rolodex__input rolodex__input--notes"
                      value={newComicNotes}
                      onChange={(e) => setNewComicNotes(e.target.value)}
                      placeholder="Notes (style, contact, socials, etc.)"
                    />
                  )}
                  <button
                    className="btn btn--secondary rolodex__add"
                    type="submit"
                    disabled={!newComicName.trim()}
                  >
                    Add
                  </button>
                </form>

                {settings.potentialComics.length === 0 ? (
                  <div className="empty-state">
                    <h2 className="empty-state__title">No {rolodexTerm.plural.toLowerCase()} yet</h2>
                    <p className="empty-state__text">
                      Add someone above, or save a performer from a show to keep their details here.
                    </p>
                  </div>
                ) : (
                  <div className="rolodex__list">
                    {settings.potentialComics.map((comic) => {
                      const pending = pendingProfileImport(comic);
                      return (
                        <RolodexRow
                          key={comic.id}
                          comic={comic}
                          onEdit={() => setSelectedComicId(comic.id)}
                          linkStatus={profileLinkStatus(settings.profileRequests, comic.id)}
                          linkUrl={freshLink?.contactId === comic.id ? freshLink.url : undefined}
                          linkBusy={linkBusyFor === comic.id}
                          onRequestDetails={() => void handleRequestDetails(comic)}
                          pending={pending?.changes}
                          onImport={() => void handleImportProfile(comic)}
                          pendingPhoto={pending?.photo}
                          onSkipImport={() => handleSkipProfile(comic)}
                          linkError={linkErrorFor === comic.id ? (linkError ?? undefined) : undefined}
                        />
                      );
                    })}
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
                username={session.username}
                onLogout={handleLogout}
                onRestoreShow={handleRestoreShow}
                onDeleteForever={handleDeleteForever}
                onEmptyTrash={handleEmptyTrash}
                onSweepMedia={loadError ? undefined : handleSweepMedia}
                onExport={handleDownloadBackup}
                onListSnapshots={loadError ? undefined : handleListSnapshots}
                onRestoreSnapshot={handleRestoreSnapshot}
                lastBackupAt={lastBackupAt}
                lastSavedAt={lastSavedAt}
              />
            )}
          </main>

          {/* Desktop uses a native popover for outside-click and Escape dismissal;
              the same destinations remain in the phone's bottom bar. */}
          <nav
            ref={navigationRef}
            id="primary-navigation"
            className="bottom-nav"
            popover={desktopNavigation ? 'auto' : undefined}
            aria-label="Primary navigation"
            onToggle={(event) => {
              const open = event.newState === 'open';
              setNavigationOpen(open);
              if (open) navigationRef.current?.querySelector<HTMLButtonElement>('[aria-current="page"]')?.focus();
            }}
          >
            <div className="bottom-nav__brand">
              <BrandMark />
              <span className="bottom-nav__brand-text">I Can Run A Show</span>
            </div>

            <div className="bottom-nav__items">
              {NAV_ITEMS.map((item) => {
                const active = item.views.includes(view);
                return (
                  <button
                    key={item.id}
                    className={`bottom-nav__item${active ? ' bottom-nav__item--active' : ''}`}
                    aria-current={active ? 'page' : undefined}
                    onClick={() => {
                      if (desktopNavigation) navigationRef.current?.hidePopover();
                      if (item.id === 'list') {
                        handleBack();
                      } else {
                        setView(item.id);
                        setSelectedShow(null);
                      }
                    }}
                  >
                    <svg className="bottom-nav__item-icon" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                      <path fillRule="evenodd" clipRule="evenodd" d={item.icon} />
                    </svg>
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>
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

```

## Shared page title, back control, subtitle and actions.

### `src/components/PageHeader.tsx`

```tsx
import './PageHeader.css';

interface PageHeaderProps {
  /** The screen's name. Always rendered as the page's single <h1>. */
  title: string;
  /** One line explaining what the screen is for. Optional. */
  subtitle?: string;
  /** Renders the standard back control when the screen is a sub-page. */
  onBack?: () => void;
  /** What the back control returns to, e.g. "Shows". */
  backLabel?: string;
  /** Primary/secondary controls for this screen, right-aligned next to the title. */
  actions?: React.ReactNode;
}

/**
 * The one page header every screen uses. Before this, each screen invented its
 * own arrangement of back button, title, and actions (and the shows list had no
 * title at all on phones), so moving between screens felt like moving between
 * different apps. Keeping the chrome identical is what makes the app feel
 * familiar — you always know where you are and where "back" is.
 */
export function PageHeader({ title, subtitle, onBack, backLabel = 'Back', actions }: PageHeaderProps) {
  return (
    <header className="page-header">
      {onBack && (
        <button type="button" className="page-header__back" onClick={onBack}>
          <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16" aria-hidden="true">
            <path
              fillRule="evenodd"
              d="M12.707 4.293a1 1 0 010 1.414L8.414 10l4.293 4.293a1 1 0 01-1.414 1.414l-5-5a1 1 0 010-1.414l5-5a1 1 0 011.414 0z"
              clipRule="evenodd"
            />
          </svg>
          <span>{backLabel}</span>
        </button>
      )}
      <div className="page-header__row">
        <h1 className="page-header__title">{title}</h1>
        {actions && <div className="page-header__actions">{actions}</div>}
      </div>
      {subtitle && <p className="page-header__subtitle">{subtitle}</p>}
    </header>
  );
}

```

### `src/components/PageHeader.css`

```css
/* Shared page chrome. Every screen renders this and nothing else above its
   content, so the title, the back control, and the primary action are always
   in the same place. */

.page-header {
  display: flex;
  flex-direction: column;
  gap: var(--space-1-5);
  margin-bottom: var(--space-5);
}

/* Back sits above the title (never beside it) so the title's position never
   shifts between a top-level screen and a sub-page. */
.page-header__back {
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  min-height: 36px;
  margin-left: -var(--space-2);
  padding: var(--space-1-5) var(--space-2-5) var(--space-1-5) var(--space-2);
  border: 0;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--text-muted);
  font-family: inherit;
  font-size: var(--text-md);
  font-weight: 600;
  cursor: pointer;
  touch-action: manipulation;
  transition: color var(--duration-fast) ease, background-color var(--duration-fast) ease;
}

.page-header__back:hover {
  color: var(--text);
  background: var(--surface-strong);
}

.page-header__back:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
}

@media (pointer: coarse) {
  .page-header__back {
    min-height: var(--tap-min);
  }
}

.page-header__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  flex-wrap: wrap;
}

.page-header__title {
  margin: 0;
  font-size: var(--text-2xl);
  font-weight: 800;
  letter-spacing: -0.03em;
  line-height: 1.15;
  color: var(--text);
  word-break: break-word;
}

.page-header__actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-shrink: 0;
}

.page-header__subtitle {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--text-md);
  line-height: 1.45;
  max-width: 60ch;
}

@media (max-width: 640px) {
  .page-header {
    margin-bottom: var(--space-4);
  }

  .page-header__title {
    font-size: var(--text-2xl);
  }
}

/* The noun the page title already says. Dropping it takes the primary button
   from 153px to roughly the width of the title beside it, which is the size a
   secondary action should be — you open this app to look at your shows far
   more often than to make one. */

/* The space before it has to be drawn, not typed. `.btn` is inline-flex, so
   "+ New" and this span are two flex items and the leading space in the text
   node is collapsed away — the button read "+ NewShow". A margin survives
   that, and disappears with the word when the noun is hidden below. */
.page-header__new-noun {
  margin-left: 0.28em;
}

@media (max-width: 619px) {
  .page-header__new-noun {
    display: none;
  }
}

```

## Persistent account save status rail content.

### `src/components/SyncStatus.tsx`

```tsx
import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import { lastSavedSentence } from '../utils/relativeTime';
import './SyncStatus.css';

/**
 * Where the user's work currently lives.
 *
 * - `saving`   — a save is in flight
 * - `saved`    — everything is on the server, encrypted
 * - `retrying` — the last save failed; a local copy is held and we're retrying
 * - `offline`  — no connection; a local copy is held and will sync on reconnect
 * - `blocked`  — the save can never succeed as-is and needs the user to act
 */
export type SyncState = 'saving' | 'saved' | 'retrying' | 'offline' | 'blocked';

interface SyncStatusProps {
  state: SyncState;
  /** Epoch ms of the last confirmed save, or null if nothing has synced yet. */
  lastSavedAt: number | null;
  /** True while unsent edits are parked in this device's local backup. */
  hasLocalCopy: boolean;
  /** ISO date of the last downloaded backup file, or null if never. */
  lastBackupAt: string | null;
  onDownloadBackup?: () => void | Promise<void>;
}

const PILL: Record<SyncState, { label: string; headline: string; detail: string }> = {
  saving: {
    label: 'Saving',
    headline: 'Saving your changes',
    detail: 'Encrypting on this device, then storing it in your account.',
  },
  saved: {
    label: 'Saved',
    headline: 'Everything is saved',
    detail: 'Every change is encrypted here and stored in your account automatically.',
  },
  retrying: {
    label: 'Holding',
    headline: 'Held safely on this device',
    detail:
      "We couldn't reach your account, so your latest work is being kept here and re-sent automatically. Download a backup for a separate copy.",
  },
  offline: {
    label: 'Offline',
    headline: "You're offline",
    detail:
      'Your latest work is kept on this device and syncs the moment you have a connection. Keep working.',
  },
  blocked: {
    label: 'Needs you',
    headline: 'One change needs your attention',
    detail: 'Your existing work is still saved. The banner above says what to fix.',
  },
};

/**
 * The always-on answer to "is my work safe?".
 *
 * The app already retried failed saves, kept local backups, and encrypted
 * everything client-side — but none of that was visible, so using it felt like
 * typing into a void. This surfaces the guarantees that were always there: a
 * quiet pill on every screen, and a panel that says exactly where the work is.
 */
export function SyncStatus({
  state,
  lastSavedAt,
  hasLocalCopy,
  lastBackupAt,
  onDownloadBackup,
}: SyncStatusProps) {
  const [open, setOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);
  // Re-render on a slow tick so "just now" ages into "4 min ago" on its own.
  const [, setTick] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  // Close on outside click / Escape, like any other transient surface.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent | TouchEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const copy = PILL[state];
  const savedLabel = lastSavedSentence(lastSavedAt);

  async function handleDownload() {
    if (!onDownloadBackup || downloading) return;
    setDownloading(true);
    try {
      await onDownloadBackup();
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className={`sync-status sync-status--${state}`} ref={rootRef}>
      {/* Announced as well as shown, on every screen.
          The pill is a button, and a button's label changing is not something
          a screen reader reports — so "your work is saved" was visible-only.
          Show detail used to carry its own live region for this, which is why
          the app had two save messages at once; the announcement belongs with
          the state it describes, and this is where that state lives. */}
      <span className="visually-hidden" role="status" aria-live="polite">
        {copy.headline}
      </span>
      <button
        type="button"
        className="sync-status__pill"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`${copy.headline}. ${savedLabel} Open data safety details.`}
      >
        <span className="sync-status__dot" aria-hidden="true" />
        <span className="sync-status__label">{copy.label}</span>
      </button>

      {open && (
        <div className="sync-status__panel" role="dialog" aria-label="Where your work is stored">
          <div className="sync-status__panel-head">
            <span className="sync-status__dot sync-status__dot--lg" aria-hidden="true" />
            <div>
              <p className="sync-status__headline">{copy.headline}</p>
              <p className="sync-status__detail">{copy.detail}</p>
            </div>
          </div>

          <ul className="sync-status__facts">
            <li className="sync-status__fact">
              <Icon name="lock" size={15} aria-hidden />
              <div>
                <strong>Encrypted before it leaves this device</strong>
                <span>
                  Your password is the key. It's used at sign-in and then discarded — never sent
                  anywhere, never stored in this browser. Nobody else can read your shows.
                </span>
              </div>
            </li>
            <li className="sync-status__fact">
              <Icon name="cloud" size={15} aria-hidden />
              <div>
                <strong>Stored in your account</strong>
                <span>
                  {savedLabel} Saves happen on their own as you work — there is no save button to
                  forget.
                </span>
              </div>
            </li>
            <li className="sync-status__fact">
              <Icon name="shield" size={15} aria-hidden />
              <div>
                <strong>{hasLocalCopy ? 'Spare copy held on this device' : 'Safety net on this device'}</strong>
                <span>
                  {hasLocalCopy
                    ? 'Unsent edits are stored here too. They can be recovered on your next visit. Download a backup for a separate copy.'
                    : 'If a save ever fails, your edits are parked on this device and re-sent automatically. Keep this page open if the browser reports it cannot store a backup.'}
                </span>
              </div>
            </li>
            <li className="sync-status__fact">
              <Icon name="download" size={15} aria-hidden />
              <div>
                <strong>Your own copy</strong>
                <span>
                  {lastBackupAt
                    ? `Last backup downloaded ${new Date(lastBackupAt).toLocaleDateString(undefined, {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })}.`
                    : "You haven't downloaded a backup file yet."}{' '}
                  A backup is a plain file you keep — readable without this app.
                </span>
              </div>
            </li>
          </ul>

          {onDownloadBackup && (
            <button
              type="button"
              className="btn btn--secondary btn--sm sync-status__backup-btn"
              onClick={handleDownload}
              disabled={downloading}
            >
              {downloading ? 'Preparing…' : 'Download a backup'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

```

### `src/components/SyncStatus.css`

```css
/* ── Sync status ──────────────────────────────────────────────────────
   A quiet, always-present pill. It should read as reassurance at a glance
   and never compete with the work: muted when everything is fine, warmer
   only when it needs to tell you something. */

.sync-status {
  position: relative;
  pointer-events: auto;
}

.sync-status__pill {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1-5);
  padding: var(--space-1) var(--space-2-5) var(--space-1) var(--space-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-full);
  background: var(--surface);
  box-shadow: var(--shadow-sm);
  color: var(--text-muted);
  font-size: var(--text-xs);
  font-weight: 600;
  letter-spacing: 0.01em;
  line-height: 1;
  cursor: pointer;
  transition:
    color var(--duration-normal) var(--ease-out),
    border-color var(--duration-normal) var(--ease-out),
    box-shadow var(--duration-normal) var(--ease-out);
}

.sync-status__pill:hover {
  color: var(--text);
  border-color: var(--border-strong);
  box-shadow: var(--shadow-md);
}

.sync-status__pill:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
}

/* The state light. Colour carries the meaning; the label repeats it in words
   so it never depends on colour alone. */
.sync-status__dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
  background: var(--success);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--success) 18%, transparent);
}

.sync-status__dot--lg {
  width: 9px;
  height: 9px;
  margin-top: var(--space-1);
}

.sync-status--saving .sync-status__dot {
  background: var(--text-soft);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--text-soft) 22%, transparent);
  animation: sync-pulse 1.4s var(--ease-out) infinite;
}

.sync-status--retrying .sync-status__dot,
.sync-status--offline .sync-status__dot {
  background: var(--warning);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--warning) 20%, transparent);
}

.sync-status--blocked .sync-status__dot {
  background: var(--primary);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--primary) 20%, transparent);
}

.sync-status--retrying .sync-status__pill,
.sync-status--offline .sync-status__pill {
  color: var(--warning);
  border-color: var(--warning-soft-border);
  background: var(--warning-soft);
}

.sync-status--blocked .sync-status__pill {
  color: var(--primary-text);
  border-color: var(--primary-soft-border);
  background: var(--primary-soft);
}

@keyframes sync-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.35;
  }
}

@media (prefers-reduced-motion: reduce) {
  .sync-status--saving .sync-status__dot {
    animation: none;
  }
}

/* ── Detail panel ────────────────────────────────────────────────── */

.sync-status__panel {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  width: min(21rem, calc(100vw - 24px));
  padding: var(--space-4);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  text-align: left;
  animation: sync-panel-in var(--duration-normal) var(--ease-out);
}

@keyframes sync-panel-in {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .sync-status__panel {
    animation: none;
  }
}

.sync-status__panel-head {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2-5);
  padding-bottom: var(--space-3);
  border-bottom: 1px solid var(--border);
}

.sync-status__headline {
  margin: 0;
  font-size: var(--text-md);
  font-weight: 650;
  color: var(--text);
  line-height: 1.3;
}

.sync-status__detail {
  margin: var(--space-1) 0 0;
  font-size: var(--text-xs);
  line-height: 1.5;
  color: var(--text-muted);
}

.sync-status__facts {
  list-style: none;
  margin: var(--space-3) 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.sync-status__fact {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2-5);
}

.sync-status__fact svg {
  flex-shrink: 0;
  margin-top: var(--space-0-5);
  color: var(--text-soft);
}

.sync-status__fact strong {
  display: block;
  font-size: var(--text-xs);
  font-weight: 650;
  color: var(--text);
  line-height: 1.35;
}

.sync-status__fact span {
  display: block;
  margin-top: var(--space-0-5);
  font-size: var(--text-xs);
  line-height: 1.5;
  color: var(--text-muted);
}

.sync-status__backup-btn {
  width: 100%;
  margin-top: var(--space-4);
}

/* On phones the panel is anchored to the pill in the top-right corner, so it
   gets the full width it can and stays clear of the screen edge. */
@media (max-width: 560px) {
  .sync-status__panel {
    position: fixed;
    top: calc(env(safe-area-inset-top) + 46px);
    right: 12px;
    left: 12px;
    width: auto;
  }
}

```

## Root recoverable error view.

### `src/components/ErrorBoundary.tsx`

```tsx
import { Component } from 'react';
import type { ReactNode, ErrorInfo } from 'react';
import './ErrorBoundary.css';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('ErrorBoundary caught:', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary">
          <h1 className="error-boundary__heading">Something went wrong</h1>
          <p className="error-boundary__message">
            Don't worry — your data is safe. Try refreshing the page.
          </p>
          <p className="error-boundary__detail">{this.state.error?.message}</p>
          <button className="error-boundary__reload" onClick={() => window.location.reload()}>
            Reload App
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

```

### `src/components/ErrorBoundary.css`

```css
.error-boundary {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 100dvh;
  padding: var(--space-8);
  text-align: center;
  background: var(--bg);
  color: var(--text);
  /* The one screen that must not depend on Inter having loaded: if the render
     crashed, the webfont may be why. system-ui is always there. */
  font-family: system-ui, sans-serif;
}

.error-boundary__heading {
  font-size: var(--text-3xl);
  margin-bottom: var(--space-3);
}

.error-boundary__message {
  color: var(--text-muted);
  margin-bottom: var(--space-6);
  max-width: 420px;
  line-height: 1.5;
}

.error-boundary__detail {
  color: var(--text-soft);
  font-size: var(--text-sm);
  font-family: var(--font-mono);
  margin-bottom: var(--space-6);
  max-width: 500px;
  word-break: break-word;
}

.error-boundary__reload {
  background: var(--primary);
  color: var(--on-primary);
  border: none;
  padding: var(--space-3) var(--space-8);
  border-radius: var(--radius-md);
  font-size: var(--text-base);
  font-family: inherit;
  font-weight: 600;
  cursor: pointer;
}

.error-boundary__reload:hover {
  opacity: 0.9;
}

```

## Shared install overlay.

### `src/components/InstallPrompt.tsx`

```tsx
import { useEffect, useState } from 'react';
import { isIOS, isMobile, isStandalone } from '../utils/installPrompt';
import './InstallPrompt.css';

const DISMISSED_KEY = 'showrunner:installPromptDismissed';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/**
 * Nudges mobile-browser visitors to install the PWA, where it runs full-screen
 * with no address bar — the actual "native app" experience. Android gets the
 * real one-tap install prompt; iOS Safari has no such API, so it gets the
 * manual Share -> Add to Home Screen instructions instead.
 */
interface InstallPromptProps {
  /**
   * Called whenever the prompt appears or goes away. The page above it has a
   * banner of its own, and two "not now" rows stacked over your shows is one
   * more than a phone can spare — so the page uses this to hold its own back
   * until this one is gone.
   */
  onShownChange?: (shown: boolean) => void;
}

export function InstallPrompt({ onShownChange }: InstallPromptProps = {}) {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISSED_KEY) === '1';
    } catch {
      return false;
    }
  });
  // Computed once at mount (not in an effect) — iOS has no install event to
  // listen for, so there's no external state to synchronize here.
  const [showIOSHint] = useState(() => !isStandalone() && isMobile() && isIOS());

  useEffect(() => {
    if (dismissed || isStandalone() || !isMobile() || isIOS()) return;

    function onBeforeInstallPrompt(e: Event) {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
  }, [dismissed]);

  function dismiss() {
    setDismissed(true);
    setDeferredPrompt(null);
    try {
      localStorage.setItem(DISMISSED_KEY, '1');
    } catch {
      /* ignore */
    }
  }

  async function install() {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    setDeferredPrompt(null);
  }

  const shown = !dismissed && (!!deferredPrompt || showIOSHint);

  useEffect(() => {
    onShownChange?.(shown);
  }, [shown, onShownChange]);

  if (!shown) return null;

  return (
    <div className="install-prompt" role="status">
      {deferredPrompt ? (
        <>
          {/* Short enough to hold one line on a phone. The long version wrapped
              to three, which is a lot of screen to spend asking. */}
          <span className="install-prompt__text">Install the app — no browser bar, works offline.</span>
          <div className="install-prompt__actions">
            <button className="btn btn--primary btn--sm" onClick={install}>Install</button>
            <button className="install-prompt__close" onClick={dismiss} aria-label="Dismiss">×</button>
          </div>
        </>
      ) : (
        <>
          <span className="install-prompt__text">
            Tap <strong>Share</strong>, then <strong>Add to Home Screen</strong>.
          </span>
          <button className="install-prompt__close" onClick={dismiss} aria-label="Dismiss">×</button>
        </>
      )}
    </div>
  );
}

```

### `src/components/InstallPrompt.css`

```css
/* A row in the page, not a banner over it. Fixed and floating above the
   bottom nav, this covered 119px of the first show card on an iPhone — and
   because the iOS hint has no dismissal deadline, it covered it on every
   visit until the × was found. Taps landed on the banner and the show never
   opened. In the flow it cannot obscure anything, and it scrolls away like
   Safari's own smart app banner. */
.install-prompt {
  display: flex;
  align-items: center;
  gap: var(--space-2-5);
  margin-bottom: var(--space-2-5);
  padding: var(--space-1-5) var(--space-3);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
}

/* Caption size, muted, with the two words you actually tap carried by weight
   rather than by the full text colour. At 0.85rem in --text this was the
   boldest thing on the screen, wrapping to two lines above the page's own
   title — an aside, set larger than the content it was interrupting. */
.install-prompt__text {
  flex: 1;
  min-width: 0;
  font-size: var(--text-xs);
  color: var(--text-muted);
  line-height: 1.35;
}

.install-prompt__text strong {
  font-weight: 600;
  color: var(--text);
}

.install-prompt__actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-shrink: 0;
}

.install-prompt__close {
  border: 0;
  background: transparent;
  color: var(--text-muted);
  font-size: var(--text-xl);
  line-height: 1;
  cursor: pointer;
  padding: var(--space-1) var(--space-1-5);
  flex-shrink: 0;
}

```

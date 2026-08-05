import { useEffect, useMemo, useRef, useState } from 'react';
import type { Show, ShowStatus, Scene, AppSettings, SectionKey, TodoItem } from '../types';
import { generateId } from '../utils/id';
import { SceneList } from './SceneList';
import { Icon, type IconName } from './Icon';
import { MoreMenu } from './MoreMenu';
import { BasicInfoSection } from './sections/BasicInfoSection';
import { PerformersSection } from './sections/PerformersSection';
import { ArtistsSection } from './sections/ArtistsSection';
import { ScheduleSection } from './sections/ScheduleSection';
import { DJMusicSection } from './sections/DJMusicSection';
import { StaffSection } from './sections/StaffSection';
import { VendorsSection } from './sections/VendorsSection';
import { ShowRecapSection } from './sections/ShowRecapSection';
import { RunShow } from './RunShow';
import { Modal } from './Modal';
import { exportShowToPDF } from '../utils/pdfExport';
import { parseShowDate, formatShowTime } from '../utils/showDate';
import { joinNames, scheduleSummary, staffSummary, vendorsSummary } from '../utils/sectionSummary';
import { publishLiveView, type LiveViewPayload } from '../utils/liveView';
import { loadColorScheme } from '../utils/theme';
import { buildShowStats, progressPercent, isComplete, formatRunTime } from '../utils/showStats';
import { loadViewerKey, viewerUrl as buildViewerUrl } from '../utils/viewerAudio';
import './ShowDetail.css';
import { useConfirm } from './useConfirm';

// Each section card wears the icon for what it holds, so the grid is scannable
// by shape once you know the page — a wall of same-looking cards is the failure
// mode of a bento layout.
const SECTION_ICONS: Record<string, IconName> = {
  basic: 'file',
  performers: 'users',
  artists: 'sparkle',
  schedule: 'schedule',
  dj: 'music',
  staff: 'wrench',
  vendors: 'bolt',
  recap: 'check',
};

interface ShowDetailProps {
  show: Show;
  settings: AppSettings;
  onBack: () => void;
  onUpdate: (show: Show) => void;
  onSaveToRolodex?: (comic: import('../types').PotentialComic) => void;
}

const STATUS_LABELS: Record<ShowStatus, string> = {
  upcoming: 'Upcoming',
  'in-progress': 'In progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

/** Which sections a producer had open, remembered per show. */
function openSectionsKey(showId: string): string {
  return `showrunner:openSections:${showId}`;
}

function loadOpenSections(showId: string): Set<string> {
  try {
    const raw = localStorage.getItem(openSectionsKey(showId));
    if (raw) return new Set(JSON.parse(raw) as string[]);
  } catch {
    /* ignore */
  }
  // First visit: Basic Info is where every show starts, so it opens by default
  // instead of presenting a wall of closed rows.
  return new Set(['basic']);
}

export function ShowDetail({ show, settings, onBack, onUpdate, onSaveToRolodex }: ShowDetailProps) {
  const { confirm, confirmDialog } = useConfirm();
  // Everyone this producer has on file. The show's own bill comes first so a
  // name spelled slightly differently in the Rolodex doesn't win over the
  // spelling actually used on this lineup.
  const knownNames = useMemo(
    () => [
      ...show.performers.map((p) => p.name),
      ...(show.artists ?? []).map((a) => a.name),
      ...settings.potentialComics.map((c) => c.name),
    ].filter((n) => n?.trim()),
    [show.performers, show.artists, settings.potentialComics],
  );
  // The overview tiles read straight off the show, so they can't drift from the
  // sections below them.
  const stats = useMemo(() => buildShowStats(show), [show]);

  const [expandedSections, setExpandedSections] = useState<Set<string>>(() => loadOpenSections(show.id));
  const [editingShowName, setEditingShowName] = useState(false);
  const [runShowOpen, setRunShowOpen] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerNoteDraft, setViewerNoteDraft] = useState('');
  const [viewerCopied, setViewerCopied] = useState(false);
  const [viewerCopyFailed, setViewerCopyFailed] = useState(false);
  const viewerUrlRef = useRef<HTMLInputElement>(null);
  const [tempShowName, setTempShowName] = useState(show.name);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  // Adding and removing sections happens in one deliberate place, so a stray tap
  // next to the expand chevron can't wipe a section off the show.
  const [manageSectionsOpen, setManageSectionsOpen] = useState(false);

  // Come back to a show and it looks the way you left it.
  useEffect(() => {
    try {
      localStorage.setItem(openSectionsKey(show.id), JSON.stringify([...expandedSections]));
    } catch {
      /* ignore */
    }
  }, [show.id, expandedSections]);

  // Keep the public viewer's pre-show lineup current: whenever an upcoming show's
  // lineup or details change, re-publish the scheduled payload (debounced). Skipped
  // while running so it never clobbers the live on-stage state RunShow publishes.
  useEffect(() => {
    if (!show.viewToken || show.status !== 'upcoming' || runShowOpen) return;
    const timeout = setTimeout(() => {
      publishLiveView(show.viewToken!, buildScheduledPayload(show.viewNote)).catch(() => {});
    }, 1000);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show.viewToken, show.status, runShowOpen, show.name, show.date, show.time, show.viewNote, show.performers]);

  // Show the recap once the show is done — either explicitly marked completed
  // or its date has passed.
  const datePassed = show.date && new Date(show.date) < new Date(new Date().setHours(0, 0, 0, 0));
  const isPastShow = datePassed || show.status === 'completed';

  // A show that has removed the DJ section has no DJ part to run — Run Show
  // shouldn't offer a bank of buttons for a section this show doesn't use.
  const djHidden = (show.hiddenSections || []).includes('dj');

  function openViewer() {
    setViewerNoteDraft(show.viewNote ?? '');
    setViewerCopied(false);
    setViewerCopyFailed(false);
    setViewerOpen(true);
  }

  function handleScenesChange(scenes: Scene[]) {
    onUpdate({ ...show, scenes });
  }

  function handleUpdate(updates: Partial<Show>) {
    const merged = { ...show, ...updates };

    // Auto-add walk-on music to DJ list when performers/artists get new songs
    if (updates.performers || updates.artists) {
      const previousPerformers = show.performers;
      const previousArtists = show.artists;
      const newPerformers = merged.performers;
      const newArtists = merged.artists;
      const newDJSongs = [...merged.djSongs];

      for (const p of newPerformers) {
        const prev = previousPerformers.find((pp) => pp.id === p.id);
        if (p.walkOnMusicName && p.walkOnMusicName !== prev?.walkOnMusicName) {
          const alreadyExists = newDJSongs.some(
            (s) => s.notes === `Walk-on: ${p.name}`,
          );
          if (!alreadyExists) {
            newDJSongs.push({
              id: generateId(),
              title: p.walkOnMusicName.replace(/\.[^.]+$/, ''),
              artist: p.name,
              notes: `Walk-on: ${p.name}`,
            });
          }
        }
      }

      for (const a of newArtists) {
        const prev = previousArtists.find((pa) => pa.id === a.id);
        if (a.walkOnMusicName && a.walkOnMusicName !== prev?.walkOnMusicName) {
          const alreadyExists = newDJSongs.some(
            (s) => s.notes === `Walk-on: ${a.name}`,
          );
          if (!alreadyExists) {
            newDJSongs.push({
              id: generateId(),
              title: a.walkOnMusicName.replace(/\.[^.]+$/, ''),
              artist: a.name,
              notes: `Walk-on: ${a.name}`,
            });
          }
        }
      }

      merged.djSongs = newDJSongs;
    }

    onUpdate(merged);
    triggerSaveIndicator();
  }

  function triggerSaveIndicator() {
    setSaveStatus('saving');
    setTimeout(() => {
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2500);
    }, 300);
  }

  function handleHideSection(sectionKey: SectionKey) {
    const hidden = show.hiddenSections || [];
    if (!hidden.includes(sectionKey)) {
      onUpdate({ ...show, hiddenSections: [...hidden, sectionKey] });
      triggerSaveIndicator();
    }
  }

  function handleRestoreSection(sectionKey: SectionKey) {
    const hidden = (show.hiddenSections || []).filter(k => k !== sectionKey);
    onUpdate({ ...show, hiddenSections: hidden });
    triggerSaveIndicator();
  }

  function toggleSection(sectionKey: string) {
    const newExpanded = new Set(expandedSections);
    if (newExpanded.has(sectionKey)) {
      newExpanded.delete(sectionKey);
    } else {
      newExpanded.add(sectionKey);
    }
    setExpandedSections(newExpanded);
  }

  function handleSaveShowName() {
    if (tempShowName.trim()) {
      onUpdate({ ...show, name: tempShowName.trim() });
      triggerSaveIndicator();
      setEditingShowName(false);
    }
  }

  function handleEditShowName() {
    setTempShowName(show.name);
    setEditingShowName(true);
  }

  function buildStartsAtISO(): string | undefined {
    if (!show.date) return undefined;
    if (show.time) return `${show.date}T${show.time}`;
    return show.date;
  }

  function viewerUrl(token: string): string {
    // Carries this show's audio key in the fragment once Run Show has published
    // a board to the viewer — without it the viewer can still show the running
    // order, it just can't decode the music. The fragment never leaves the
    // browser, so the server storing that audio still can't read it.
    return buildViewerUrl(window.location.origin, token, loadViewerKey(token));
  }

  // The lineup the public viewer shows pre-show — performers in their list order.
  function buildLineup(): LiveViewPayload['lineup'] {
    return show.performers.map((p) => ({
      name: p.name,
      credits: p.credits,
    }));
  }

  function buildScheduledPayload(note: string | undefined): LiveViewPayload {
    return {
      showName: show.name,
      status: 'scheduled',
      startsAt: buildStartsAtISO(),
      note: note?.trim() || undefined,
      theme: loadColorScheme(),
      lineup: buildLineup(),
      lastUpdateMs: Date.now(),
    };
  }

  async function handleSaveViewer() {
    let token = show.viewToken;
    let updates: Partial<Show> = { viewNote: viewerNoteDraft.trim() || undefined };
    if (!token) {
      token = generateId();
      updates = { ...updates, viewToken: token };
    }
    onUpdate({ ...show, ...updates });
    triggerSaveIndicator();
    try { await publishLiveView(token, buildScheduledPayload(viewerNoteDraft)); } catch { /* ignore */ }
  }

  function handleCopyViewer() {
    const token = show.viewToken;
    if (!token) return;
    const url = viewerUrl(token);
    navigator.clipboard?.writeText(url).then(() => {
      setViewerCopyFailed(false);
      setViewerCopied(true);
      setTimeout(() => setViewerCopied(false), 1800);
    }).catch(() => {
      // The link is already on screen, in a read-only field an inch away. The
      // old fallback opened a window.prompt to show the same string again —
      // a blocking dialog, in the one situation most likely to be the
      // installed app, where blocking dialogs are what hang the page. Select
      // the field it's already in instead.
      setViewerCopyFailed(true);
      const field = viewerUrlRef.current;
      field?.focus();
      field?.select();
    });
  }

  function handleAddTodoText(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    const todo: TodoItem = {
      id: generateId(),
      text: trimmed,
      completed: false,
    };
    onUpdate({ ...show, todos: [...(show.todos || []), todo] });
    triggerSaveIndicator();
  }

  function handleToggleTodo(todoId: string) {
    const todos = (show.todos || []).map((t) =>
      t.id === todoId ? { ...t, completed: !t.completed } : t
    );
    onUpdate({ ...show, todos });
    triggerSaveIndicator();
  }

  async function handleDeleteTodo(todoId: string) {
    const todo = (show.todos || []).find((t) => t.id === todoId);
    if (await confirm(`Delete to-do "${todo?.text}"? This cannot be undone.`)) {
      const todos = (show.todos || []).filter((t) => t.id !== todoId);
      onUpdate({ ...show, todos });
      triggerSaveIndicator();
    }
  }

  const sections = [
    {
      key: 'basic',
      sectionKey: 'basic' as SectionKey,
      title: 'Basic Info',
      subtitle: 'Date, time, location, and venue.',
      accent: 'slate',
      content: <BasicInfoSection show={show} onChange={handleUpdate} />,
    },
    {
      key: 'performers',
      sectionKey: 'performers' as SectionKey,
      title: 'Performers',
      subtitle: 'Names, walk-on music, and social media.',
      accent: 'red',
      count: show.performers.length,
      preview: joinNames(show.performers.map((p) => p.name)),
      content: <PerformersSection
        performers={show.performers}
        potentialComics={settings.potentialComics}
        showName={show.name}
        performerTarget={show.performerTarget}
        onSaveToRolodex={onSaveToRolodex}
        onChange={(performers) => handleUpdate({ performers })}
        onTargetChange={(performerTarget) => handleUpdate({ performerTarget })}
      />,
    },
    {
      key: 'artists',
      sectionKey: 'artists' as SectionKey,
      title: 'Artists',
      subtitle: 'Artist entries with name, type, and music.',
      accent: 'purple',
      count: show.artists.length,
      preview: joinNames(show.artists.map((a) => a.name)),
      content: <ArtistsSection artists={show.artists} onChange={(artists) => handleUpdate({ artists })} />,
    },
    {
      key: 'schedule',
      sectionKey: 'schedule' as SectionKey,
      title: 'Schedule',
      subtitle: 'Timeline of events with times and descriptions.',
      accent: 'blue',
      count: show.schedule.length,
      preview: scheduleSummary(show.schedule),
      content: <ScheduleSection
        schedule={show.schedule}
        showName={show.name}
        showTime={show.time}
        performers={show.performers}
        knownNames={knownNames}
        onChange={(schedule) => handleUpdate({ schedule })}
      />,
    },
    {
      key: 'dj',
      sectionKey: 'dj' as SectionKey,
      title: 'DJ Music',
      subtitle: 'Songs and notes for the DJ.',
      accent: 'green',
      count: show.djSongs.length,
      preview: joinNames(show.djSongs.map((song) => song.title)),
      content: (
        <DJMusicSection
          songs={show.djSongs}
          show={show}
          library={settings.musicLibrary ?? []}
          onChange={(djSongs) => handleUpdate({ djSongs })}
        />
      ),
    },
    {
      key: 'staff',
      sectionKey: 'staff' as SectionKey,
      title: 'Staff',
      subtitle: 'Roles and assignments for production staff.',
      accent: 'amber',
      count: show.staff.length,
      preview: staffSummary(show.staff),
      content: <StaffSection staff={show.staff} onChange={(staff) => handleUpdate({ staff })} />,
    },
    {
      key: 'vendors',
      sectionKey: 'vendors' as SectionKey,
      title: 'Vendors',
      subtitle: 'Build a profile for each vendor — contact, cost, and notes.',
      accent: 'green',
      count: (show.vendors || []).length,
      preview: vendorsSummary(show.vendors || []),
      content: <VendorsSection vendors={show.vendors || []} onChange={(vendors) => handleUpdate({ vendors })} />,
    },
  ];

  // Add recap section for past shows
  if (isPastShow) {
    sections.push({
      key: 'recap',
      sectionKey: 'recap' as SectionKey,
      title: 'Recap',
      subtitle: 'Attendance, sales, performer notes, and lessons learned.',
      accent: 'slate',
      content: (
        <ShowRecapSection
          recap={show.recap}
          expenses={show.expenses}
          todos={show.todos || []}
          onChange={(recap) => handleUpdate({ recap })}
          onAddTodo={handleAddTodoText}
          onToggleTodo={handleToggleTodo}
          onDeleteTodo={handleDeleteTodo}
        />
      ),
    });
  }

  // Date and time are written the same way here as on the show cards, so the
  // same show doesn't read as "9/18/2026 20:00" in one place and
  // "Sep 18 · 8:00 PM" in another.
  const detailDate = parseShowDate(show.date);
  const metaParts = [
    detailDate?.toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: detailDate.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
    }),
    formatShowTime(show.time),
    show.venueName,
    show.location,
  ].filter((part): part is string => !!part);

  // Every secondary action for this show, in one menu attached to the show —
  // rather than scattered across the app's navigation.
  const moreItems = [
    { label: 'Viewer link', onSelect: openViewer },
    { label: 'Export PDF', onSelect: () => exportShowToPDF(show, settings) },
    { label: 'Add or remove sections', onSelect: () => setManageSectionsOpen(true) },
  ];

  // Two groups of four, so the counts read as two related clusters rather than
  // one undifferentiated row of eight: who and what is on stage, then what it
  // takes to put them there.
  //
  // A tile only appears once the show actually has some of that thing. A row of
  // zeroes is not a summary — it's a list of everything this show isn't, and it
  // pushed the parts that do exist off the top of the screen.
  const hiddenKeys = new Set(show.hiddenSections ?? []);
  const allTileGroups: Array<Array<{ icon: IconName; value: number; label: string; sectionKey?: SectionKey }>> = [
    [
      { icon: 'users', value: stats.counts.performers, label: 'Performers', sectionKey: 'performers' },
      { icon: 'sparkle', value: stats.counts.artists, label: 'Artists', sectionKey: 'artists' },
      { icon: 'schedule', value: stats.counts.cues, label: 'Cues', sectionKey: 'schedule' },
      { icon: 'music', value: stats.counts.songs, label: 'DJ songs', sectionKey: 'dj' },
    ],
    [
      { icon: 'wrench', value: stats.counts.staff, label: 'Staff', sectionKey: 'staff' },
      { icon: 'bolt', value: stats.counts.vendors, label: 'Vendors', sectionKey: 'vendors' },
      { icon: 'file', value: stats.counts.expenses, label: 'Expenses', sectionKey: 'expenses' },
      { icon: 'check', value: stats.counts.todos, label: 'To-dos' },
    ],
  ];
  const tileGroups = allTileGroups
    .map((group) =>
      group.filter((tile) => tile.value > 0 && !(tile.sectionKey && hiddenKeys.has(tile.sectionKey))),
    )
    .filter((group) => group.length > 0);

  // Same rule for the readiness bars: "Vendors booked 0/0 — 0%" measures
  // nothing. A bar earns its place once there is something to be ready about.
  const progressStats = stats.progress.filter((stat) => stat.total > 0);

  return (
    <div className="show-detail">
      <div className="show-detail__hero">
        <div className="show-detail__topbar">
          {/* The visible "Shows" label is hidden on narrow phones (see the CSS),
              so the button carries its own name for assistive tech. */}
          <button
            type="button"
            className="show-detail__back-btn"
            onClick={onBack}
            aria-label="Back to shows"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16" aria-hidden="true">
              <path
                fillRule="evenodd"
                d="M12.707 4.293a1 1 0 010 1.414L8.414 10l4.293 4.293a1 1 0 01-1.414 1.414l-5-5a1 1 0 010-1.414l5-5a1 1 0 011.414 0z"
                clipRule="evenodd"
              />
            </svg>
            <span>Shows</span>
          </button>
          {/* Announced, not just shown — this was the only confirmation an edit
              landed, and it was invisible to anyone not watching that corner. */}
          <div className="show-detail__save-indicator-container" role="status" aria-live="polite">
            {saveStatus === 'saving' && (
              <span className="show-detail__save-indicator show-detail__save-indicator--saving">
                Saving…
              </span>
            )}
            {saveStatus === 'saved' && (
              <span className="show-detail__save-indicator show-detail__save-indicator--saved">
                Saved
              </span>
            )}
          </div>
          <button
            className="show-detail__run-show"
            onClick={() => setRunShowOpen(true)}
            title="Run the live show"
          >
            <Icon name="play" size={14} />
            Run Show
          </button>
          <MoreMenu label="More show actions" items={moreItems} />
        </div>
        <div className="show-detail__header">
          {editingShowName ? (
            <div className="show-detail__name-edit">
              {/* The page keeps exactly one h1 whether or not the name is being
                  edited, so the document outline never changes underfoot. */}
              <h1 className="visually-hidden">{tempShowName || show.name}</h1>
              <input
                className="section-field__input show-detail__name-input"
                value={tempShowName}
                onChange={(e) => setTempShowName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveShowName();
                  if (e.key === 'Escape') setEditingShowName(false);
                }}
                placeholder="Show name"
                aria-label="Show name"
                autoFocus
              />
              <button className="btn btn--primary btn--sm" onClick={handleSaveShowName}>
                Save
              </button>
              <button className="btn btn--ghost btn--sm" onClick={() => setEditingShowName(false)}>
                Cancel
              </button>
            </div>
          ) : (
            <>
              <h1 className="show-detail__title">{show.name}</h1>
              <button
                className="show-detail__name-edit-btn"
                onClick={handleEditShowName}
                aria-label={`Edit show name, currently ${show.name}`}
              >
                <Icon name="edit" size={14} aria-hidden />
                <span>Edit</span>
              </button>
            </>
          )}
          <select
            className={`show-detail__status show-detail__status--select show-detail__status--${show.status}`}
            value={show.status}
            onChange={(e) => {
              onUpdate({ ...show, status: e.target.value as ShowStatus });
              triggerSaveIndicator();
            }}
            aria-label="Show status"
            title="Change show status"
          >
            {(Object.keys(STATUS_LABELS) as ShowStatus[]).map((status) => (
              <option key={status} value={status}>{STATUS_LABELS[status]}</option>
            ))}
          </select>
        </div>
        {metaParts.length > 0 && (
          <div className="show-detail__meta">
            {metaParts.map((part) => (
              <span key={part}>{part}</span>
            ))}
          </div>
        )}
      </div>

      {/* Host */}
      <div className="show-detail__host">
        <label className="show-detail__host-label" htmlFor="show-host-input">Host</label>
        <input
          id="show-host-input"
          type="text"
          className="section-field__input show-detail__host-input"
          placeholder="Host name"
          value={show.host || ''}
          onChange={(e) => { onUpdate({ ...show, host: e.target.value || undefined }); triggerSaveIndicator(); }}
        />
        {show.performers.length > 0 && (
          <select
            className="section-field__select show-detail__host-pick"
            value=""
            onChange={(e) => {
              if (!e.target.value) return;
              onUpdate({ ...show, host: e.target.value });
              triggerSaveIndicator();
            }}
            aria-label="Use a performer as host"
          >
            <option value="">Use a performer…</option>
            {show.performers.map((p) => (
              <option key={p.id} value={p.name}>{p.name}</option>
            ))}
          </select>
        )}
      </div>

      {/* At a glance. The page used to open on a stack of closed sections, which
          told you the show existed but nothing about its state. These read
          straight off the same data the sections edit. */}
      <section
        className={`show-overview${tileGroups.length === 0 ? ' show-overview--accents-only' : ''}`}
        aria-label="Show at a glance"
      >
        {tileGroups.map((group, index) => (
          <div className="show-overview__group" key={index}>
            {group.map((tile) => (
              <div className="show-tile" key={tile.label}>
                <span className="show-tile__icon">
                  <Icon name={tile.icon} size={20} />
                </span>
                <span className="show-tile__body">
                  <span className="show-tile__value">{tile.value}</span>
                  <span className="show-tile__label">{tile.label}</span>
                </span>
              </div>
            ))}
          </div>
        ))}

        <div className="show-overview__accents">
          <div className="show-accent show-accent--runtime">
            <span className="show-accent__icon">
              <Icon name="clock" size={22} />
            </span>
            <span className="show-accent__body">
              <span className="show-accent__value">{formatRunTime(stats.runMinutes)}</span>
              <span className="show-accent__label">Run time</span>
            </span>
          </div>
        </div>
      </section>

      {/* How ready the show is, in the things that are actually checkable. Each
          bar is a real ratio — no invented targets, and none for a section this
          show doesn't use. */}
      {progressStats.length > 0 && (
      <section className="show-progress" aria-label="Show readiness">
        {progressStats.map((stat) => {
          const percent = progressPercent(stat);
          const full = isComplete(stat);
          return (
            <div
              className={`show-progress__card${full ? ' show-progress__card--full' : ''}`}
              key={stat.key}
            >
              <span className="show-progress__label">{stat.label}</span>
              <span className="show-progress__figure">
                <strong className="show-progress__value">
                  {stat.done}<span className="show-progress__of">/{stat.total}</span>
                </strong>
                {/* "100%" tells you the ratio; "Full" tells you to stop
                    booking. On the lineup that is the whole question. */}
                <span className={`show-progress__pct${full ? ' show-progress__pct--full' : ''}`}>
                  {full ? 'Full' : `${percent}%`}
                </span>
              </span>
              <span
                className="show-progress__track"
                role="progressbar"
                aria-valuenow={percent}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={stat.label}
              >
                <span
                  className={`show-progress__bar show-progress__bar--${stat.key}`}
                  style={{ width: `${percent}%` }}
                />
              </span>
            </div>
          );
        })}
      </section>
      )}

      <div className="show-detail__sections-accordion">
        {sections.filter((section) => !(show.hiddenSections || []).includes(section.sectionKey)).map((section) => {
          const isExpanded = expandedSections.has(section.key);
          const panelId = `show-section-panel-${section.key}`;
          const buttonId = `show-section-header-${section.key}`;
          const filled = typeof section.count === 'number' && section.count > 0;

          return (
            <section
              key={section.key}
              className={`accordion-section${isExpanded ? ' accordion-section--expanded' : ''}`}
            >
              {/* The whole header is one button, wrapped in the heading. It used
                  to be a div with a click handler and a separate arrow button,
                  so the only thing a keyboard could reach was the arrow — the
                  large obvious target was mouse-only. */}
              <h2 className="accordion-section__heading">
                <button
                  type="button"
                  id={buttonId}
                  className="accordion-section__header"
                  onClick={() => toggleSection(section.key)}
                  aria-expanded={isExpanded}
                  aria-controls={panelId}
                >
                  <span className="accordion-section__icon">
                    <Icon name={SECTION_ICONS[section.key] ?? 'file'} size={18} />
                  </span>
                  <span className="accordion-section__header-left">
                    <span className="accordion-section__title-row">
                      <span className="accordion-section__title">{section.title}</span>
                      {filled && (
                        <span className="accordion-section__count">
                          {section.count}
                          <span className="visually-hidden"> added</span>
                        </span>
                      )}
                    </span>
                    {/* One line under the title, doing the most useful job it
                        can: what's actually in there once the section has
                        content, and what belongs there while it's empty.
                        Hidden when open, where the content itself answers it. */}
                    {!isExpanded &&
                      (filled ? (
                        section.preview && (
                          <span className="accordion-section__preview">{section.preview}</span>
                        )
                      ) : (
                        <span className="accordion-section__subtitle">{section.subtitle}</span>
                      ))}
                  </span>
                  <svg
                    className="accordion-section__chevron"
                    viewBox="0 0 20 20"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <polyline points="5 8 10 13 15 8" />
                  </svg>
                </button>
              </h2>

              {isExpanded && (
                <div
                  id={panelId}
                  role="region"
                  aria-labelledby={buttonId}
                  className="accordion-section__content"
                >
                  {section.content}
                </div>
              )}
            </section>
          );
        })}
      </div>

      <div className="show-detail__manage-row">
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={() => setManageSectionsOpen(true)}
        >
          Add or remove sections
        </button>
      </div>

      <div className="show-detail__scenes">
        <SceneList scenes={show.scenes ?? []} onChange={handleScenesChange} />
      </div>

      {runShowOpen && (
        <RunShow
          showName={show.name}
          showId={show.id}
          viewToken={show.viewToken}
          schedule={show.schedule}
          performers={show.performers}
          djSongs={djHidden ? [] : show.djSongs}
          onStart={() => {
            if (show.status !== 'completed' && show.status !== 'in-progress') {
              onUpdate({ ...show, status: 'in-progress' });
            }
          }}
          onFinish={() => onUpdate({ ...show, status: 'completed' })}
          onClose={() => setRunShowOpen(false)}
        />
      )}

      {manageSectionsOpen && (
        <Modal onClose={() => setManageSectionsOpen(false)} labelledBy="manage-sections-title">
          <div className="manage-sections">
            <h2 id="manage-sections-title" className="manage-sections__title">Sections</h2>
            <p className="manage-sections__sub">
              Choose what this show tracks. Removing a section only hides it — nothing you've
              entered is deleted, and it all comes back if you add the section again.
            </p>
            <ul className="manage-sections__list">
              {sections.map((section) => {
                const hidden = (show.hiddenSections || []).includes(section.sectionKey);
                const locked = section.sectionKey === 'basic';
                return (
                  <li key={section.key} className="manage-sections__row">
                    <div className="manage-sections__info">
                      <span className="manage-sections__name">{section.title}</span>
                      <span className="manage-sections__desc">{section.subtitle}</span>
                    </div>
                    {locked ? (
                      <span className="manage-sections__always">Always on</span>
                    ) : (
                      <button
                        type="button"
                        className={`btn btn--sm ${hidden ? 'btn--secondary' : 'btn--ghost'}`}
                        onClick={() =>
                          hidden
                            ? handleRestoreSection(section.sectionKey)
                            : handleHideSection(section.sectionKey)
                        }
                      >
                        {hidden ? 'Add' : 'Remove'}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
            <div className="manage-sections__actions">
              <button className="btn btn--primary" onClick={() => setManageSectionsOpen(false)}>Done</button>
            </div>
          </div>
        </Modal>
      )}

      {viewerOpen && (
        <Modal onClose={() => setViewerOpen(false)} labelledBy="viewer-link-modal-title">
          <div className="viewer-link-modal">
            <h2 id="viewer-link-modal-title" className="viewer-link-modal__title">Public viewer link</h2>
            <p className="viewer-link-modal__sub">
              A read-only page anyone with the link can open — shows the timer, who's on stage,
              and who's coming up next. Until the show goes live, it shows the start time and
              your note below.
            </p>

            {show.viewToken ? (
              <div className="viewer-link-modal__url-row">
                <input
                  ref={viewerUrlRef}
                  className="section-field__input"
                  readOnly
                  value={viewerUrl(show.viewToken)}
                  onFocus={(e) => e.currentTarget.select()}
                />
                <button className="btn btn--secondary btn--sm" onClick={handleCopyViewer}>
                  {viewerCopied ? 'Copied!' : 'Copy'}
                </button>
              </div>
            ) : null}
            {show.viewToken && viewerCopyFailed ? (
              <p className="viewer-link-modal__hint" role="status">
                Couldn't reach the clipboard — the link is selected above, so copy it by hand.
              </p>
            ) : (
              <p className="viewer-link-modal__hint">
                Save to generate the link.
              </p>
            )}

            <label className="section-field__label" style={{ marginTop: 14 }}>Pre-show note (optional)</label>
            <textarea
              className="section-field__input"
              rows={4}
              value={viewerNoteDraft}
              onChange={(e) => setViewerNoteDraft(e.target.value)}
              placeholder="e.g. Doors at 7:30 PM · 21+ · BYOB"
              style={{ resize: 'vertical' }}
            />

            <div className="viewer-link-modal__actions">
              <button className="btn btn--primary" onClick={handleSaveViewer}>
                {show.viewToken ? 'Save & publish' : 'Generate link & publish'}
              </button>
              <button className="btn btn--ghost" onClick={() => setViewerOpen(false)}>Close</button>
            </div>
          </div>
        </Modal>
      )}
      {confirmDialog}
    </div>
  );
}

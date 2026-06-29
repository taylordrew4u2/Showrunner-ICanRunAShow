import { forwardRef, useEffect, useImperativeHandle, useState } from 'react';
import type { Show, ShowStatus, Scene, AppSettings, SectionKey, TodoItem } from '../types';
import { generateId } from '../utils/id';
import { SceneList } from './SceneList';
import { DeadlineIndicator } from './DeadlineIndicator';
import { Icon } from './Icon';
import { BasicInfoSection } from './sections/BasicInfoSection';
import { PerformersSection } from './sections/PerformersSection';
import { ArtistsSection } from './sections/ArtistsSection';
import { ScheduleSection } from './sections/ScheduleSection';
import { DJMusicSection } from './sections/DJMusicSection';
import { StaffSection } from './sections/StaffSection';
import { VendorsSection } from './sections/VendorsSection';
import { ShowRecapSection } from './sections/ShowRecapSection';
import { FilesSection } from './sections/FilesSection';
import { RunShow } from './RunShow';
import { Modal } from './Modal';
import { ArtistAdmin } from './ArtistAdmin';
import { exportShowToPDF } from '../utils/pdfExport';
import { publishLiveView, type LiveViewPayload } from '../utils/liveView';
import { loadColorScheme } from '../utils/theme';
import './ShowDetail.css';

interface ShowDetailProps {
  show: Show;
  settings: AppSettings;
  onBack: () => void;
  onUpdate: (show: Show) => void;
  onSaveToRolodex?: (comic: import('../types').PotentialComic) => void;
}

// Lets the sidebar trigger this show's actions from outside the component.
export interface ShowDetailHandle {
  openRunShow: () => void;
  openViewer: () => void;
  openArtistAdmin: () => void;
}

export const ShowDetail = forwardRef<ShowDetailHandle, ShowDetailProps>(function ShowDetail({ show, settings, onBack, onUpdate, onSaveToRolodex }, ref) {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const [editingDeadline, setEditingDeadline] = useState<SectionKey | null>(null);
  const [editingShowName, setEditingShowName] = useState(false);
  const [runShowOpen, setRunShowOpen] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerNoteDraft, setViewerNoteDraft] = useState('');
  const [viewerCopied, setViewerCopied] = useState(false);
  const [artistAdminOpen, setArtistAdminOpen] = useState(false);
  const [tempShowName, setTempShowName] = useState(show.name);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [lightMode, setLightMode] = useState<boolean>(() => {
    try {
      return localStorage.getItem('showrunner:lightMode') === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('showrunner:lightMode', lightMode ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [lightMode]);

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

  // The Artist admin tool only makes sense for shows that use artists. If the
  // producer has removed the Artists section, hide its admin entry point too —
  // unless a public sign-up link was already generated, so existing queues stay
  // reachable.
  const artistsHidden = (show.hiddenSections || []).includes('artists');
  const showArtistAdmin = !artistsHidden || !!show.artistSignupToken;

  function openViewer() {
    setViewerNoteDraft(show.viewNote ?? '');
    setViewerCopied(false);
    setViewerOpen(true);
  }

  // Expose this show's actions so the sidebar can trigger them.
  useImperativeHandle(ref, () => ({
    openRunShow: () => setRunShowOpen(true),
    openViewer,
    openArtistAdmin: () => setArtistAdminOpen(true),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [show.viewNote]);

  function handleScenesChange(scenes: Scene[]) {
    onUpdate({ ...show, scenes });
  }

  function handleUpdate(updates: Partial<Show>) {
    // Ensure files array is never lost during updates
    const merged = { 
      ...show, 
      ...updates,
      files: updates.files !== undefined ? updates.files : (show.files || [])
    };

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

  function handleDeadlineChange(sectionKey: SectionKey, deadline: string) {
    const updatedDeadlines = {
      ...show.deadlines,
      [sectionKey]: deadline || undefined,
    };
    onUpdate({ ...show, deadlines: updatedDeadlines });
    triggerSaveIndicator();
    setEditingDeadline(null);
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
    return `${window.location.origin}/?view=${token}`;
  }

  // The lineup the public viewer shows pre-show — performers in their list order.
  function buildLineup(): LiveViewPayload['lineup'] {
    return show.performers.map((p) => ({
      name: p.name,
      photo: p.photo ?? p.photos?.[0],
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
      setViewerCopied(true);
      setTimeout(() => setViewerCopied(false), 1800);
    }).catch(() => {
      window.prompt('Copy this viewer link:', url);
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

  function handleDeleteTodo(todoId: string) {
    const todo = (show.todos || []).find((t) => t.id === todoId);
    if (window.confirm(`Delete to-do "${todo?.text}"? This cannot be undone.`)) {
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
      subtitle: 'Set show time, location, and venue. Upload a flyer.',
      accent: 'slate',
      span: 2,
      content: <BasicInfoSection show={show} onChange={handleUpdate} />,
    },
    {
      key: 'performers',
      sectionKey: 'performers' as SectionKey,
      title: 'Performers',
      subtitle: 'Names, walk-on music, photos, and social media.',
      accent: 'red',
      count: show.performers.length,
      content: <PerformersSection
        performers={show.performers}
        potentialComics={settings.potentialComics}
        showName={show.name}
        onSaveToRolodex={onSaveToRolodex}
        onChange={(performers) => handleUpdate({ performers })}
      />,
    },
    {
      key: 'artists',
      sectionKey: 'artists' as SectionKey,
      title: 'Artists',
      subtitle: 'Artist entries with name, type, music, and photos.',
      accent: 'purple',
      count: show.artists.length,
      content: <ArtistsSection artists={show.artists} onChange={(artists) => handleUpdate({ artists })} />,
    },
    {
      key: 'schedule',
      sectionKey: 'schedule' as SectionKey,
      title: 'Schedule',
      subtitle: 'Timeline of events with times and descriptions.',
      accent: 'blue',
      span: 2,
      count: show.schedule.length,
      content: <ScheduleSection
        schedule={show.schedule}
        scheduleImage={show.scheduleImage}
        showName={show.name}
        performers={show.performers}
        onChange={(schedule) => handleUpdate({ schedule })}
        onImageChange={(scheduleImage) => handleUpdate({ scheduleImage })}
      />,
    },
    {
      key: 'dj',
      sectionKey: 'dj' as SectionKey,
      title: 'DJ Music',
      subtitle: 'Songs and notes for the DJ.',
      accent: 'green',
      count: show.djSongs.length,
      content: <DJMusicSection songs={show.djSongs} show={show} onChange={(djSongs) => handleUpdate({ djSongs })} />,
    },
    {
      key: 'staff',
      sectionKey: 'staff' as SectionKey,
      title: 'Staff',
      subtitle: 'Roles and assignments for production staff.',
      accent: 'amber',
      count: show.staff.length,
      content: <StaffSection staff={show.staff} onChange={(staff) => handleUpdate({ staff })} />,
    },
    {
      key: 'vendors',
      sectionKey: 'vendors' as SectionKey,
      title: 'Vendors',
      subtitle: 'Build a profile for each vendor — contact, cost, and notes.',
      accent: 'green',
      count: (show.vendors || []).length,
      content: <VendorsSection vendors={show.vendors || []} onChange={(vendors) => handleUpdate({ vendors })} />,
    },
    {
      key: 'files',
      sectionKey: 'files' as SectionKey,
      title: 'Files',
      subtitle: 'Upload and manage any files needed for the show.',
      accent: 'slate',
      count: show.files?.length || 0,
      content: <FilesSection files={show.files || []} onChange={(files) => handleUpdate({ files })} />,
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
      span: 2,
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

  return (
    <div className={`show-detail${lightMode ? ' show-detail--light' : ''}`}>
      <div className="show-detail__hero">
        <div className="show-detail__topbar">
          <button className="btn btn--ghost show-detail__back-btn" onClick={onBack}>← Back</button>
          <div className="show-detail__save-indicator-container">
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
            className="show-detail__theme-toggle"
            onClick={() => setLightMode((v) => !v)}
            title={lightMode ? 'Switch to dark mode' : 'Switch to light mode'}
            aria-pressed={lightMode}
          >
            {lightMode ? '🌙' : '☀️'}
          </button>
          {/* Secondary actions — hidden on mobile (bottom menu) and desktop (sidebar). */}
          <div className="show-detail__topbar-secondary">
            <button className="btn btn--secondary btn--sm" onClick={() => exportShowToPDF(show, settings)}>
              Export PDF
            </button>
            <button
              className="btn btn--secondary btn--sm"
              onClick={openViewer}
              title="Public read-only viewer link"
            >
              Viewer link
            </button>
            {showArtistAdmin && (
              <button
                className="btn btn--secondary btn--sm"
                onClick={() => setArtistAdminOpen(true)}
                title="Artist sign-up admin"
              >
                Artist admin
              </button>
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
        </div>
        <div className="show-detail__header">
          {editingShowName ? (
            <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flex: 1 }}>
              <h1 className="show-detail__title" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0,0,0,0)', whiteSpace: 'nowrap' }}>{tempShowName || show.name}</h1>
              <input
                className="section-field__input"
                value={tempShowName}
                onChange={(e) => setTempShowName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveShowName();
                  if (e.key === 'Escape') setEditingShowName(false);
                }}
                placeholder="Show name"
                autoFocus
                style={{ fontSize: '1.5rem', fontWeight: '800' }}
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
                className="btn btn--ghost btn--sm"
                onClick={handleEditShowName}
                title="Edit show name"
              >
                Edit
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
            <option value="upcoming">upcoming</option>
            <option value="in-progress">in progress</option>
            <option value="completed">completed</option>
            <option value="cancelled">cancelled</option>
          </select>
        </div>
        {(show.venueName || show.location || show.date || show.time) && (
          <div className="show-detail__meta">
            {show.venueName && <span>{show.venueName}</span>}
            {show.location && <span>{show.location}</span>}
            {show.date && <span>{new Date(show.date).toLocaleDateString()}</span>}
            {show.time && <span>{show.time}</span>}
          </div>
        )}
      </div>

      {show.flyer && (
        <div className="show-detail__flyer">
          <img src={show.flyer} alt="Show flyer" className="show-detail__flyer-image" />
        </div>
      )}

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

      <div className="show-detail__sections-accordion">
        {sections.filter((section) => !(show.hiddenSections || []).includes(section.sectionKey)).map((section) => {
          const isExpanded = expandedSections.has(section.key);
          const isComplete = false;
          const spanClass = section.span === 2 ? ' accordion-section--span2' : '';
          const accentClass = section.accent ? ` accordion-section--${section.accent}` : '';

          return (
            <div
              key={section.key}
              className={`accordion-section${spanClass}${accentClass}`}
            >
              <div 
                className="accordion-section__header"
                onClick={() => toggleSection(section.key)}
              >
                <div className="accordion-section__header-left">
                  <div className="accordion-section__title-row">
                    <h2 className="accordion-section__title">{section.title}</h2>
                    {typeof section.count === 'number' && (
                      <span className="accordion-section__count">{section.count}</span>
                    )}
                  </div>
                  <p className="accordion-section__subtitle">{section.subtitle}</p>
                </div>
                <div className="accordion-section__header-right">
                  {section.sectionKey && section.sectionKey !== 'basic' && (
                    <button
                      className="accordion-section__remove-btn"
                      title={`Remove ${section.title}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleHideSection(section.sectionKey!);
                      }}
                    >
                      ×
                    </button>
                  )}
                  <button
                    className={`accordion-section__expand-icon ${isExpanded ? 'accordion-section__expand-icon--expanded' : ''}`}
                    aria-label={isExpanded ? 'Collapse section' : 'Expand section'}
                  >
                    ▼
                  </button>
                </div>
              </div>

              {section.sectionKey && (
                <div className="accordion-section__deadline-bar" onClick={(e) => e.stopPropagation()}>
                  {show.deadlines?.[section.sectionKey] ? (
                    <div className="accordion-section__deadline-display">
                      <DeadlineIndicator 
                        deadline={show.deadlines[section.sectionKey]} 
                        isComplete={isComplete}
                      />
                      <button
                        className="btn btn--ghost btn--sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingDeadline(section.sectionKey!);
                        }}
                      >
                        Edit Deadline
                      </button>
                    </div>
                  ) : (
                    <button
                      className="btn btn--secondary btn--sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingDeadline(section.sectionKey!);
                      }}
                    >
                      + Set Deadline
                    </button>
                  )}
                  
                  {editingDeadline === section.sectionKey && (
                    <div className="accordion-section__deadline-editor">
                      <input
                        type="date"
                        className="section-field__input"
                        defaultValue={show.deadlines?.[section.sectionKey] || ''}
                        onChange={(e) => handleDeadlineChange(section.sectionKey!, e.target.value)}
                        autoFocus
                      />
                      <button
                        className="btn btn--ghost btn--sm"
                        onClick={() => setEditingDeadline(null)}
                      >
                        Cancel
                      </button>
                      {show.deadlines?.[section.sectionKey] && (
                        <button
                          className="btn btn--ghost btn--sm"
                          onClick={() => handleDeadlineChange(section.sectionKey!, '')}
                        >
                          Clear
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}

              {isExpanded && (
                <div className="accordion-section__content">
                  {section.content}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {sections.some((section) => (show.hiddenSections || []).includes(section.sectionKey)) && (
        <div className="hidden-sections">
          <p className="hidden-sections__label">Hidden</p>
          <div className="hidden-sections__bubbles">
            {sections.filter((section) => (show.hiddenSections || []).includes(section.sectionKey)).map((section) => (
              <button
                key={section.key}
                className="hidden-bubble"
                onClick={() => handleRestoreSection(section.sectionKey!)}
                title={`Restore "${section.title}"`}
              >
                <span className="hidden-bubble__icon">+</span>
                <span className="hidden-bubble__title">{section.title}</span>
              </button>
            ))}
          </div>
        </div>
      )}

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
          onStart={() => {
            if (show.status !== 'completed' && show.status !== 'in-progress') {
              onUpdate({ ...show, status: 'in-progress' });
            }
          }}
          onFinish={() => onUpdate({ ...show, status: 'completed' })}
          onClose={() => setRunShowOpen(false)}
        />
      )}

      {artistAdminOpen && (
        <ArtistAdmin show={show} onChange={handleUpdate} onClose={() => setArtistAdminOpen(false)} />
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
                  className="section-field__input"
                  readOnly
                  value={viewerUrl(show.viewToken)}
                  onFocus={(e) => e.currentTarget.select()}
                />
                <button className="btn btn--secondary btn--sm" onClick={handleCopyViewer}>
                  {viewerCopied ? 'Copied!' : 'Copy'}
                </button>
              </div>
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
    </div>
  );
});

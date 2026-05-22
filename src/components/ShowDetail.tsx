import { useState } from 'react';
import type { Show, Scene, AppSettings, SectionKey, TodoItem } from '../types';
import { generateId } from '../utils/id';
import { SceneList } from './SceneList';
import { DeadlineIndicator } from './DeadlineIndicator';
import { BasicInfoSection } from './sections/BasicInfoSection';
import { PerformersSection } from './sections/PerformersSection';
import { ArtistsSection } from './sections/ArtistsSection';
import { ScheduleSection } from './sections/ScheduleSection';
import { DJMusicSection } from './sections/DJMusicSection';
import { StaffSection } from './sections/StaffSection';
import { ShowRecapSection } from './sections/ShowRecapSection';
import { FilesSection } from './sections/FilesSection';
import { exportShowToPDF } from '../utils/pdfExport';
import './ShowDetail.css';

interface ShowDetailProps {
  show: Show;
  settings: AppSettings;
  onBack: () => void;
  onUpdate: (show: Show) => void;
  onSaveToRolodex?: (comic: import('../types').PotentialComic) => void;
}

export function ShowDetail({ show, settings, onBack, onUpdate, onSaveToRolodex }: ShowDetailProps) {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const [editingDeadline, setEditingDeadline] = useState<SectionKey | null>(null);
  const [editingVideoHost, setEditingVideoHost] = useState(false);
  const [editingShowName, setEditingShowName] = useState(false);
  const [tempShowName, setTempShowName] = useState(show.name);
  const [tempVideoPerson, setTempVideoPerson] = useState(show.videoPerson || '');
  const [tempVideoPayment, setTempVideoPayment] = useState(show.videoPayment?.toString() || '');
  const [tempSelectedHostId, setTempSelectedHostId] = useState(show.selectedHostId || '');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [newTodoText, setNewTodoText] = useState('');
  
  // Check if the show date has passed
  const isPastShow = show.date && new Date(show.date) < new Date(new Date().setHours(0, 0, 0, 0));
  
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

  function handleCompletionToggle(sectionKey: SectionKey) {
    const updatedCompletions = {
      ...show.completions,
      [sectionKey]: !show.completions?.[sectionKey],
    };
    onUpdate({ ...show, completions: updatedCompletions });
    triggerSaveIndicator();
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

  function handleLockVideoHost() {
    const videoPaymentNum = tempVideoPayment ? parseFloat(tempVideoPayment) : undefined;
    
    onUpdate({
      ...show,
      videoPerson: tempVideoPerson || undefined,
      videoPayment: videoPaymentNum,
      selectedHostId: tempSelectedHostId || undefined,
    });
    
    triggerSaveIndicator();
    setEditingVideoHost(false);
  }

  function handleEditVideoHost() {
    setTempVideoPerson(show.videoPerson || '');
    setTempVideoPayment(show.videoPayment?.toString() || '');
    setTempSelectedHostId(show.selectedHostId || '');
    setEditingVideoHost(true);
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

  function handleAddTodo() {
    if (!newTodoText.trim()) return;
    const todo: TodoItem = {
      id: generateId(),
      text: newTodoText.trim(),
      completed: false,
    };
    onUpdate({ ...show, todos: [...(show.todos || []), todo] });
    triggerSaveIndicator();
    setNewTodoText('');
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

  const hostNames: Record<string, string> = { justin: 'Justin', taylor: 'Taylor' };
  const selectedHostName = show.selectedHostId ? hostNames[show.selectedHostId] || show.selectedHostId : undefined;
  const hasVideoHostInfo = show.videoPerson || show.selectedHostId;

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
      content: <ShowRecapSection recap={show.recap} expenses={show.expenses} onChange={(recap) => handleUpdate({ recap })} />,
    });
  }

  return (
    <div className="show-detail">
      <div className="show-detail__hero">
        <div className="show-detail__topbar">
          <button className="btn btn--ghost" onClick={onBack}>← Back</button>
          <div className="show-detail__save-indicator-container">
            {saveStatus === 'saving' && (
              <span className="show-detail__save-indicator show-detail__save-indicator--saving">
                Saving...
              </span>
            )}
            {saveStatus === 'saved' && (
              <span className="show-detail__save-indicator show-detail__save-indicator--saved">
                Saved
              </span>
            )}
          </div>
          <button className="btn btn--secondary btn--sm" onClick={() => exportShowToPDF(show, settings)}>
            Export PDF
          </button>
        </div>
        <div className="show-detail__header">
          {editingShowName ? (
            <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flex: 1 }}>
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
              <h2 className="show-detail__title">{show.name}</h2>
              <button
                className="btn btn--ghost btn--sm"
                onClick={handleEditShowName}
                title="Edit show name"
              >
                Edit
              </button>
            </>
          )}
          <span className={`show-detail__status show-detail__status--${show.status}`}>
            {show.status.replace('-', ' ')}
          </span>
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

      {/* Video & Host Assignment Section */}
      <div className={`show-detail__video-host ${hasVideoHostInfo && !editingVideoHost ? 'show-detail__video-host--locked' : ''}`}>
        {!editingVideoHost && hasVideoHostInfo ? (
          // Locked/compact view
          <div className="video-host-locked">
            {show.videoPerson && (
              <div className="video-host-locked__item">
                <span className="video-host-locked__label">Video:</span>
                <span className="video-host-locked__value">{show.videoPerson}</span>
                {show.videoPayment && (
                  <span className="video-host-locked__payment">${show.videoPayment.toFixed(2)}</span>
                )}
              </div>
            )}
            {selectedHostName && (
              <div className="video-host-locked__item">
                <span className="video-host-locked__label">Host:</span>
                <span className="video-host-locked__value">{selectedHostName}</span>
              </div>
            )}
            <button 
              className="btn btn--ghost btn--sm"
              onClick={handleEditVideoHost}
            >
              Edit
            </button>
          </div>
        ) : (
          // Edit view
          <div className="video-host-editor">
            <h3 className="video-host-editor__title">Video & Host Assignment</h3>
            <div className="video-host-editor__fields">
              <div className="video-host-editor__field">
                <label className="section-field__label">Video Person</label>
                <input
                  type="text"
                  className="section-field__input"
                  placeholder="Enter video person name"
                  value={tempVideoPerson}
                  onChange={(e) => setTempVideoPerson(e.target.value)}
                />
              </div>
              <div className="video-host-editor__field video-host-editor__field--narrow">
                <label className="section-field__label">Video Payment ($)</label>
                <input
                  type="number"
                  className="section-field__input"
                  placeholder="0.00"
                  step="0.01"
                  min="0"
                  value={tempVideoPayment}
                  onChange={(e) => setTempVideoPayment(e.target.value)}
                />
              </div>
              <div className="video-host-editor__field">
                <label className="section-field__label">Select Host</label>
                <select
                  className="section-field__select"
                  value={tempSelectedHostId}
                  onChange={(e) => setTempSelectedHostId(e.target.value)}
                >
                  <option value="">-- Select a host --</option>
                  <option value="justin">Justin</option>
                  <option value="taylor">Taylor</option>
                </select>
              </div>
            </div>
            <div className="video-host-editor__actions">
              <button 
                className="btn btn--primary"
                onClick={handleLockVideoHost}
              >
                Lock In
              </button>
              {hasVideoHostInfo && (
                <button 
                  className="btn btn--ghost"
                  onClick={() => setEditingVideoHost(false)}
                >
                  Cancel
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="show-detail__main-layout">
        <div className="show-detail__sections-accordion">
        {sections.filter((section) => !show.completions?.[section.sectionKey] && !(show.hiddenSections || []).includes(section.sectionKey)).map((section) => {
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
                    <h3 className="accordion-section__title">{section.title}</h3>
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
                  {section.sectionKey && (
                    <button
                      className="accordion-section__lockin-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCompletionToggle(section.sectionKey!);
                      }}
                      title="Lock In"
                    >
                      Lock In
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

        <div className="show-detail__todo-sidebar">
          <h3 className="todo-sidebar__title">To-Do List</h3>
          <div className="todo-sidebar__add">
            <input
              type="text"
              className="todo-sidebar__input"
              placeholder="Add a task..."
              value={newTodoText}
              onChange={(e) => setNewTodoText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAddTodo(); }}
            />
            <button className="todo-sidebar__add-btn" onClick={handleAddTodo} disabled={!newTodoText.trim()}>
              +
            </button>
          </div>
          <ul className="todo-sidebar__list">
            {(show.todos || []).map((todo) => (
              <li key={todo.id} className={`todo-sidebar__item ${todo.completed ? 'todo-sidebar__item--done' : ''}`}>
                <label className="todo-sidebar__check">
                  <input
                    type="checkbox"
                    checked={todo.completed}
                    onChange={() => handleToggleTodo(todo.id)}
                  />
                  <span className="todo-sidebar__text">{todo.text}</span>
                </label>
                <button
                  className="todo-sidebar__delete"
                  onClick={() => handleDeleteTodo(todo.id)}
                  title="Remove"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
          {(show.todos || []).length === 0 && (
            <p className="todo-sidebar__empty">No tasks yet. Add one above!</p>
          )}
        </div>
      </div>

      {sections.some((section) => show.completions?.[section.sectionKey]) && (
        <div className="completed-sections">
          <p className="completed-sections__label">Locked In</p>
          <div className="completed-sections__bubbles">
            {sections.filter((section) => show.completions?.[section.sectionKey]).map((section) => (
              <button
                key={section.key}
                className="completed-bubble"
                onClick={() => handleCompletionToggle(section.sectionKey!)}
                title={`Unlock "${section.title}"`}
              >
                <span className="completed-bubble__icon">✓</span>
                <span className="completed-bubble__title">{section.title}</span>
              </button>
            ))}
          </div>
        </div>
      )}

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
    </div>
  );
}

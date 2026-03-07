import { useState } from 'react';
import type { Show, Scene, AppSettings, SectionKey } from '../types';
import { SceneList } from './SceneList';
import { DeadlineIndicator } from './DeadlineIndicator';
import { BasicInfoSection } from './sections/BasicInfoSection';
import { PerformersSection } from './sections/PerformersSection';
import { ArtistsSection } from './sections/ArtistsSection';
import { ScheduleSection } from './sections/ScheduleSection';
import { HostsSection } from './sections/HostsSection';
import { DJMusicSection } from './sections/DJMusicSection';
import { StaffSection } from './sections/StaffSection';
import { ExpensesSection } from './sections/ExpensesSection';
import { ShowRecapSection } from './sections/ShowRecapSection';
import { exportShowToPDF } from '../utils/pdfExport';
import './ShowDetail.css';

interface ShowDetailProps {
  show: Show;
  settings: AppSettings;
  onBack: () => void;
  onUpdate: (show: Show) => void;
}

export function ShowDetail({ show, settings, onBack, onUpdate }: ShowDetailProps) {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const [editingDeadline, setEditingDeadline] = useState<SectionKey | null>(null);
  
  // Check if the show date has passed
  const isPastShow = show.date && new Date(show.date) < new Date(new Date().setHours(0, 0, 0, 0));
  
  function handleScenesChange(scenes: Scene[]) {
    onUpdate({ ...show, scenes });
  }

  function handleUpdate(updates: Partial<Show>) {
    onUpdate({ ...show, ...updates });
  }

  function handleDeadlineChange(sectionKey: SectionKey, deadline: string) {
    const updatedDeadlines = {
      ...show.deadlines,
      [sectionKey]: deadline || undefined,
    };
    onUpdate({ ...show, deadlines: updatedDeadlines });
    setEditingDeadline(null);
  }

  function handleCompletionToggle(sectionKey: SectionKey) {
    const updatedCompletions = {
      ...show.completions,
      [sectionKey]: !show.completions?.[sectionKey],
    };
    onUpdate({ ...show, completions: updatedCompletions });
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

  const sections = [
    {
      key: 'basic',
      sectionKey: 'basic' as SectionKey,
      title: '📋 Basic Info',
      subtitle: 'Set show time, location, and venue. Upload a flyer.',
      content: <BasicInfoSection show={show} onChange={handleUpdate} />,
    },
    {
      key: 'performers',
      sectionKey: 'performers' as SectionKey,
      title: '🎤 Performers',
      subtitle: 'Names, walk-on music, photos, and social media.',
      count: show.performers.length,
      content: <PerformersSection performers={show.performers} onChange={(performers) => handleUpdate({ performers })} />,
    },
    {
      key: 'artists',
      sectionKey: 'artists' as SectionKey,
      title: '🎨 Artists',
      subtitle: 'Artist entries with name, type, music, and photos.',
      count: show.artists.length,
      content: <ArtistsSection artists={show.artists} onChange={(artists) => handleUpdate({ artists })} />,
    },
    {
      key: 'schedule',
      sectionKey: 'schedule' as SectionKey,
      title: '📅 Schedule',
      subtitle: 'Timeline of events with times and descriptions.',
      count: show.schedule.length,
      content: <ScheduleSection schedule={show.schedule} onChange={(schedule) => handleUpdate({ schedule })} />,
    },
    {
      key: 'hosts',
      sectionKey: 'hosts' as SectionKey,
      title: '🎙️ Hosts',
      subtitle: 'Add hosts, notes, photos, and select the main host.',
      count: show.hosts.length,
      content: <HostsSection hosts={show.hosts} onChange={(hosts) => handleUpdate({ hosts })} />,
    },
    {
      key: 'dj',
      sectionKey: 'dj' as SectionKey,
      title: '🎵 DJ Music',
      subtitle: 'Songs and notes for the DJ.',
      count: show.djSongs.length,
      content: <DJMusicSection songs={show.djSongs} show={show} onChange={(djSongs) => handleUpdate({ djSongs })} />,
    },
    {
      key: 'staff',
      sectionKey: 'staff' as SectionKey,
      title: '👥 Staff',
      subtitle: 'Roles and assignments for production staff.',
      count: show.staff.length,
      content: <StaffSection staff={show.staff} onChange={(staff) => handleUpdate({ staff })} />,
    },
    {
      key: 'expenses',
      sectionKey: 'expenses' as SectionKey,
      title: '💰 Expenses',
      subtitle: 'Track costs and see totals automatically.',
      count: show.expenses.length,
      content: <ExpensesSection expenses={show.expenses} settings={settings} onChange={(expenses) => handleUpdate({ expenses })} />,
    },
  ];

  // Add recap section for past shows
  if (isPastShow) {
    sections.push({
      key: 'recap',
      sectionKey: 'recap' as SectionKey,
      title: '📝 Recap',
      subtitle: 'Attendance, sales, performer notes, and lessons learned.',
      content: <ShowRecapSection recap={show.recap} expenses={show.expenses} onChange={(recap) => handleUpdate({ recap })} />,
    });
  }

  return (
    <div className="show-detail">
      <div className="show-detail__hero">
        <div className="show-detail__topbar">
          <button className="btn btn--ghost" onClick={onBack}>← Back</button>
          <button className="btn btn--secondary btn--sm" onClick={() => exportShowToPDF(show, settings)}>
            📄 Export PDF
          </button>
        </div>
        <div className="show-detail__header">
          <h2 className="show-detail__title">{show.name}</h2>
          <span className={`show-detail__status show-detail__status--${show.status}`}>
            {show.status.replace('-', ' ')}
          </span>
        </div>
        {(show.venueName || show.location || show.date || show.time) && (
          <div className="show-detail__meta">
            {show.venueName && <span>🏛️ {show.venueName}</span>}
            {show.location && <span>🗺️ {show.location}</span>}
            {show.date && <span>📅 {new Date(show.date).toLocaleDateString()}</span>}
            {show.time && <span>⏰ {show.time}</span>}
          </div>
        )}
      </div>

      {show.flyer && (
        <div className="show-detail__flyer">
          <img src={show.flyer} alt="Show flyer" className="show-detail__flyer-image" />
        </div>
      )}

      <div className="show-detail__sections-accordion">
        {sections.map((section) => {
          const isExpanded = expandedSections.has(section.key);
          const isComplete = section.sectionKey ? show.completions?.[section.sectionKey] || false : false;
          
          return (
            <div
              key={section.key}
              className={`accordion-section ${isComplete ? 'accordion-section--complete' : ''}`}
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
                    {isComplete && (
                      <span className="accordion-section__complete-badge">✓ Complete</span>
                    )}
                  </div>
                  <p className="accordion-section__subtitle">{section.subtitle}</p>
                </div>
                <div className="accordion-section__header-right">
                  {section.sectionKey && (
                    <label 
                      className="accordion-section__completion-checkbox"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        checked={isComplete}
                        onChange={() => handleCompletionToggle(section.sectionKey!)}
                      />
                      <span>Mark Complete</span>
                    </label>
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

      <div className="show-detail__scenes">
        <SceneList scenes={show.scenes ?? []} onChange={handleScenesChange} />
      </div>
    </div>
  );
}

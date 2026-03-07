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
  const [expandedSection, setExpandedSection] = useState<string | null>(null);
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

  const sections = [
    {
      key: 'basic',
      title: '1. Basic Show Info',
      subtitle: 'Show time, location, and venue name.',
      content: <BasicInfoSection show={show} onChange={handleUpdate} />,
    },
    {
      key: 'performers',
      sectionKey: 'performers' as SectionKey,
      title: '2. Performers',
      subtitle: 'Names, walk-on music, photos, and optional videos.',
      count: show.performers.length,
      content: <PerformersSection performers={show.performers} onChange={(performers) => handleUpdate({ performers })} />,
    },
    {
      key: 'artists',
      sectionKey: 'artists' as SectionKey,
      title: '3. Artists',
      subtitle: 'Artist entries with music, photos, and optional video.',
      count: show.artists.length,
      content: <ArtistsSection artists={show.artists} onChange={(artists) => handleUpdate({ artists })} />,
    },
    {
      key: 'schedule',
      sectionKey: 'schedule' as SectionKey,
      title: '4. Exact Schedule & Timing',
      subtitle: 'Timeline of events with times and descriptions.',
      count: show.schedule.length,
      content: <ScheduleSection schedule={show.schedule} onChange={(schedule) => handleUpdate({ schedule })} />,
    },
    {
      key: 'hosts',
      sectionKey: 'hosts' as SectionKey,
      title: '5. Hosts',
      subtitle: 'Add hosts, notes, photos, and select the main host.',
      count: show.hosts.length,
      content: <HostsSection hosts={show.hosts} onChange={(hosts) => handleUpdate({ hosts })} />,
    },
    {
      key: 'dj',
      sectionKey: 'dj' as SectionKey,
      title: '6. DJ Music List',
      subtitle: 'Songs and notes for the DJ, exportable as text or PDF.',
      count: show.djSongs.length,
      content: <DJMusicSection songs={show.djSongs} show={show} onChange={(djSongs) => handleUpdate({ djSongs })} />,
    },
    {
      key: 'staff',
      sectionKey: 'staff' as SectionKey,
      title: '7. Staff & Crew',
      subtitle: 'Roles and assignments for production staff.',
      count: show.staff.length,
      content: <StaffSection staff={show.staff} onChange={(staff) => handleUpdate({ staff })} />,
    },
    {
      key: 'expenses',
      sectionKey: 'expenses' as SectionKey,
      title: '8. Itemized Expenses',
      subtitle: 'Track costs and see totals automatically.',
      count: show.expenses.length,
      content: <ExpensesSection expenses={show.expenses} settings={settings} onChange={(expenses) => handleUpdate({ expenses })} />,
    },
  ];

  // Add recap section for past shows
  if (isPastShow) {
    sections.push({
      key: 'recap',
      title: '9. Post-Show Recap',
      subtitle: 'Attendance, sales, performer notes, and lessons learned.',
      content: <ShowRecapSection recap={show.recap} expenses={show.expenses} onChange={(recap) => handleUpdate({ recap })} />,
    });
  }

  return (
    <div className="show-detail">
      <button className="show-detail__back btn btn--ghost" onClick={onBack}>
        ← Back
      </button>

      <div className="show-detail__actions">
        <button
          className="btn btn--primary"
          onClick={() => exportShowToPDF(show, settings)}
        >
          📄 Export to PDF
        </button>
      </div>

      <div className="show-detail__header">
        <h2 className="show-detail__title">{show.name}</h2>
        <span className={`show-detail__status show-detail__status--${show.status}`}>
          {show.status.replace('-', ' ')}
        </span>
      </div>

      <div className="show-detail__meta">
        {show.venueName && <span>🏛️ {show.venueName}</span>}
        {show.location && <span>🗺️ {show.location}</span>}
        {show.date && <span>📅 {new Date(show.date).toLocaleDateString()}</span>}
        {show.time && <span>⏰ {show.time}</span>}
      </div>

      {show.flyer && (
        <div className="show-detail__flyer">
          <img src={show.flyer} alt="Show flyer" className="show-detail__flyer-image" />
        </div>
      )}

      {expandedSection === null ? (
        <div className="show-detail__sections-grid">
          {sections.map((section) => (
            <div
              key={section.key}
              className="section-card"
            >
              <div 
                className="section-card__clickable"
                onClick={() => setExpandedSection(section.key)}
              >
                <div className="section-card__header">
                  <h3 className="section-card__title">{section.title}</h3>
                  {typeof section.count === 'number' && (
                    <span className="section-card__count">{section.count}</span>
                  )}
                </div>
                <p className="section-card__subtitle">{section.subtitle}</p>
                <div className="section-card__cta">Click to open →</div>
              </div>
              
              {section.sectionKey && (
                <div className="section-card__deadline">
                  {show.deadlines?.[section.sectionKey] ? (
                    <div className="section-card__deadline-display">
                      <DeadlineIndicator 
                        deadline={show.deadlines[section.sectionKey]} 
                        isComplete={show.completions?.[section.sectionKey] || false}
                      />
                      <label className="section-card__completion-checkbox">
                        <input
                          type="checkbox"
                          checked={show.completions?.[section.sectionKey] || false}
                          onChange={(e) => {
                            e.stopPropagation();
                            handleCompletionToggle(section.sectionKey!);
                          }}
                          onClick={(e) => e.stopPropagation()}
                        />
                        <span>Complete</span>
                      </label>
                      <button
                        className="btn btn--ghost btn--sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingDeadline(section.sectionKey!);
                        }}
                      >
                        Edit
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
                    <div className="section-card__deadline-editor" onClick={(e) => e.stopPropagation()}>
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
            </div>
          ))}
        </div>
      ) : (
        <div className="show-detail__expanded-section">
          <button
            className="btn btn--ghost show-detail__back-to-grid"
            onClick={() => setExpandedSection(null)}
          >
            ← Back to Grid
          </button>
          {sections.map((section) => 
            section.key === expandedSection ? (
              <section key={section.key} className="show-section show-section--expanded">
                <div className="show-section__header">
                  <div>
                    <h3 className="show-section__title">{section.title}</h3>
                    <p className="show-section__subtitle">{section.subtitle}</p>
                  </div>
                  <div className="show-section__header-right">
                    {typeof section.count === 'number' && (
                      <span className="show-section__count">{section.count} items</span>
                    )}
                    {section.sectionKey && show.deadlines?.[section.sectionKey] && (
                      <>
                        <label className="section-card__completion-checkbox">
                          <input
                            type="checkbox"
                            checked={show.completions?.[section.sectionKey] || false}
                            onChange={() => handleCompletionToggle(section.sectionKey!)}
                          />
                          <span>Complete</span>
                        </label>
                        <DeadlineIndicator 
                          deadline={show.deadlines[section.sectionKey]} 
                          isComplete={show.completions?.[section.sectionKey] || false}
                        />
                      </>
                    )}
                  </div>
                </div>
                <div className="show-section__content">{section.content}</div>
              </section>
            ) : null
          )}
        </div>
      )}

      <div className="show-detail__scenes">
        <SceneList scenes={show.scenes ?? []} onChange={handleScenesChange} />
      </div>
    </div>
  );
}

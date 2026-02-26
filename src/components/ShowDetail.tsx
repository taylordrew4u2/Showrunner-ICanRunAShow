import type { Show, Scene, AppSettings } from '../types';
import { SceneList } from './SceneList';
import { BasicInfoSection } from './sections/BasicInfoSection';
import { PerformersSection } from './sections/PerformersSection';
import { ArtistsSection } from './sections/ArtistsSection';
import { ScheduleSection } from './sections/ScheduleSection';
import { HostsSection } from './sections/HostsSection';
import { DJMusicSection } from './sections/DJMusicSection';
import { StaffSection } from './sections/StaffSection';
import { ExpensesSection } from './sections/ExpensesSection';
import { exportShowToPDF } from '../utils/pdfExport';
import './ShowDetail.css';

interface ShowDetailProps {
  show: Show;
  settings: AppSettings;
  onBack: () => void;
  onUpdate: (show: Show) => void;
}

export function ShowDetail({ show, settings, onBack, onUpdate }: ShowDetailProps) {
  function handleScenesChange(scenes: Scene[]) {
    onUpdate({ ...show, scenes });
  }

  function handleUpdate(updates: Partial<Show>) {
    onUpdate({ ...show, ...updates });
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
      title: '2. Performers',
      subtitle: 'Names, walk-on music, photos, and optional videos.',
      count: show.performers.length,
      content: <PerformersSection performers={show.performers} onChange={(performers) => handleUpdate({ performers })} />,
    },
    {
      key: 'artists',
      title: '3. Artists',
      subtitle: 'Artist entries with music, photos, and optional video.',
      count: show.artists.length,
      content: <ArtistsSection artists={show.artists} onChange={(artists) => handleUpdate({ artists })} />,
    },
    {
      key: 'schedule',
      title: '4. Exact Schedule & Timing',
      subtitle: 'Timeline of events with times and descriptions.',
      count: show.schedule.length,
      content: <ScheduleSection schedule={show.schedule} onChange={(schedule) => handleUpdate({ schedule })} />,
    },
    {
      key: 'hosts',
      title: '5. Hosts',
      subtitle: 'Add hosts, notes, photos, and select the main host.',
      count: show.hosts.length,
      content: <HostsSection hosts={show.hosts} onChange={(hosts) => handleUpdate({ hosts })} />,
    },
    {
      key: 'dj',
      title: '6. DJ Music List',
      subtitle: 'Songs and notes for the DJ, exportable as text or PDF.',
      count: show.djSongs.length,
      content: <DJMusicSection songs={show.djSongs} show={show} onChange={(djSongs) => handleUpdate({ djSongs })} />,
    },
    {
      key: 'staff',
      title: '7. Staff & Crew',
      subtitle: 'Roles and assignments for production staff.',
      count: show.staff.length,
      content: <StaffSection staff={show.staff} onChange={(staff) => handleUpdate({ staff })} />,
    },
    {
      key: 'expenses',
      title: '8. Itemized Expenses',
      subtitle: 'Track costs and see totals automatically.',
      count: show.expenses.length,
      content: <ExpensesSection expenses={show.expenses} onChange={(expenses) => handleUpdate({ expenses })} />,
    },
  ];

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

      <div className="show-detail__sections">
        {sections.map((section) => (
          <section key={section.key} className="show-section">
            <div className="show-section__header">
              <div>
                <h3 className="show-section__title">{section.title}</h3>
                <p className="show-section__subtitle">{section.subtitle}</p>
              </div>
              {typeof section.count === 'number' && (
                <span className="show-section__count">{section.count} items</span>
              )}
            </div>
            <div className="show-section__content">{section.content}</div>
          </section>
        ))}
      </div>

      <div className="show-detail__scenes">
        <SceneList scenes={show.scenes ?? []} onChange={handleScenesChange} />
      </div>
    </div>
  );
}

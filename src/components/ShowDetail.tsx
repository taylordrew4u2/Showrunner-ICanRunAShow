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
        {show.venueName && <span>📍 {show.venueName}</span>}
        {show.date && (
          <span>📅 {new Date(show.date).toLocaleDateString()}</span>
        )}
      </div>

      <div className="show-detail__sections">
        <BasicInfoSection show={show} onChange={handleUpdate} />
        <PerformersSection performers={show.performers} onChange={(performers) => handleUpdate({ performers })} />
        <ArtistsSection artists={show.artists} onChange={(artists) => handleUpdate({ artists })} />
        <ScheduleSection schedule={show.schedule} onChange={(schedule) => handleUpdate({ schedule })} />
        <HostsSection hosts={show.hosts} onChange={(hosts) => handleUpdate({ hosts })} />
        <DJMusicSection songs={show.djSongs} show={show} onChange={(djSongs) => handleUpdate({ djSongs })} />
        <StaffSection staff={show.staff} onChange={(staff) => handleUpdate({ staff })} />
        <ExpensesSection expenses={show.expenses} onChange={(expenses) => handleUpdate({ expenses })} />
      </div>

      <div className="show-detail__scenes">
        <SceneList scenes={show.scenes ?? []} onChange={handleScenesChange} />
      </div>
    </div>
  );
}

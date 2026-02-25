import type { Show } from '../types';
import './ShowCard.css';

interface ShowCardProps {
  show: Show;
  onSelect: (show: Show) => void;
  onDelete: (id: string) => void;
}

const STATUS_LABELS: Record<Show['status'], string> = {
  upcoming: 'Upcoming',
  'in-progress': 'In Progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export function ShowCard({ show, onSelect, onDelete }: ShowCardProps) {
  const performerCount = show.performers.length;
  const artistCount = show.artists?.length ?? 0;

  function handleDelete(e: React.MouseEvent) {
    e.stopPropagation();
    if (window.confirm(`Delete "${show.name}"?`)) {
      onDelete(show.id);
    }
  }

  return (
    <div className="show-card" onClick={() => onSelect(show)}>
      <div className="show-card__header">
        <h3 className="show-card__title">{show.name}</h3>
        <span className={`show-card__status show-card__status--${show.status}`}>
          {STATUS_LABELS[show.status]}
        </span>
      </div>
      {show.venueName && <p className="show-card__venue">📍 {show.venueName}</p>}
      {show.date && (
        <p className="show-card__date">📅 {show.date}</p>
      )}
      <div className="show-card__preview">
        {performerCount > 0 && (
          <span className="show-card__tag">👤 {performerCount} Performer{performerCount !== 1 ? 's' : ''}</span>
        )}
        {artistCount > 0 && (
          <span className="show-card__tag">🎨 {artistCount} Artist{artistCount !== 1 ? 's' : ''}</span>
        )}
        {show.schedule.length > 0 && (
          <span className="show-card__tag">⏱ {show.schedule.length} Events</span>
        )}
      </div>
      <button
        className="show-card__delete"
        onClick={handleDelete}
        aria-label="Delete show"
      >
        🗑
      </button>
    </div>
  );
}

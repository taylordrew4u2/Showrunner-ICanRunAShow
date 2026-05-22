import type { Show } from '../types';
import './ShowCard.css';

interface ShowCardProps {
  show: Show;
  onSelect: (show: Show, e: React.MouseEvent) => void;
  onDelete: (id: string) => void;
}

const STATUS_LABELS: Record<Show['status'], string> = {
  upcoming: 'Upcoming',
  'in-progress': 'In Progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export function ShowCard({ show, onSelect, onDelete }: ShowCardProps) {
  const sceneCount = show.scenes?.length ?? 0;
  const doneCount = show.scenes?.filter((s) => s.status === 'done').length ?? 0;

  function handleDelete(e: React.MouseEvent) {
    e.stopPropagation();
    if (window.confirm(`Delete show "${show.name}"? It will be moved to trash where you can recover it.`)) {
      onDelete(show.id);
    }
  }

  return (
    <div className="show-card" onClick={e => onSelect(show, e)}>
      <div className="show-card__header">
        <h3 className="show-card__title">{show.name}</h3>
        <span className={`show-card__status show-card__status--${show.status}`}>
          {STATUS_LABELS[show.status]}
        </span>
      </div>
      {show.venueName && <p className="show-card__venue">📍 {show.venueName}</p>}
      {show.date && (
        <p className="show-card__date">
          📅 {new Date(show.date).toLocaleDateString()}
        </p>
      )}
      {sceneCount > 0 && (
        <div className="show-card__progress">
          <div
            className="show-card__progress-bar"
            style={{ width: `${(doneCount / sceneCount) * 100}%` }}
          />
          <span className="show-card__progress-label">
            {doneCount}/{sceneCount} scenes
          </span>
        </div>
      )}
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

import type { Show } from '../types';
import './ShowCard.css';

interface ShowCardProps {
  show: Show;
  onSelect: (show: Show, e: React.MouseEvent) => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
}

const STATUS_LABELS: Record<Show['status'], string> = {
  upcoming: 'Upcoming',
  'in-progress': 'In Progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export function ShowCard({ show, onSelect, onDelete, onDuplicate }: ShowCardProps) {
  const sceneCount = show.scenes?.length ?? 0;
  const doneCount = show.scenes?.filter((s) => s.status === 'done').length ?? 0;

  function handleDelete(e: React.MouseEvent) {
    e.stopPropagation();
    if (window.confirm(`Delete show "${show.name}"? It will be moved to trash where you can recover it.`)) {
      onDelete(show.id);
    }
  }

  function handleDuplicate(e: React.MouseEvent) {
    e.stopPropagation();
    onDuplicate(show.id);
  }

  const dateStr = show.date
    ? new Date(show.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    : null;

  return (
    <div
      className={`show-card show-card--${show.status}`}
      onClick={e => onSelect(show, e)}
    >
      <div className="show-card__header">
        <h3 className="show-card__title">{show.name}</h3>
        <div className="show-card__actions">
          <button
            className="show-card__action-btn"
            onClick={handleDuplicate}
            aria-label="Duplicate show"
            title="Duplicate show"
          >
            ⧉
          </button>
          <button
            className="show-card__action-btn show-card__action-btn--delete"
            onClick={handleDelete}
            aria-label="Delete show"
            title="Delete show"
          >
            ×
          </button>
        </div>
      </div>

      {(show.venueName || dateStr) && (
        <div className="show-card__meta">
          {show.venueName && <span>{show.venueName}</span>}
          {show.venueName && dateStr && <span className="show-card__meta-sep">·</span>}
          {dateStr && <span>{dateStr}</span>}
        </div>
      )}

      <div className="show-card__footer">
        <span className="show-card__status">
          {STATUS_LABELS[show.status]}
        </span>
        {sceneCount > 0 && (
          <div className="show-card__progress-wrap">
            <div className="show-card__progress">
              <div
                className="show-card__progress-bar"
                style={{ width: `${(doneCount / sceneCount) * 100}%` }}
              />
            </div>
            <span className="show-card__progress-label">{doneCount}/{sceneCount}</span>
          </div>
        )}
      </div>
    </div>
  );
}

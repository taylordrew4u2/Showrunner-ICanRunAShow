import type { Show } from '../types';
import { parseShowDate, formatShowTime } from '../utils/showDate';
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

  const showDate = parseShowDate(show.date);
  const isCurrentYear = showDate?.getFullYear() === new Date().getFullYear();
  const timeStr = formatShowTime(show.time);
  const fullDateStr = showDate?.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  return (
    // The card is a container, not a control. It used to be role="button" with
    // two real buttons inside it — a control nested in a control, which is
    // invalid and leaves assistive tech guessing what activating it does. The
    // title is the control now; it stretches over the card (see the CSS) so
    // clicking anywhere still opens the show, while Duplicate and Delete stay
    // separately reachable.
    <article className={`show-card show-card--${show.status}`}>
      <div className="show-card__top">
        <div
          className={`show-card__date${showDate ? '' : ' show-card__date--tbd'}`}
          aria-hidden="true"
        >
          {showDate ? (
            <>
              <span className="show-card__date-month">
                {showDate.toLocaleDateString(undefined, { month: 'short' })}
              </span>
              <span className="show-card__date-day">{showDate.getDate()}</span>
              <span className="show-card__date-sub">
                {isCurrentYear
                  ? showDate.toLocaleDateString(undefined, { weekday: 'short' })
                  : showDate.getFullYear()}
              </span>
            </>
          ) : (
            <span className="show-card__date-tbd">TBD</span>
          )}
        </div>

        <div className="show-card__main">
          <h2 className="show-card__title">
            <button
              type="button"
              className="show-card__open"
              aria-label={`Open ${show.name}${fullDateStr ? `, ${fullDateStr}` : ''}`}
              onClick={e => onSelect(show, e)}
            >
              {show.name}
            </button>
          </h2>
          {(show.venueName || timeStr) && (
            <div className="show-card__meta">
              {timeStr && <span className="show-card__meta-time">{timeStr}</span>}
              {timeStr && show.venueName && <span className="show-card__meta-sep">·</span>}
              {show.venueName && <span>{show.venueName}</span>}
            </div>
          )}
        </div>

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
    </article>
  );
}

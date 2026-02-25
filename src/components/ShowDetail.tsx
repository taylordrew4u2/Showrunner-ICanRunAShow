import type { Show, Scene } from '../types';
import { SceneList } from './SceneList';
import './ShowDetail.css';

interface ShowDetailProps {
  show: Show;
  onBack: () => void;
  onUpdate: (show: Show) => void;
}

export function ShowDetail({ show, onBack, onUpdate }: ShowDetailProps) {
  function handleScenesChange(scenes: Scene[]) {
    onUpdate({ ...show, scenes });
  }

  return (
    <div className="show-detail">
      <button className="show-detail__back btn btn--ghost" onClick={onBack}>
        ← Back
      </button>

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

      <div className="show-detail__scenes">
        <SceneList scenes={show.scenes ?? []} onChange={handleScenesChange} />
      </div>
    </div>
  );
}

import { useState } from 'react';
import type { Scene, SceneStatus } from '../types';
import { generateId } from '../utils/id';
import './SceneList.css';
import { useConfirm } from './useConfirm';

interface SceneListProps {
  scenes: Scene[];
  onChange: (scenes: Scene[]) => void;
}

const STATUS_OPTIONS: SceneStatus[] = ['planned', 'rehearsed', 'filmed', 'done'];

export function SceneList({ scenes, onChange }: SceneListProps) {
  const { confirm, confirmDialog } = useConfirm();
  const [newTitle, setNewTitle] = useState('');

  function addScene() {
    if (!newTitle.trim()) return;
    const scene: Scene = {
      id: generateId(),
      title: newTitle.trim(),
      description: '',
      duration: 0,
      status: 'planned',
      order: scenes.length,
    };
    onChange([...scenes, scene]);
    setNewTitle('');
  }

  function updateStatus(id: string, status: SceneStatus) {
    onChange(scenes.map((s) => (s.id === id ? { ...s, status } : s)));
  }

  async function deleteScene(id: string) {
    const scene = scenes.find((s) => s.id === id);
    if (await confirm(`Delete scene "${scene?.title}"? This cannot be undone.`)) {
      onChange(scenes.filter((s) => s.id !== id));
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      addScene();
    }
  }

  return (
    <div className="scene-list">
      <h2 className="scene-list__heading">Scenes & Segments</h2>

      <div className="scene-list__add">
        <input
          className="scene-list__input"
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Add a scene or segment…"
          // The placeholder was the only thing naming this field, and a
          // placeholder isn't a name — it goes away the moment you type.
          aria-label="Add a scene or segment"
        />
        <button className="btn btn--primary" onClick={addScene}>
          Add
        </button>
      </div>

      {scenes.length === 0 && (
        <p className="scene-list__empty">No scenes yet. Add one above.</p>
      )}

      <ul className="scene-list__items">
        {scenes.map((scene, idx) => (
          <li key={scene.id} className="scene-item">
            <span className="scene-item__order">{idx + 1}</span>
            <span className="scene-item__title">{scene.title}</span>
            <select
              className={`scene-item__status scene-item__status--${scene.status}`}
              value={scene.status}
              onChange={(e) => updateStatus(scene.id, e.target.value as SceneStatus)}
              // Every scene has one of these, so an unnamed select is announced
              // as "combo box" N times over with nothing to tell them apart.
              aria-label={`Status for ${scene.title || `scene ${idx + 1}`}`}
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s.charAt(0).toUpperCase() + s.slice(1)}
                </option>
              ))}
            </select>
            <button
              className="scene-item__delete"
              onClick={() => deleteScene(scene.id)}
              aria-label="Delete scene"
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      {confirmDialog}
    </div>
  );
}

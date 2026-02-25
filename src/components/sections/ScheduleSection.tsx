import { useState } from 'react';
import type { ScheduleItem } from '../../types';
import { generateId } from '../../utils/id';

interface ScheduleSectionProps {
  schedule: ScheduleItem[];
  onChange: (schedule: ScheduleItem[]) => void;
}

export function ScheduleSection({ schedule, onChange }: ScheduleSectionProps) {
  const [time, setTime] = useState('');
  const [desc, setDesc] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [editTime, setEditTime] = useState('');
  const [editDesc, setEditDesc] = useState('');

  function addItem() {
    if (!desc.trim()) return;
    const item: ScheduleItem = { id: generateId(), time: time.trim(), description: desc.trim() };
    onChange([...schedule, item]);
    setTime('');
    setDesc('');
  }

  function deleteItem(id: string) {
    onChange(schedule.filter((s) => s.id !== id));
  }

  function startEdit(item: ScheduleItem) {
    setEditId(item.id);
    setEditTime(item.time);
    setEditDesc(item.description);
  }

  function saveEdit() {
    if (!editDesc.trim() || !editId) return;
    onChange(schedule.map((s) =>
      s.id === editId ? { ...s, time: editTime.trim(), description: editDesc.trim() } : s
    ));
    setEditId(null);
  }

  function moveUp(idx: number) {
    if (idx === 0) return;
    const arr = [...schedule];
    [arr[idx - 1], arr[idx]] = [arr[idx], arr[idx - 1]];
    onChange(arr);
  }

  function moveDown(idx: number) {
    if (idx >= schedule.length - 1) return;
    const arr = [...schedule];
    [arr[idx], arr[idx + 1]] = [arr[idx + 1], arr[idx]];
    onChange(arr);
  }

  return (
    <div className="section-body">
      <div className="section-add-row">
        <input
          className="section-field__input section-field__input--time"
          value={time}
          onChange={(e) => setTime(e.target.value)}
          placeholder="7:00 PM"
          style={{ maxWidth: 120 }}
        />
        <input
          className="section-field__input"
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addItem())}
          placeholder="Event description"
        />
        <button className="btn btn--primary btn--sm" onClick={addItem}>Add</button>
      </div>

      {schedule.length === 0 && <p className="section-empty">No schedule items yet.</p>}

      <ul className="section-list">
        {schedule.map((item, idx) => (
          <li key={item.id} className="section-list-item">
            <div className="section-list-item__body">
              {editId === item.id ? (
                <div className="section-edit-row">
                  <input
                    className="section-field__input"
                    value={editTime}
                    onChange={(e) => setEditTime(e.target.value)}
                    style={{ maxWidth: 120 }}
                  />
                  <input
                    className="section-field__input"
                    value={editDesc}
                    onChange={(e) => setEditDesc(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && saveEdit()}
                    autoFocus
                  />
                  <button className="btn btn--primary btn--sm" onClick={saveEdit}>Save</button>
                  <button className="btn btn--ghost btn--sm" onClick={() => setEditId(null)}>Cancel</button>
                </div>
              ) : (
                <>
                  <span className="section-list-item__time">{item.time}</span>
                  <span className="section-list-item__name">{item.description}</span>
                </>
              )}
            </div>
            {editId !== item.id && (
              <div className="section-list-item__actions">
                <button className="btn btn--ghost btn--sm" onClick={() => startEdit(item)}>✏️</button>
                <button className="btn btn--ghost btn--sm" onClick={() => moveUp(idx)} disabled={idx === 0}>↑</button>
                <button className="btn btn--ghost btn--sm" onClick={() => moveDown(idx)} disabled={idx >= schedule.length - 1}>↓</button>
                <button className="btn btn--ghost btn--sm section-list-item__delete" onClick={() => deleteItem(item.id)}>✕</button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

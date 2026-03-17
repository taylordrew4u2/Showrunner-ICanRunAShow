import { useState, useRef } from 'react';
import type { ScheduleItem } from '../../types';
import { generateId } from '../../utils/id';

interface ScheduleSectionProps {
  schedule: ScheduleItem[];
  scheduleImage?: string;
  onChange: (schedule: ScheduleItem[]) => void;
  onImageChange: (image: string | undefined) => void;
}

type ScheduleMode = 'choose' | 'build' | 'upload';

export function ScheduleSection({ schedule, scheduleImage, onChange, onImageChange }: ScheduleSectionProps) {
  // Determine initial mode based on existing data
  const initialMode: ScheduleMode = scheduleImage ? 'upload' : schedule.length > 0 ? 'build' : 'choose';
  const [mode, setMode] = useState<ScheduleMode>(initialMode);
  const [time, setTime] = useState('');
  const [desc, setDesc] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [editTime, setEditTime] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  function addItem() {
    if (!desc.trim()) return;
    const item: ScheduleItem = { id: generateId(), time: time.trim(), description: desc.trim() };
    onChange([...schedule, item]);
    setTime('');
    setDesc('');
  }

  function deleteItem(id: string) {
    const item = schedule.find((s) => s.id === id);
    if (window.confirm(`Delete schedule item "${item?.description}"?`)) {
      onChange(schedule.filter((s) => s.id !== id));
    }
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

  function handleFileUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      onImageChange(reader.result as string);
      onChange([]); // clear manual items when uploading
    };
    reader.readAsDataURL(file);
    event.target.value = '';
  }

  function handleSwitchToBuild() {
    onImageChange(undefined);
    setMode('build');
  }

  function handleSwitchToUpload() {
    onChange([]);
    setMode('upload');
  }

  return (
    <div className="section-body">
      {/* Choice screen — only when nothing exists yet */}
      {mode === 'choose' && (
        <div className="schedule-choice">
          <button className="schedule-choice__option" onClick={() => setMode('build')}>
            <span className="schedule-choice__icon">✏️</span>
            <span className="schedule-choice__label">Build Your Own</span>
            <span className="schedule-choice__desc">Create the show run manually</span>
          </button>
          <button className="schedule-choice__option" onClick={() => setMode('upload')}>
            <span className="schedule-choice__icon">📄</span>
            <span className="schedule-choice__label">Upload File</span>
            <span className="schedule-choice__desc">Upload a PDF or image of your show run</span>
          </button>
        </div>
      )}

      {/* Build your own mode — always editable */}
      {mode === 'build' && (
        <>
          <div className="section-add-row">
            <input
              className="section-field__input section-field__input--time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              placeholder="7:00 PM"
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

          {schedule.length === 0 && <p className="section-empty">No schedule items yet. Add your first one above.</p>}

          <ul className="section-list">
            {schedule.map((item, idx) => (
              <li key={item.id} className="section-list-item">
                <div className="section-list-item__body">
                  {editId === item.id ? (
                    <div className="section-edit-row">
                      <input
                        className="section-field__input section-field__input--time"
                        value={editTime}
                        onChange={(e) => setEditTime(e.target.value)}
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

          <button className="btn btn--ghost btn--sm" style={{ marginTop: 12 }} onClick={handleSwitchToUpload}>
            📄 Switch to upload instead
          </button>
        </>
      )}

      {/* Upload mode */}
      {mode === 'upload' && (
        <>
          {scheduleImage ? (
            <div className="schedule-image-fallback">
              <div className="schedule-image-fallback__header">
                <span className="schedule-image-fallback__badge">📄 Uploaded Show Run</span>
                <button
                  className="btn btn--ghost btn--sm"
                  onClick={() => fileInputRef.current?.click()}
                  title="Replace with a different file"
                >
                  🔄 Replace
                </button>
                <button
                  className="btn btn--ghost btn--sm"
                  onClick={handleSwitchToBuild}
                  title="Remove image and build manually"
                >
                  ✕ Remove
                </button>
              </div>
              {scheduleImage.startsWith('data:application/pdf') ? (
                <embed src={scheduleImage} type="application/pdf" className="schedule-image-fallback__pdf" />
              ) : (
                <img src={scheduleImage} alt="Show Run" className="schedule-image-fallback__img" />
              )}
            </div>
          ) : (
            <div
              className="schedule-upload__dropzone"
              onClick={() => fileInputRef.current?.click()}
            >
              <span className="schedule-upload__icon">📄</span>
              <span className="schedule-upload__label">
                Click to upload a PDF or image of your show run
              </span>
              <span className="schedule-upload__formats">
                Accepts PDF, JPEG, PNG
              </span>
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,image/*"
            onChange={handleFileUpload}
            className="schedule-upload__file-input"
          />
          {!scheduleImage && (
            <button className="btn btn--ghost btn--sm" style={{ marginTop: 12 }} onClick={handleSwitchToBuild}>
              ✏️ Switch to build your own instead
            </button>
          )}
        </>
      )}
    </div>
  );
}

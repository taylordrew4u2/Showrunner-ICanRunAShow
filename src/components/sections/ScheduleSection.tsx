import { useEffect, useMemo, useRef, useState } from 'react';
import type { ScheduleItem } from '../../types';
import { generateId } from '../../utils/id';
import { Icon } from '../Icon';
import { AIImportFlow } from '../AIImportFlow';
import { LiveMode } from '../LiveMode';

interface ScheduleSectionProps {
  schedule: ScheduleItem[];
  scheduleImage?: string;
  showName?: string;
  onChange: (schedule: ScheduleItem[]) => void;
  onImageChange: (image: string | undefined) => void;
}

type ScheduleMode = 'choose' | 'build' | 'upload';

function timeToMinutes(time: string): number | null {
  if (!time) return null;
  const m = time.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const mins = m[2] ? parseInt(m[2], 10) : 0;
  const meridiem = m[3]?.toLowerCase();
  if (meridiem === 'pm' && h < 12) h += 12;
  if (meridiem === 'am' && h === 12) h = 0;
  if (h > 23 || mins > 59) return null;
  return h * 60 + mins;
}

function durationLabel(items: ScheduleItem[], idx: number): string | null {
  const cur = timeToMinutes(items[idx]?.time || '');
  const next = timeToMinutes(items[idx + 1]?.time || '');
  if (cur != null && next != null && next > cur) {
    const diff = next - cur;
    if (diff >= 60) {
      const h = Math.floor(diff / 60);
      const m = diff % 60;
      return m === 0 ? `${h}h` : `${h}h ${m}m`;
    }
    return `${diff}m`;
  }
  return null;
}

function totalRuntimeLabel(items: ScheduleItem[]): string | null {
  if (items.length < 2) return null;
  const first = timeToMinutes(items[0]?.time || '');
  const last = timeToMinutes(items[items.length - 1]?.time || '');
  if (first == null || last == null || last <= first) return null;
  const total = last - first;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h === 0 ? `${m}m total` : m === 0 ? `${h}h total` : `${h}h ${m}m total`;
}

function statusForIndex(items: ScheduleItem[], idx: number): 'done' | 'current' | 'upcoming' | 'pending' {
  const target = timeToMinutes(items[idx]?.time || '');
  if (target == null) return 'pending';
  const now = new Date();
  const nowMins = now.getHours() * 60 + now.getMinutes();
  const next = timeToMinutes(items[idx + 1]?.time || '');
  if (nowMins >= target && (next == null || nowMins < next)) return 'current';
  if (nowMins >= target) return 'done';
  return 'upcoming';
}

export function ScheduleSection({
  schedule,
  scheduleImage,
  showName,
  onChange,
  onImageChange,
}: ScheduleSectionProps) {
  const initialMode: ScheduleMode = scheduleImage ? 'upload' : schedule.length > 0 ? 'build' : 'choose';
  const [mode, setMode] = useState<ScheduleMode>(initialMode);
  const [time, setTime] = useState('');
  const [desc, setDesc] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [editTime, setEditTime] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [liveOpen, setLiveOpen] = useState(false);
  const [, forceRender] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Tick once a minute so "current" status updates on its own.
  useEffect(() => {
    const id = window.setInterval(() => forceRender((n) => n + 1), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const totalLabel = useMemo(() => totalRuntimeLabel(schedule), [schedule]);

  function addItem() {
    if (!desc.trim()) return;
    onChange([...schedule, { id: generateId(), time: time.trim(), description: desc.trim() }]);
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
    onChange(
      schedule.map((s) =>
        s.id === editId ? { ...s, time: editTime.trim(), description: editDesc.trim() } : s,
      ),
    );
    setEditId(null);
  }

  function move(idx: number, dir: -1 | 1) {
    const j = idx + dir;
    if (j < 0 || j >= schedule.length) return;
    const arr = [...schedule];
    [arr[idx], arr[j]] = [arr[j], arr[idx]];
    onChange(arr);
  }

  function handleFileUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      onImageChange(reader.result as string);
      onChange([]);
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

  function handleApplyImport(items: ScheduleItem[]) {
    onChange([...schedule, ...items]);
    setImportOpen(false);
    setMode('build');
  }

  return (
    <div className="section-body">
      {mode === 'choose' && (
        <div className="schedule-choice">
          <button className="schedule-choice__option" onClick={() => setMode('build')}>
            <span className="schedule-choice__icon">✏️</span>
            <span className="schedule-choice__label">Build Your Own</span>
            <span className="schedule-choice__desc">Create the show run manually</span>
          </button>
          <button className="schedule-choice__option" onClick={() => setImportOpen(true)}>
            <span className="schedule-choice__icon">✨</span>
            <span className="schedule-choice__label">Import with AI</span>
            <span className="schedule-choice__desc">Photo, PDF, or paste — AI extracts cues</span>
          </button>
          <button className="schedule-choice__option" onClick={() => setMode('upload')}>
            <span className="schedule-choice__icon">📄</span>
            <span className="schedule-choice__label">Upload File</span>
            <span className="schedule-choice__desc">Attach a PDF or image of your show run</span>
          </button>
        </div>
      )}

      {mode === 'build' && (
        <>
          <div className="schedule-summary">
            <div>
              <div className="schedule-summary__label">Run-of-show</div>
              <div className="schedule-summary__title">
                {showName ? `${showName} · ` : ''}{schedule.length} cue{schedule.length === 1 ? '' : 's'}
              </div>
              {totalLabel && <div className="schedule-summary__meta">{totalLabel}</div>}
            </div>
            <button
              className="go-live-btn"
              onClick={() => setLiveOpen(true)}
              disabled={schedule.length === 0}
              style={schedule.length === 0 ? { opacity: 0.45, cursor: 'not-allowed' } : undefined}
              title={schedule.length === 0 ? 'Add a cue first' : 'Run the show in Live mode'}
            >
              <Icon name="play" size={12} />
              Go Live
            </button>
          </div>

          <button className="ai-import-entry" onClick={() => setImportOpen(true)}>
            <span className="ai-import-entry__icon"><Icon name="sparkle" size={14} /></span>
            <div className="ai-import-entry__body">
              <div className="ai-import-entry__title">Import with AI</div>
              <div className="ai-import-entry__sub">Paste, photo, or upload — AI extracts cues</div>
            </div>
            <span className="ai-import-entry__chevron"><Icon name="chevron-right" size={16} /></span>
          </button>

          <div className="quick-add">
            <input
              className="quick-add__time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              placeholder="8:00 PM"
              aria-label="Time"
            />
            <input
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              placeholder="Add a cue..."
              onKeyDown={(e) => e.key === 'Enter' && addItem()}
              aria-label="Description"
            />
            <button
              className="quick-add__btn"
              onClick={addItem}
              disabled={!desc.trim()}
              aria-label="Add cue"
            >
              <Icon name="plus" size={18} />
            </button>
          </div>

          {schedule.length === 0 ? (
            <p className="section-empty">No cues yet. Use the bar above or import with AI.</p>
          ) : (
            <div className="cue-list">
              {schedule.map((item, idx) => {
                const status = statusForIndex(schedule, idx);
                const dur = durationLabel(schedule, idx);
                const isEditing = editId === item.id;
                return (
                  <div
                    key={item.id}
                    className={`cue cue--${status} ${isEditing ? 'cue--editing' : ''}`}
                  >
                    <div className="cue__rail" />
                    <div className="cue__handle" aria-hidden="true">
                      <Icon name="drag" size={14} />
                    </div>
                    <div className="cue__time">
                      {isEditing ? (
                        <input
                          className="cue__edit-input cue__edit-input--time"
                          value={editTime}
                          onChange={(e) => setEditTime(e.target.value)}
                          aria-label="Edit time"
                        />
                      ) : (
                        <>
                          <span>{item.time || '—'}</span>
                          {dur && <span className="cue__time-sub">{dur}</span>}
                        </>
                      )}
                    </div>
                    <div className="cue__body">
                      {isEditing ? (
                        <input
                          className="cue__edit-input"
                          value={editDesc}
                          onChange={(e) => setEditDesc(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') saveEdit();
                            if (e.key === 'Escape') setEditId(null);
                          }}
                          autoFocus
                          aria-label="Edit description"
                        />
                      ) : (
                        <>
                          <p className="cue__title">{item.description}</p>
                          <p className="cue__sub">
                            {status === 'current' && (
                              <span style={{ color: 'var(--primary)', fontWeight: 700 }}>Now</span>
                            )}
                            {status === 'done' && <span>Done</span>}
                            {status === 'upcoming' && <span>Upcoming</span>}
                          </p>
                        </>
                      )}
                    </div>
                    <div className="cue__menu" style={{ display: 'flex', gap: 2 }}>
                      {isEditing ? (
                        <>
                          <button
                            className="icon-btn icon-btn--ghost"
                            onClick={saveEdit}
                            aria-label="Save"
                          >
                            <Icon name="check" size={16} />
                          </button>
                          <button
                            className="icon-btn icon-btn--ghost"
                            onClick={() => setEditId(null)}
                            aria-label="Cancel"
                          >
                            <Icon name="x" size={16} />
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            className="icon-btn icon-btn--ghost"
                            onClick={() => move(idx, -1)}
                            disabled={idx === 0}
                            aria-label="Move up"
                            title="Move up"
                          >
                            <span aria-hidden style={{ fontSize: 14, fontWeight: 700 }}>↑</span>
                          </button>
                          <button
                            className="icon-btn icon-btn--ghost"
                            onClick={() => move(idx, 1)}
                            disabled={idx === schedule.length - 1}
                            aria-label="Move down"
                            title="Move down"
                          >
                            <span aria-hidden style={{ fontSize: 14, fontWeight: 700 }}>↓</span>
                          </button>
                          <button
                            className="icon-btn icon-btn--ghost"
                            onClick={() => startEdit(item)}
                            aria-label="Edit"
                            title="Edit"
                          >
                            <Icon name="edit" size={14} />
                          </button>
                          <button
                            className="icon-btn icon-btn--ghost"
                            onClick={() => deleteItem(item.id)}
                            aria-label="Delete"
                            title="Delete"
                            style={{ color: 'var(--danger)' }}
                          >
                            <Icon name="x" size={14} />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <button
            className="btn btn--ghost btn--sm"
            style={{ marginTop: 12 }}
            onClick={handleSwitchToUpload}
          >
            📄 Switch to upload instead
          </button>
        </>
      )}

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
            <div className="dropzone" onClick={() => fileInputRef.current?.click()}>
              <div className="dropzone__icon"><Icon name="file" size={28} /></div>
              <div className="dropzone__title">Upload a PDF or image</div>
              <div className="dropzone__sub">We'll attach it as-is. To extract cues automatically, use AI Import.</div>
              <button className="btn btn--secondary btn--sm">Choose file</button>
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
            <button
              className="btn btn--ghost btn--sm"
              style={{ marginTop: 12 }}
              onClick={handleSwitchToBuild}
            >
              ✏️ Switch to build your own instead
            </button>
          )}
        </>
      )}

      {importOpen && (
        <AIImportFlow
          showName={showName || 'Show'}
          onClose={() => setImportOpen(false)}
          onApply={handleApplyImport}
        />
      )}

      {liveOpen && (
        <LiveMode
          showName={showName || 'Show'}
          schedule={schedule}
          onClose={() => setLiveOpen(false)}
        />
      )}
    </div>
  );
}

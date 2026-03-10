import { useState, useRef, useEffect } from 'react';
import type { ScheduleItem } from '../../types';
import { generateId } from '../../utils/id';
import { importScheduleFromFile, parseScheduleManually } from '../../utils/aiExtractor';

interface ScheduleSectionProps {
  schedule: ScheduleItem[];
  scheduleImage?: string;
  onChange: (schedule: ScheduleItem[]) => void;
  onImageChange: (image: string | undefined) => void;
}

type ScheduleMode = 'create' | 'upload';

const EXAMPLE_SCHEDULE: Omit<ScheduleItem, 'id'>[] = [
  { time: '6:00 PM', description: 'Doors Open' },
  { time: '6:30 PM', description: 'Sound Check' },
  { time: '7:00 PM', description: 'Opening Act' },
  { time: '8:00 PM', description: 'Main Performance' },
  { time: '9:30 PM', description: 'Intermission' },
  { time: '10:00 PM', description: 'Closing Act' },
  { time: '11:00 PM', description: 'Doors Close' },
];

export function ScheduleSection({ schedule, scheduleImage, onChange, onImageChange }: ScheduleSectionProps) {
  const [mode, setMode] = useState<ScheduleMode>('create');
  const [time, setTime] = useState('');
  const [desc, setDesc] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [editTime, setEditTime] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState<string | null>(null);
  const [dragFileName, setDragFileName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);
  const [hasInitialized, setHasInitialized] = useState(false);

  // Auto-populate with example schedule when empty
  useEffect(() => {
    if (!hasInitialized && schedule.length === 0) {
      const exampleItems = EXAMPLE_SCHEDULE.map((item) => ({
        ...item,
        id: generateId(),
      }));
      onChange(exampleItems);
      setHasInitialized(true);
    }
  }, [schedule.length, hasInitialized, onChange]);

  function addItem() {
    if (!desc.trim()) return;
    const item: ScheduleItem = { id: generateId(), time: time.trim(), description: desc.trim() };
    onChange([...schedule, item]);
    setTime('');
    setDesc('');
  }

  function deleteItem(id: string) {
    const item = schedule.find((s) => s.id === id);
    if (window.confirm(`Delete schedule item "${item?.description}"? This cannot be undone.`)) {
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

  async function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function processFile(file: File) {
    setImporting(true);
    setImportError(null);
    setImportSuccess(null);
    setDragFileName(file.name);

    try {
      let items: ScheduleItem[];

      // Try AI extraction first if API key is available
      if (import.meta.env.VITE_OPENAI_API_KEY) {
        items = await importScheduleFromFile(file);
      } else {
        // Use manual parsing directly
        const text = await file.text();
        items = parseScheduleManually(text);
      }

      if (items.length === 0) {
        // Fallback: store the file as an image
        const base64 = await fileToBase64(file);
        onChange([]);
        onImageChange(base64);
        setImportSuccess(`Could not extract schedule items — saved "${file.name}" as the schedule image instead.`);
        return;
      }

      onChange([...schedule, ...items]);
      setImportSuccess(`Imported ${items.length} schedule item${items.length !== 1 ? 's' : ''} from ${file.name}`);
    } catch (error) {
      console.error('Import error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';

      // Auto-fallback to manual parsing if AI fails
      if (errorMessage.includes('API key') || errorMessage.includes('OpenAI') || errorMessage.includes('Failed to extract')) {
        try {
          const text = await file.text();
          const items = parseScheduleManually(text);
          if (items.length > 0) {
            onChange([...schedule, ...items]);
            setImportSuccess(`Imported ${items.length} schedule item${items.length !== 1 ? 's' : ''} from ${file.name}`);
            return;
          }
        } catch { /* fall through to image fallback */ }
      }

      // Final fallback: store the file as an image
      try {
        const base64 = await fileToBase64(file);
        onChange([]);
        onImageChange(base64);
        setImportSuccess(`Could not extract schedule items — saved "${file.name}" as the schedule image instead.`);
      } catch {
        setImportError('Could not parse or save the file. Try a different format.');
      }
    } finally {
      setImporting(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  }

  function handleFileImport(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) processFile(file);
  }

  function handleDrop(event: React.DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    dropZoneRef.current?.classList.remove('schedule-upload__dropzone--active');
    const file = event.dataTransfer.files[0];
    if (file) processFile(file);
  }

  function handleDragOver(event: React.DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    dropZoneRef.current?.classList.add('schedule-upload__dropzone--active');
  }

  function handleDragLeave(event: React.DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    dropZoneRef.current?.classList.remove('schedule-upload__dropzone--active');
  }

  return (
    <div className="section-body">
      {/* Mode toggle */}
      <div className="schedule-mode-toggle">
        <button
          className={`schedule-mode-toggle__btn ${mode === 'create' ? 'schedule-mode-toggle__btn--active' : ''}`}
          onClick={() => { setMode('create'); setImportError(null); setImportSuccess(null); }}
        >
          ✏️ Create Schedule
        </button>
        <button
          className={`schedule-mode-toggle__btn ${mode === 'upload' ? 'schedule-mode-toggle__btn--active' : ''}`}
          onClick={() => { setMode('upload'); setImportError(null); setImportSuccess(null); }}
        >
          � Import from File
        </button>
      </div>

      {/* Import file mode */}
      {mode === 'upload' && (
        <div className="schedule-upload">
          <div
            ref={dropZoneRef}
            className="schedule-upload__dropzone"
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt,.csv,.json,.pdf,image/*"
              onChange={handleFileImport}
              className="schedule-upload__file-input"
            />
            {importing ? (
              <div className="schedule-upload__loading">
                <span className="schedule-upload__spinner" />
                <span>Importing from {dragFileName}...</span>
              </div>
            ) : (
              <>
                <span className="schedule-upload__icon">🤖</span>
                <span className="schedule-upload__label">
                  Drag & drop a file here, or click to browse
                </span>
                <span className="schedule-upload__formats">
                  AI scans .txt, .csv, .json, .pdf, and images
                </span>
              </>
            )}
          </div>
          {importError && (
            <div className="schedule-upload__error">{importError}</div>
          )}
          {importSuccess && (
            <div className="schedule-upload__success">{importSuccess}</div>
          )}
          <div className="schedule-upload__tip">
            <strong>🤖 AI-powered:</strong> Upload any file or photo of a schedule — AI will extract the times and events automatically.<br />
            Text files work best with lines like: <code>7:00 PM - Doors Open</code>
          </div>
        </div>
      )}

      {/* Create schedule mode */}
      {mode === 'create' && (
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
      )}

      {/* Schedule image fallback display */}
      {scheduleImage && (
        <div className="schedule-image-fallback">
          <div className="schedule-image-fallback__header">
            <span className="schedule-image-fallback__badge">📷 Uploaded Schedule</span>
            <button
              className="btn btn--ghost btn--sm"
              onClick={() => onImageChange(undefined)}
              title="Remove image and switch to manual schedule"
            >
              ✕ Remove
            </button>
          </div>
          <img src={scheduleImage} alt="Schedule" className="schedule-image-fallback__img" />
        </div>
      )}

      {/* Only show schedule items list if no image fallback */}
      {!scheduleImage && schedule.length === 0 && <p className="section-empty">No schedule items yet.</p>}

      {!scheduleImage && (
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
      )}
    </div>
  );
}

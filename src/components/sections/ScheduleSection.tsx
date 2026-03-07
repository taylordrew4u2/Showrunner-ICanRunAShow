import { useState, useRef, useEffect } from 'react';
import type { ScheduleItem } from '../../types';
import { generateId } from '../../utils/id';
import { importScheduleFromFile, parseScheduleManually } from '../../utils/aiExtractor';

interface ScheduleSectionProps {
  schedule: ScheduleItem[];
  onChange: (schedule: ScheduleItem[]) => void;
}

const EXAMPLE_SCHEDULE: Omit<ScheduleItem, 'id'>[] = [
  { time: '6:00 PM', description: 'Doors Open' },
  { time: '6:30 PM', description: 'Sound Check' },
  { time: '7:00 PM', description: 'Opening Act' },
  { time: '8:00 PM', description: 'Main Performance' },
  { time: '9:30 PM', description: 'Intermission' },
  { time: '10:00 PM', description: 'Closing Act' },
  { time: '11:00 PM', description: 'Doors Close' },
];

export function ScheduleSection({ schedule, onChange }: ScheduleSectionProps) {
  const [time, setTime] = useState('');
  const [desc, setDesc] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [editTime, setEditTime] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
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

  async function handleFileImport(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setImporting(true);
    setImportError(null);

    try {
      const items = await importScheduleFromFile(file);
      
      // Add imported items to existing schedule
      onChange([...schedule, ...items]);
      
      // Show success message
      alert(`Successfully imported ${items.length} schedule items!`);
      
    } catch (error) {
      console.error('Import error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      setImportError(errorMessage);
      
      // If AI fails, offer manual parsing option
      if (errorMessage.includes('API key') || errorMessage.includes('OpenAI')) {
        const useManual = confirm(
          'AI extraction is not available. Would you like to try basic text parsing instead?\n\n' +
          'This will look for time patterns like "7:00 PM" in your file.'
        );
        
        if (useManual) {
          try {
            const text = await file.text();
            const items = parseScheduleManually(text);
            if (items.length > 0) {
              onChange([...schedule, ...items]);
              alert(`Successfully imported ${items.length} schedule items using basic parsing!`);
            } else {
              setImportError('No schedule data found. Make sure each line has a time (e.g., "7:00 PM") followed by a description.');
            }
          } catch (err) {
            setImportError('Failed to read file');
          }
        }
      }
    } finally {
      setImporting(false);
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  }

  function triggerFileInput() {
    fileInputRef.current?.click();
  }

  return (
    <div className="section-body">
      {/* Import file section */}
      <div className="schedule-import">
        <div className="schedule-import__row">
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,.csv,.json,.pdf,image/*"
            onChange={handleFileImport}
            className="schedule-import__file-input"
          />
          <button 
            className="btn btn--primary" 
            onClick={triggerFileInput}
            disabled={importing}
          >
            {importing ? 'Importing Schedule...' : 'Import Schedule from File'}
          </button>
          <span className="schedule-import__hint">
            Supports .txt, .csv, .json, .pdf, and images
          </span>
        </div>
        {importError && (
          <div className="schedule-import__error">
            Error: {importError}
          </div>
        )}
        <div className="schedule-import__tip">
          <strong>Tip:</strong> Your file should contain schedule items with times (e.g., "7:00 PM") and descriptions. 
          The AI will automatically extract and organize them. {!import.meta.env.VITE_OPENAI_API_KEY && '(Add VITE_OPENAI_API_KEY for AI extraction)'}
        </div>
      </div>

      {/* Manual add section */}
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

      {schedule.length === 0 && <p className="section-empty">No schedule items yet.</p>}

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
    </div>
  );
}

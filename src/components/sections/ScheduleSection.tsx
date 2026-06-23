import { lazy, memo, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Performer, ScheduleItem } from '../../types';
import { generateId } from '../../utils/id';
import { embedSizeError, readFileAsDataURL, pickFile } from '../../utils/media';
import { Icon } from '../Icon';

// Loaded on demand — pulls in the AI/OCR/PDF parsing deps only when the
// import flow is actually opened, keeping them out of the main bundle.
const AIImportFlow = lazy(() =>
  import('../AIImportFlow').then((m) => ({ default: m.AIImportFlow })),
);

interface ScheduleSectionProps {
  schedule: ScheduleItem[];
  scheduleImage?: string;
  showName?: string;
  performers?: Performer[];
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

function formatMinutes(total: number): string {
  if (total >= 60) {
    const h = Math.floor(total / 60);
    const m = total % 60;
    return m === 0 ? `${h}h` : `${h}h ${m}m`;
  }
  return `${total}m`;
}

function durationLabel(items: ScheduleItem[], idx: number): string | null {
  const explicit = items[idx]?.durationMin;
  if (explicit && explicit > 0) return formatMinutes(explicit);
  const cur = timeToMinutes(items[idx]?.time || '');
  const next = timeToMinutes(items[idx + 1]?.time || '');
  if (cur != null && next != null && next > cur) return formatMinutes(next - cur);
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

function cueMusicLabelFor(item: ScheduleItem, performers: Performer[]): string | null {
  if (item.music) return item.musicName || 'Uploaded track';
  const perf = item.performerId ? performers.find((p) => p.id === item.performerId) : null;
  if (perf?.walkOnMusic) return `Walk-on · ${perf.walkOnMusicName || perf.name}`;
  return null;
}

// ─── Memoized cue row ──────────────────────────────────────────────
// Each row owns its own edit + media-panel state so typing only re-renders
// this single row instead of all 30+ cues in the list.

interface CueRowProps {
  item: ScheduleItem;
  idx: number;
  isFirst: boolean;
  isLast: boolean;
  durationText: string | null;
  musicLabel: string | null;
  performers: Performer[];
  onPatch: (id: string, patch: Partial<ScheduleItem>) => void;
  onDelete: (id: string) => void;
  onMove: (idx: number, dir: -1 | 1) => void;
  onPickMusic: (id: string) => Promise<string | null>; // returns error or null
}

const CueRow = memo(function CueRow({
  item, idx, isFirst, isLast, durationText, musicLabel, performers,
  onPatch, onDelete, onMove, onPickMusic,
}: CueRowProps) {
  const [editing, setEditing] = useState(false);
  const [editTime, setEditTime] = useState(item.time);
  const [editDesc, setEditDesc] = useState(item.description);
  const [editPerformer, setEditPerformer] = useState(item.performer ?? '');
  const [editPerformerId, setEditPerformerId] = useState(item.performerId ?? '');
  const [editLength, setEditLength] = useState(item.durationMin != null ? String(item.durationMin) : '');
  const [mediaOpen, setMediaOpen] = useState(false);
  const [musicError, setMusicError] = useState<string | null>(null);
  // Local state for music duration so each keystroke doesn't propagate up the tree.
  const [musicDurDraft, setMusicDurDraft] = useState<string>(item.musicDuration != null ? String(item.musicDuration) : '');

  function startEdit() {
    setEditTime(item.time);
    setEditDesc(item.description);
    setEditPerformer(item.performer ?? '');
    setEditPerformerId(item.performerId ?? '');
    setEditLength(item.durationMin != null ? String(item.durationMin) : '');
    setEditing(true);
  }

  function saveEdit() {
    if (!editDesc.trim()) return;
    const lengthNum = editLength.trim() === '' ? undefined : Math.max(0, parseInt(editLength, 10) || 0);
    onPatch(item.id, {
      time: editTime.trim(),
      description: editDesc.trim(),
      performer: editPerformer.trim() || undefined,
      performerId: editPerformerId || undefined,
      durationMin: lengthNum && lengthNum > 0 ? lengthNum : undefined,
    });
    setEditing(false);
  }

  function commitMusicDuration() {
    const v = musicDurDraft.trim();
    const next = v === '' ? undefined : Math.max(0, parseInt(v, 10) || 0);
    if (next !== item.musicDuration) {
      onPatch(item.id, { musicDuration: next });
    }
  }

  async function handlePickMusic() {
    setMusicError(null);
    const err = await onPickMusic(item.id);
    if (err) setMusicError(err);
  }

  return (
    <div className="cue-row">
      <div className={`cue ${editing ? 'cue--editing' : ''}`}>
        <div className="cue__rail" />
        <div className="cue__handle" aria-hidden="true">
          <Icon name="drag" size={14} />
        </div>
        <div className="cue__time">
          {editing ? (
            <input
              className="cue__edit-input cue__edit-input--time"
              value={editTime}
              onChange={(e) => setEditTime(e.target.value)}
              aria-label="Edit time"
            />
          ) : (
            <>
              <span>{item.time || '—'}</span>
              {durationText && <span className="cue__time-sub">{durationText}</span>}
            </>
          )}
        </div>
        <div className="cue__body">
          {editing ? (
            <div className="cue__edit-fields">
              <input
                className="cue__edit-input"
                value={editDesc}
                onChange={(e) => setEditDesc(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveEdit();
                  if (e.key === 'Escape') setEditing(false);
                }}
                autoFocus
                aria-label="Edit segment"
                placeholder="Segment"
              />
              <input
                className="cue__edit-input cue__edit-input--perf"
                value={editPerformer}
                onChange={(e) => setEditPerformer(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveEdit();
                  if (e.key === 'Escape') setEditing(false);
                }}
                aria-label="Who's on stage"
                placeholder="On stage"
              />
              {performers.length > 0 && (
                <select
                  className="section-field__select cue__edit-input--perfsel"
                  value={editPerformerId}
                  onChange={(e) => {
                    const id = e.target.value;
                    const perf = id ? performers.find((p) => p.id === id) : null;
                    setEditPerformerId(id);
                    if (perf) setEditPerformer(perf.name);
                  }}
                  aria-label="Attach a performer"
                >
                  <option value="">Attach performer…</option>
                  {performers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}{p.walkOnMusic ? ' (walk-on)' : ''}
                    </option>
                  ))}
                </select>
              )}
              <input
                className="cue__edit-input cue__edit-input--len"
                type="number"
                min="0"
                step="1"
                value={editLength}
                onChange={(e) => setEditLength(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveEdit();
                  if (e.key === 'Escape') setEditing(false);
                }}
                aria-label="Segment length in minutes"
                placeholder="Min"
              />
            </div>
          ) : (
            <>
              <p className="cue__title">
                {item.description}
                {item.performer && <span className="cue__perf">{item.performer}</span>}
              </p>
              {musicLabel && (
                <p className="cue__sub">
                  <span className="cue__music-tag">
                    <Icon name="music" size={11} /> {musicLabel}
                    {item.musicDuration ? ` · ${item.musicDuration}s` : ''}
                  </span>
                </p>
              )}
            </>
          )}
        </div>
        <div className="cue__menu" style={{ display: 'flex', gap: 2 }}>
          {editing ? (
            <>
              <button className="icon-btn icon-btn--ghost" onClick={saveEdit} aria-label="Save">
                <Icon name="check" size={16} />
              </button>
              <button className="icon-btn icon-btn--ghost" onClick={() => setEditing(false)} aria-label="Cancel">
                <Icon name="x" size={16} />
              </button>
            </>
          ) : (
            <>
              <button className="icon-btn icon-btn--ghost" onClick={() => onMove(idx, -1)} disabled={isFirst} aria-label="Move up" title="Move up">
                <span aria-hidden style={{ fontSize: 14, fontWeight: 700 }}>↑</span>
              </button>
              <button className="icon-btn icon-btn--ghost" onClick={() => onMove(idx, 1)} disabled={isLast} aria-label="Move down" title="Move down">
                <span aria-hidden style={{ fontSize: 14, fontWeight: 700 }}>↓</span>
              </button>
              <button
                className={`icon-btn icon-btn--ghost ${mediaOpen || musicLabel ? 'icon-btn--active' : ''}`}
                onClick={() => { setMusicError(null); setMediaOpen((v) => !v); }}
                aria-label="Segment audio"
                title="Add segment audio (plays at the start of this cue)"
                style={musicLabel ? { color: 'var(--primary)' } : undefined}
              >
                <Icon name="music" size={14} />
              </button>
              <button className="icon-btn icon-btn--ghost" onClick={startEdit} aria-label="Edit" title="Edit">
                <Icon name="edit" size={14} />
              </button>
              <button className="icon-btn icon-btn--ghost" onClick={() => onDelete(item.id)} aria-label="Delete" title="Delete" style={{ color: 'var(--danger)' }}>
                <Icon name="x" size={14} />
              </button>
            </>
          )}
        </div>
      </div>

      {mediaOpen && !editing && (
        <div className="cue-media">
          <div className="cue-media__field">
            <label className="cue-media__label">Transition / intro music</label>
            {item.music ? (
              <div className="cue-media__music">
                <span className="cue-media__music-name"><Icon name="music" size={12} /> {item.musicName || 'Uploaded track'}</span>
                <button className="btn btn--ghost btn--sm" onClick={handlePickMusic}>Replace</button>
                <button className="btn btn--ghost btn--sm" onClick={() => onPatch(item.id, { music: undefined, musicName: undefined })}>Remove</button>
              </div>
            ) : (
              <div className="cue-media__music">
                {musicLabel ? (
                  <span className="cue-media__music-name">{musicLabel}</span>
                ) : (
                  <span className="cue-media__hint">Uses the comic's walk-on, or upload a track.</span>
                )}
                <button className="btn btn--secondary btn--sm" onClick={handlePickMusic}>Upload music</button>
              </div>
            )}
          </div>

          <div className="cue-media__field cue-media__field--duration">
            <label className="cue-media__label">Play for (seconds)</label>
            <input
              className="section-field__input"
              type="number"
              min="0"
              step="1"
              value={musicDurDraft}
              onChange={(e) => setMusicDurDraft(e.target.value)}
              onBlur={commitMusicDuration}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
              }}
              placeholder="full track"
            />
          </div>

          {musicError && <p className="cue-media__error">{musicError}</p>}
        </div>
      )}
    </div>
  );
});

export function ScheduleSection({
  schedule,
  scheduleImage,
  showName,
  performers = [],
  onChange,
  onImageChange,
}: ScheduleSectionProps) {
  const initialMode: ScheduleMode = schedule.length > 0 ? 'build' : scheduleImage ? 'upload' : 'choose';
  const [mode, setMode] = useState<ScheduleMode>(initialMode);
  const [time, setTime] = useState('');
  const [desc, setDesc] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [refOpen, setRefOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Keep latest schedule + onChange in refs so the per-row callbacks
  // can be referentially stable (which lets React.memo skip non-editing rows).
  const scheduleRef = useRef(schedule);
  const onChangeRef = useRef(onChange);
  useEffect(() => { scheduleRef.current = schedule; }, [schedule]);
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);

  const totalLabel = useMemo(() => totalRuntimeLabel(schedule), [schedule]);

  function addItem() {
    if (!desc.trim()) return;
    onChange([...schedule, { id: generateId(), time: time.trim(), description: desc.trim() }]);
    setTime('');
    setDesc('');
  }

  const handlePatch = useCallback((id: string, patch: Partial<ScheduleItem>) => {
    onChangeRef.current(scheduleRef.current.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }, []);

  const handleDelete = useCallback((id: string) => {
    const item = scheduleRef.current.find((s) => s.id === id);
    if (window.confirm(`Delete schedule item "${item?.description}"?`)) {
      onChangeRef.current(scheduleRef.current.filter((s) => s.id !== id));
    }
  }, []);

  const handleMove = useCallback((idx: number, dir: -1 | 1) => {
    const arr = [...scheduleRef.current];
    const j = idx + dir;
    if (j < 0 || j >= arr.length) return;
    [arr[idx], arr[j]] = [arr[j], arr[idx]];
    onChangeRef.current(arr);
  }, []);

  const handlePickMusic = useCallback(async (id: string): Promise<string | null> => {
    const file = await pickFile('audio/*');
    if (!file) return null;
    const err = embedSizeError(file, 'audio file');
    if (err) return err;
    try {
      const data = await readFileAsDataURL(file);
      onChangeRef.current(scheduleRef.current.map((s) => (s.id === id ? { ...s, music: data, musicName: file.name } : s)));
      return null;
    } catch {
      return 'Could not read that file. Please try again.';
    }
  }, []);

  function clearAll() {
    if (schedule.length === 0) return;
    if (window.confirm(`Delete all ${schedule.length} cues and start over? This can't be undone.`)) {
      onChange([]);
    }
  }

  function handleFileUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      onImageChange(reader.result as string);
    };
    reader.readAsDataURL(file);
    event.target.value = '';
  }

  function goBuild() {
    setMode('build');
  }

  function removeImage() {
    onImageChange(undefined);
    setMode('build');
  }

  function handleSwitchToUpload() {
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
            <span className="schedule-choice__icon"><Icon name="edit" size={20} /></span>
            <span className="schedule-choice__label">Build Your Own</span>
            <span className="schedule-choice__desc">Create the show run manually</span>
          </button>
          <button className="schedule-choice__option" onClick={() => setImportOpen(true)}>
            <span className="schedule-choice__icon"><Icon name="sparkle" size={20} /></span>
            <span className="schedule-choice__label">Import with AI</span>
            <span className="schedule-choice__desc">Photo, PDF, or paste — AI extracts cues</span>
          </button>
          <button className="schedule-choice__option" onClick={() => setMode('upload')}>
            <span className="schedule-choice__icon"><Icon name="file" size={20} /></span>
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
            {schedule.length > 0 && (
              <button
                className="btn btn--ghost btn--sm schedule-summary__clear"
                onClick={clearAll}
                title="Delete every cue and start over"
              >
                Clear all
              </button>
            )}
          </div>

          {scheduleImage && (
            <div className="schedule-ref">
              <div className="schedule-ref__header">
                <button className="schedule-ref__toggle" onClick={() => setRefOpen((v) => !v)}>
                  <Icon name="file" size={14} />
                  Uploaded reference
                  <span className="schedule-ref__chevron">{refOpen ? '▲' : '▼'}</span>
                </button>
                <div className="schedule-ref__actions">
                  <button className="btn btn--ghost btn--sm" onClick={() => fileInputRef.current?.click()}>Replace</button>
                  <button className="btn btn--ghost btn--sm" onClick={removeImage}>Remove file</button>
                </div>
              </div>
              {refOpen && (
                scheduleImage.startsWith('data:application/pdf') ? (
                  <embed src={scheduleImage} type="application/pdf" className="schedule-image-fallback__pdf" />
                ) : (
                  <img src={scheduleImage} alt="Uploaded show run" className="schedule-image-fallback__img" />
                )
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,image/*"
                onChange={handleFileUpload}
                className="schedule-upload__file-input"
              />
            </div>
          )}

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
              {schedule.map((item, idx) => (
                <CueRow
                  key={item.id}
                  item={item}
                  idx={idx}
                  isFirst={idx === 0}
                  isLast={idx === schedule.length - 1}
                  durationText={durationLabel(schedule, idx)}
                  musicLabel={cueMusicLabelFor(item, performers)}
                  performers={performers}
                  onPatch={handlePatch}
                  onDelete={handleDelete}
                  onMove={handleMove}
                  onPickMusic={handlePickMusic}
                />
              ))}
            </div>
          )}

          {!scheduleImage && (
            <button
              className="btn btn--ghost btn--sm"
              style={{ marginTop: 12 }}
              onClick={handleSwitchToUpload}
            >
              Attach a reference file (PDF / image)
            </button>
          )}
        </>
      )}

      {mode === 'upload' && (
        <>
          {scheduleImage ? (
            <div className="schedule-image-fallback">
              <div className="schedule-image-fallback__header">
                <span className="schedule-image-fallback__badge">Uploaded Show Run</span>
                <button
                  className="btn btn--ghost btn--sm"
                  onClick={() => fileInputRef.current?.click()}
                  title="Replace with a different file"
                >
                  Replace
                </button>
                <button
                  className="btn btn--ghost btn--sm"
                  onClick={removeImage}
                  title="Remove file"
                >
                  × Remove
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

          {scheduleImage && (
            <div className="schedule-upload__cta">
              <p className="schedule-upload__cta-text">
                Want to edit it? Turn it into an editable run-of-show — the file stays attached as a reference.
              </p>
              <div className="schedule-upload__cta-row">
                <button className="btn btn--primary btn--sm" onClick={() => setImportOpen(true)}>
                  Extract cues with AI
                </button>
                <button className="btn btn--secondary btn--sm" onClick={goBuild}>
                  Build / edit cues manually
                </button>
              </div>
            </div>
          )}

          <button
            className="btn btn--ghost btn--sm"
            style={{ marginTop: 12 }}
            onClick={goBuild}
          >
            {scheduleImage ? 'Back to builder' : 'Switch to build your own instead'}
          </button>
        </>
      )}

      {importOpen && (
        <Suspense fallback={null}>
          <AIImportFlow
            showName={showName || 'Show'}
            onClose={() => setImportOpen(false)}
            onApply={handleApplyImport}
          />
        </Suspense>
      )}
    </div>
  );
}

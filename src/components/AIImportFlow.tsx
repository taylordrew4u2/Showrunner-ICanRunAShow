import { useEffect, useRef, useState } from 'react';
import type { ScheduleItem } from '../types';
import { generateId } from '../utils/id';
import { importScheduleFromFile, parseScheduleManually } from '../utils/aiExtractor';
import { Icon } from './Icon';

type Step = 'pick' | 'paste' | 'processing' | 'review';
type Source = 'photo' | 'pdf' | 'paste';

interface AIImportFlowProps {
  showName: string;
  onClose: () => void;
  onApply: (items: ScheduleItem[]) => void;
}

interface ReviewItem extends ScheduleItem {
  selected: boolean;
}

const AI_STEPS = [
  { label: 'Reading file', subFor: { photo: 'Vision · OCR fallback', pdf: 'PDF.js extract', paste: 'Text parse' } },
  { label: 'Detecting times', sub: '12h / 24h / informal' },
  { label: 'Parsing cues', sub: 'Names · descriptions' },
  { label: 'Final pass', sub: 'Review & dedupe' },
] as const;

export function AIImportFlow({ showName, onClose, onApply }: AIImportFlowProps) {
  const [step, setStep] = useState<Step>('pick');
  const [source, setSource] = useState<Source | null>(null);
  const [pasted, setPasted] = useState(
    'Doors 7:30 PM\n8:00 PM Maya welcome\n8:05 PM Devon Park\n8:20 PM June Ito\n8:35 PM Marisol — headliner\n8:55 PM Intermission / DJ\n9:05 PM closers\n9:30 PM outro',
  );
  const [progress, setProgress] = useState(0);
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingFileRef = useRef<File | null>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  function startWithFile(src: 'photo' | 'pdf') {
    setSource(src);
    setError(null);
    if (!fileInputRef.current) return;
    fileInputRef.current.accept = src === 'photo' ? 'image/*' : '.pdf,application/pdf';
    fileInputRef.current.value = '';
    fileInputRef.current.click();
  }

  async function handleFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    pendingFileRef.current = file;
    setStep('processing');
    runProgress();
    try {
      const extracted = await importScheduleFromFile(file);
      finalizeExtraction(extracted);
    } catch (err) {
      finalizeExtraction([], err instanceof Error ? err.message : 'Failed to import');
    }
  }

  async function startPaste() {
    setSource('paste');
    setError(null);
    setStep('processing');
    runProgress();
    try {
      const items = parseScheduleManually(pasted);
      if (items.length === 0) {
        finalizeExtraction([], 'No times found in the pasted text. Add lines like "8:00 PM Welcome".');
      } else {
        finalizeExtraction(items);
      }
    } catch (err) {
      finalizeExtraction([], err instanceof Error ? err.message : 'Failed to parse text');
    }
  }

  function runProgress() {
    setProgress(0);
    const start = Date.now();
    const tick = () => {
      if (cancelledRef.current) return;
      const elapsed = Date.now() - start;
      const target = Math.min(92, Math.floor((elapsed / 4000) * 100));
      setProgress((current) => (current >= target ? current : target));
      if (target < 92) {
        window.setTimeout(tick, 220);
      }
    };
    window.setTimeout(tick, 220);
  }

  function finalizeExtraction(extracted: ScheduleItem[], errMsg?: string) {
    if (cancelledRef.current) return;
    setProgress(100);
    if (errMsg) {
      setError(errMsg);
      setStep('pick');
      return;
    }
    setItems(extracted.map((i) => ({ ...i, selected: true })));
    window.setTimeout(() => {
      if (!cancelledRef.current) setStep('review');
    }, 280);
  }

  function toggle(id: string) {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, selected: !i.selected } : i)));
  }

  function selectAll() {
    setItems((prev) => prev.map((i) => ({ ...i, selected: true })));
  }

  function apply() {
    const picked = items
      .filter((i) => i.selected)
      .map((i) => ({ id: i.id || generateId(), time: i.time, description: i.description }));
    onApply(picked);
  }

  const selectedCount = items.filter((i) => i.selected).length;
  const aiStepProgress = Math.min(AI_STEPS.length - 1, Math.floor((progress / 100) * AI_STEPS.length));

  return (
    <div className="sheet-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet__handle" />
        <div className="import-header">
          <div>
            <h2 className="import-header__title">
              <Icon name="sparkle" size={18} />
              Import with AI
            </h2>
            <div className="import-header__sub">{showName} · Schedule</div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {step === 'review' && (
              <button className="btn btn--primary btn--sm" onClick={apply} disabled={selectedCount === 0}>
                Add {selectedCount}
              </button>
            )}
            <button className="icon-btn icon-btn--ghost" onClick={onClose} aria-label="Close">
              <Icon name="x" size={18} />
            </button>
          </div>
        </div>

        {error && step === 'pick' && <div className="import-error">{error}</div>}

        {step === 'pick' && (
          <>
            <div className="import-banner">
              <div className="import-banner__title">
                <Icon name="sparkle" size={16} />
                How it works
              </div>
              <p className="import-banner__body">
                Snap a photo of a printed run-of-show, drop a PDF, or paste from email. AI extracts every cue with
                times — review before adding.
              </p>
            </div>

            <div className="stack">
              <button className="import-pick-card" onClick={() => startWithFile('photo')}>
                <span className="import-pick-card__icon"><Icon name="camera" size={18} /></span>
                <div className="import-pick-card__body">
                  <div className="import-pick-card__title">Photo or screenshot</div>
                  <div className="import-pick-card__sub">Printed run, whiteboard, email screenshot</div>
                </div>
                <Icon name="chevron-right" size={16} style={{ color: 'var(--text-soft)' }} />
              </button>
              <button className="import-pick-card" onClick={() => startWithFile('pdf')}>
                <span className="import-pick-card__icon"><Icon name="file" size={18} /></span>
                <div className="import-pick-card__body">
                  <div className="import-pick-card__title">Upload a PDF</div>
                  <div className="import-pick-card__sub">Multi-page, full text extraction</div>
                </div>
                <Icon name="chevron-right" size={16} style={{ color: 'var(--text-soft)' }} />
              </button>
              <button className="import-pick-card" onClick={() => setStep('paste')}>
                <span className="import-pick-card__icon"><Icon name="edit" size={18} /></span>
                <div className="import-pick-card__body">
                  <div className="import-pick-card__title">Paste text</div>
                  <div className="import-pick-card__sub">From email, Notes, or anywhere</div>
                </div>
                <Icon name="chevron-right" size={16} style={{ color: 'var(--text-soft)' }} />
              </button>
            </div>

            <p style={{ fontSize: 11, color: 'var(--text-soft)', textAlign: 'center', marginTop: 16 }}>
              Falls back to local parsing if AI is unavailable.
            </p>

            <input
              ref={fileInputRef}
              type="file"
              onChange={handleFilePicked}
              style={{ display: 'none' }}
            />
          </>
        )}

        {step === 'paste' && (
          <>
            <div className="section-header" style={{ marginTop: 4 }}>
              <h3 className="section-header__title">Paste your run-of-show</h3>
              <button className="section-header__action" onClick={() => setStep('pick')}>Back</button>
            </div>
            <textarea
              className="import-paste"
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
            />
            <button
              className="btn btn--primary btn--block"
              style={{ marginTop: 10 }}
              onClick={startPaste}
              disabled={!pasted.trim()}
            >
              <Icon name="sparkle" size={14} />
              <span style={{ marginLeft: 6 }}>Extract cues</span>
            </button>
          </>
        )}

        {step === 'processing' && (
          <>
            <div className="import-progress-card">
              <div className="import-progress-card__label">
                {source === 'photo' ? 'Reading photo' : source === 'pdf' ? 'Reading PDF' : 'Parsing text'}
              </div>
              <div className="import-progress-card__pct">{Math.floor(progress)}%</div>
              <div className="import-progress-bar">
                <div className="import-progress-bar__fill" style={{ width: `${progress}%` }} />
              </div>
            </div>
            <div className="stack">
              {AI_STEPS.map((s, i) => {
                const sub = 'subFor' in s ? s.subFor[source ?? 'paste'] : s.sub;
                return (
                  <div
                    key={s.label}
                    className={`import-step ${
                      i < aiStepProgress ? 'import-step--done' : i === aiStepProgress ? 'import-step--active' : ''
                    }`}
                  >
                    <span className="import-step__dot">
                      {i < aiStepProgress ? <Icon name="check" size={12} /> : i + 1}
                    </span>
                    <span className="import-step__label">{s.label}</span>
                    <span className="import-step__sub">{sub}</span>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {step === 'review' && (
          <>
            <div className="schedule-summary" style={{ marginTop: 4 }}>
              <div>
                <div className="schedule-summary__label">Found {items.length} cues</div>
                <div className="schedule-summary__meta">
                  {selectedCount} selected · uncheck any to skip
                </div>
              </div>
              <button className="btn btn--ghost btn--sm" onClick={selectAll}>All</button>
            </div>
            {items.length === 0 ? (
              <p className="muted" style={{ fontSize: 13, padding: '20px 4px' }}>
                No cues were extracted. Try a different source.
              </p>
            ) : (
              <div className="stack">
                {items.map((i) => (
                  <button
                    key={i.id}
                    className={`review-row ${i.selected ? 'review-row--checked' : ''}`}
                    onClick={() => toggle(i.id)}
                  >
                    <span className="review-row__check">
                      {i.selected && <Icon name="check" size={12} />}
                    </span>
                    <span className="review-row__time">{i.time || '—'}</span>
                    <div className="review-row__body">
                      <div className="review-row__desc">{i.description}</div>
                    </div>
                    <span style={{ color: 'var(--text-soft)' }}><Icon name="edit" size={14} /></span>
                  </button>
                ))}
              </div>
            )}
            <div
              className="import-banner"
              style={{ background: 'var(--surface-strong)', color: 'var(--text-muted)', marginTop: 14, padding: '10px 14px', fontSize: 12 }}
            >
              <strong style={{ color: 'var(--text)' }}>Tip:</strong>&nbsp;You can edit times and descriptions inline once cues are added to your schedule.
            </div>
          </>
        )}
      </div>
    </div>
  );
}

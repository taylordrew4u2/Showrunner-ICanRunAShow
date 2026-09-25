import { useEffect, useRef, useState } from 'react';
import type { Performer, PotentialComic, ScheduleItem } from '../types';
import { generateId } from '../utils/id';
import { importScheduleFromFile, parseScheduleManually } from '../utils/aiExtractor';
import { withMatchedPerformers } from '../utils/cuePerformer';
import { Icon } from './Icon';
import { OnStagePicker } from './OnStagePicker';

type Step = 'pick' | 'paste' | 'processing' | 'review';
type Source = 'photo' | 'pdf' | 'paste';

interface AIImportFlowProps {
  showName: string;
  /** This show's bill, so a cue can be attached while it's being reviewed. */
  performers?: Performer[];
  /** Everyone on file who isn't on this show's bill yet. */
  unbookedComics?: PotentialComic[];
  /** Who's hosting — usually the busiest name on an imported run sheet. */
  host?: string;
  onBookPerformer?: (comic: PotentialComic) => Performer;
  /**
   * Everyone the app knows by name. A run sheet writes people into the cue
   * text ("Alex welcome", "Taylor — closer"), and matching them here means
   * the review screen shows who it worked out rather than a column of blanks
   * that only fills in after you've committed to the import.
   */
  knownNames?: string[];
  onClose: () => void;
  onApply: (items: ScheduleItem[]) => void;
}

interface ReviewItem extends ScheduleItem {
  selected: boolean;
}

const AI_STEPS = [
  { label: 'Reading file', subFor: { photo: 'On-device OCR', pdf: 'PDF text', paste: 'Text parse' } },
  { label: 'Detecting times', sub: '12h / 24h / informal' },
  { label: 'Parsing cues', sub: 'Names · descriptions' },
  { label: 'Final pass', sub: 'Review & dedupe' },
] as const;

export function AIImportFlow({
  showName,
  performers = [],
  unbookedComics = [],
  host,
  onBookPerformer,
  knownNames = [],
  onClose,
  onApply,
}: AIImportFlowProps) {
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
  const sheetRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    // Cleared on the way in, not only set on the way out: StrictMode runs
    // this cleanup once on a dev mount, and a flag that only ever went true
    // left every import in `npm run dev` sitting at 0% for good.
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  useEffect(() => {
    // Take the keyboard in with the sheet, and hand it back when the sheet
    // goes. Opened with a keyboard, focus otherwise stayed on the import
    // button under the backdrop and Tab walked the dimmed Schedule section
    // before it ever reached Close.
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => {
      if (previous?.isConnected) previous.focus();
    };
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      // A dialog opened over this one answers to Escape first.
      const above = document.activeElement?.closest('[role="dialog"]');
      if (above && above !== sheetRef.current) return;
      e.stopPropagation();
      onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

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
    // Match names out of the cue text before showing the review, not after it.
    // The same pass runs on apply either way, so this changes nothing about
    // what gets added — it changes whether you can see it and correct it while
    // the screen is still asking you to check the import.
    setItems(withMatchedPerformers(extracted, knownNames).map((i) => ({ ...i, selected: true })));
    window.setTimeout(() => {
      if (!cancelledRef.current) setStep('review');
    }, 280);
  }

  function toggle(id: string) {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, selected: !i.selected } : i)));
  }

  function editItem(id: string, patch: Partial<ReviewItem>) {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  }

  function removeRow(id: string) {
    setItems((prev) => prev.filter((i) => i.id !== id));
  }

  function addRow() {
    setItems((prev) => [
      ...prev,
      { id: generateId(), time: '', description: '', performer: '', selected: true },
    ]);
  }

  function selectAll() {
    setItems((prev) => prev.map((i) => ({ ...i, selected: true })));
  }

  function apply() {
    const picked = items
      .filter((i) => i.selected && (i.description.trim() || i.time.trim() || (i.performer ?? '').trim()))
      // Carry the whole cue, minus the review screen's own checkbox. This used
      // to name the four fields it kept, which silently dropped everything the
      // extractor had worked out beyond them — above all durationMin, so a run
      // sheet that plainly said "15 min set" arrived with no length on it and
      // the AI's segment timings never reached a single show.
      .map((i) => {
        const cue: ReviewItem = {
          ...i,
          id: i.id || generateId(),
          time: i.time.trim(),
          description: i.description.trim(),
          performer: (i.performer ?? '').trim() || undefined,
        };
        delete (cue as Partial<ReviewItem>).selected;
        return cue as ScheduleItem;
      });
    onApply(picked);
  }

  const selectedCount = items.filter((i) => i.selected).length;
  const aiStepProgress = Math.min(AI_STEPS.length - 1, Math.floor((progress / 100) * AI_STEPS.length));

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      {/* The sheet is the dialog, not the backdrop: a tap on the backdrop
          closes it, and a screen reader had been announcing the close
          target as the thing that was open. */}
      <div
        ref={sheetRef}
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-import-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet__handle" />
        <div className="import-header">
          <div>
            <h2 className="import-header__title" id="ai-import-title">
              <Icon name="sparkle" size={18} />
              Import a schedule
            </h2>
            <div className="import-header__sub">{showName} · Schedule</div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {step === 'review' && (
              <button className="btn btn--primary btn--sm" onClick={apply} disabled={selectedCount === 0}>
                Add {selectedCount}
              </button>
            )}
            <button ref={closeRef} className="icon-btn icon-btn--ghost" onClick={onClose} aria-label="Close">
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
                Snap a photo of a printed run-of-show, drop a PDF, or paste from email. Times, names and
                lengths are read right here on your device — review before adding. Nothing is sent anywhere,
                and there is no account or key to add.
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

            <input
              ref={fileInputRef}
              type="file"
              onChange={handleFilePicked}
              aria-label="Schedule file"
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
              aria-label="Pasted schedule"
            />
            <button
              className="btn btn--primary btn--block"
              style={{ marginTop: 10 }}
              onClick={startPaste}
              disabled={!pasted.trim()}
            >
              <Icon name="sparkle" size={14} />
              <span style={{ marginLeft: 6 }}>Read cues</span>
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
                No cues were extracted. Add rows below, or go back and try a different source.
              </p>
            ) : (
              <div className="stack">
                {items.map((i) => (
                  <div
                    key={i.id}
                    className={`review-edit ${i.selected ? '' : 'review-edit--off'}`}
                  >
                    <button
                      className="review-edit__check"
                      onClick={() => toggle(i.id)}
                      aria-label={i.selected ? 'Exclude cue' : 'Include cue'}
                      title={i.selected ? 'Excluded from add' : 'Included'}
                    >
                      {i.selected && <Icon name="check" size={12} />}
                    </button>
                    <div className="review-edit__fields">
                      <input
                        className="review-edit__time"
                        value={i.time}
                        onChange={(e) => editItem(i.id, { time: e.target.value })}
                        placeholder="Time"
                        aria-label="Time"
                      />
                      <input
                        className="review-edit__desc"
                        value={i.description}
                        onChange={(e) => editItem(i.id, { description: e.target.value })}
                        placeholder="Segment"
                        aria-label="Segment"
                      />
                      {/* The same control as the cue editor. This was a bare
                          text box, so an import — the one place a whole show
                          arrives at once — was the one place you couldn't
                          pick anybody, and every name had to be re-typed
                          exactly right to reach Run Show. */}
                      <OnStagePicker
                        value={{ performer: i.performer, performerId: i.performerId }}
                        performers={performers}
                        unbookedComics={unbookedComics}
                        host={host}
                        onBookPerformer={onBookPerformer}
                        onChange={(next) => editItem(i.id, next)}
                        selectClassName="section-field__select review-edit__perfsel"
                        inputClassName="review-edit__perf"
                      />
                    </div>
                    <button
                      className="review-edit__del"
                      onClick={() => removeRow(i.id)}
                      aria-label="Remove cue"
                      title="Remove"
                    >
                      <Icon name="x" size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <button className="btn btn--ghost btn--sm" style={{ marginTop: 10 }} onClick={addRow}>
              <Icon name="plus" size={14} />
              <span style={{ marginLeft: 6 }}>Add a cue</span>
            </button>
            <div
              className="import-banner"
              style={{ background: 'var(--surface-strong)', color: 'var(--text-muted)', marginTop: 14, padding: '10px 14px', fontSize: 12 }}
            >
              <strong style={{ color: 'var(--text)' }}>Tip:</strong>&nbsp;Fix the time, segment, and who's on stage here before adding. Photo reads can be rough — pasting the text gives the cleanest result.
            </div>
          </>
        )}
      </div>
    </div>
  );
}

import { useState } from 'react';
import type { ScheduleItem, ScheduleTemplate, ScheduleTemplateItem } from '../types';
import { toTemplateItems } from '../utils/scheduleTemplates';
import { Modal } from './Modal';
import { useConfirm } from './useConfirm';
import './ScheduleTemplates.css';

interface ScheduleTemplatesProps {
  /** The show's current run-of-show, offered for saving. */
  schedule: ScheduleItem[];
  templates: ScheduleTemplate[];
  onClose: () => void;
  onSave: (name: string, items: ScheduleTemplateItem[]) => void;
  onDelete: (id: string) => void;
  /** Replaces or appends, already resolved by the caller. */
  onApply: (items: ScheduleTemplateItem[], mode: 'replace' | 'append') => void;
}

function cueCount(n: number): string {
  return `${n} cue${n === 1 ? '' : 's'}`;
}

export function ScheduleTemplates({
  schedule,
  templates,
  onClose,
  onSave,
  onDelete,
  onApply,
}: ScheduleTemplatesProps) {
  const { confirm, confirmDialog } = useConfirm();
  const [name, setName] = useState('');
  const [justSaved, setJustSaved] = useState<string | null>(null);
  // When the show already has cues, applying a template is a choice rather than
  // an action, so the row expands to ask instead of silently overwriting work.
  const [pending, setPending] = useState<ScheduleTemplate | null>(null);

  function handleSave() {
    const trimmed = name.trim();
    if (!trimmed || schedule.length === 0) return;
    onSave(trimmed, toTemplateItems(schedule));
    setName('');
    setJustSaved(trimmed);
    setTimeout(() => setJustSaved(null), 2500);
  }

  function handleUse(template: ScheduleTemplate) {
    if (schedule.length === 0) {
      onApply(template.items, 'replace');
      onClose();
      return;
    }
    setPending(template);
  }

  function applyPending(mode: 'replace' | 'append') {
    if (!pending) return;
    onApply(pending.items, mode);
    onClose();
  }

  return (
    <Modal onClose={onClose} labelledBy="schedule-templates-title">
      <div className="sched-templates">
        <h2 id="schedule-templates-title" className="sched-templates__title">Run-of-show templates</h2>
        <p className="sched-templates__sub">
          Save a running order once and reuse it on any show. Templates keep the times, segments,
          who's on stage, and segment lengths — uploaded audio stays with the show it belongs to.
        </p>

        <div className="sched-templates__save">
          <label className="sched-templates__label" htmlFor="template-name">
            Save this run-of-show
          </label>
          <div className="sched-templates__save-row">
            <input
              id="template-name"
              className="section-field__input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleSave();
                }
              }}
              placeholder="e.g. Standard Friday night"
              disabled={schedule.length === 0}
            />
            <button
              className="btn btn--primary"
              onClick={handleSave}
              disabled={!name.trim() || schedule.length === 0}
            >
              Save
            </button>
          </div>
          <p className="sched-templates__hint">
            {schedule.length === 0
              ? 'Add some cues first — there’s nothing to save yet.'
              : justSaved
                ? `Saved “${justSaved}”.`
                : `Saves the ${cueCount(schedule.length)} currently in this show.`}
          </p>
        </div>

        <div className="sched-templates__list-wrap">
          <p className="sched-templates__label">Your templates</p>

          {templates.length === 0 ? (
            <p className="sched-templates__empty">
              No templates yet. Save one above and it’ll be here for every future show.
            </p>
          ) : (
            <ul className="sched-templates__list">
              {templates.map((template) => (
                <li key={template.id} className="sched-templates__item">
                  <div className="sched-templates__info">
                    <span className="sched-templates__name">{template.name}</span>
                    <span className="sched-templates__meta">{cueCount(template.items.length)}</span>
                  </div>

                  {pending?.id === template.id ? (
                    <div className="sched-templates__choice">
                      <span className="sched-templates__choice-text">
                        This show already has {cueCount(schedule.length)}.
                      </span>
                      <div className="sched-templates__choice-actions">
                        <button className="btn btn--secondary btn--sm" onClick={() => applyPending('append')}>
                          Add to the end
                        </button>
                        <button className="btn btn--danger btn--sm" onClick={() => applyPending('replace')}>
                          Replace them
                        </button>
                        <button className="btn btn--ghost btn--sm" onClick={() => setPending(null)}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="sched-templates__actions">
                      <button className="btn btn--secondary btn--sm" onClick={() => handleUse(template)}>
                        Use
                      </button>
                      <button
                        className="btn btn--ghost btn--sm sched-templates__delete"
                        onClick={async () => {
                          const ok = await confirm({
                            message: `Delete the template “${template.name}”? This won't change any show that already uses it.`,
                            title: 'Delete template',
                            confirmLabel: 'Delete',
                          });
                          if (ok) onDelete(template.id);
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="sched-templates__footer">
          <button className="btn btn--ghost" onClick={onClose}>Close</button>
        </div>
        {confirmDialog}
      </div>
    </Modal>
  );
}

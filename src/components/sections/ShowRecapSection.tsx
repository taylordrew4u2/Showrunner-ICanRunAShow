import { useState, useEffect } from 'react';
import type { ShowRecap, TodoItem, Vendor } from '../../types';
import { recapMoney } from '../../utils/recapMoney';
import { formatMoney } from '../../utils/seasonReport';

interface ShowRecapSectionProps {
  recap: ShowRecap | undefined;
  /** The show's vendors, whose costs are the night's vendor spend. */
  vendors: Vendor[];
  todos: TodoItem[];
  onChange: (recap: ShowRecap) => void;
  onAddTodo: (text: string) => void;
  onToggleTodo: (todoId: string) => void;
  onDeleteTodo: (todoId: string) => void;
}

/**
 * A recap note as it is stored, or nothing for a blank one.
 *
 * Kept as typed, not trimmed. Every keystroke is saved and the saved value is
 * written back into the field, so a trimmed save took away the space after a
 * word the moment a deletion left one at the end, and the next word ran into
 * it. The PDF trims when it prints.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function storedNote(text: string): string | undefined {
  return text.trim() ? text : undefined;
}

/**
 * What a recap amount box shows once the saved figure comes back from a save.
 *
 * Every keystroke is saved and the saved number is written back into the box.
 * Rewriting it as the number put "20" in place of "20.0" the moment a cent was
 * deleted, and the next digit made it 201. So the text stays as typed while it
 * still reads as the saved number, the same way the save reads it, and only a
 * figure changed somewhere else replaces it.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function shownAmount(typed: string, saved: number | undefined): string {
  return (Number(typed) || undefined) === saved ? typed : saved?.toString() || '';
}

export function ShowRecapSection({
  recap,
  vendors,
  todos,
  onChange,
  onAddTodo,
  onToggleTodo,
  onDeleteTodo,
}: ShowRecapSectionProps) {
  const [attendance, setAttendance] = useState(recap?.attendance?.toString() || '');
  const [ticketSales, setTicketSales] = useState(recap?.ticketSales?.toString() || '');
  const [merchSales, setMerchSales] = useState(recap?.merchSales?.toString() || '');
  const [otherCosts, setOtherCosts] = useState(recap?.otherCosts?.toString() || '');
  const [performerNotes, setPerformerNotes] = useState(recap?.performerNotes || '');
  const [improvementNotes, setImprovementNotes] = useState(recap?.improvementNotes || '');
  const [newTodoText, setNewTodoText] = useState('');

  // From what is in the boxes and the vendor list as they are now, so the
  // bottom line moves with a vendor's cost as well as with a figure typed here.
  const money = recapMoney({
    ticketSales: Number(ticketSales) || undefined,
    merchSales: Number(merchSales) || undefined,
    otherCosts: Number(otherCosts) || undefined,
  }, vendors);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setAttendance((typed) => shownAmount(typed, recap?.attendance));
    setTicketSales((typed) => shownAmount(typed, recap?.ticketSales));
    setMerchSales((typed) => shownAmount(typed, recap?.merchSales));
    setOtherCosts((typed) => shownAmount(typed, recap?.otherCosts));
    setPerformerNotes(recap?.performerNotes || '');
    setImprovementNotes(recap?.improvementNotes || '');
  }, [recap?.attendance, recap?.ticketSales, recap?.merchSales, recap?.otherCosts, recap?.performerNotes, recap?.improvementNotes]);
  /* eslint-enable react-hooks/set-state-in-effect */

  function commitChanges(overrides: Partial<{ attendance: string; ticketSales: string; merchSales: string; otherCosts: string; performerNotes: string; improvementNotes: string }>) {
    const a = overrides.attendance ?? attendance;
    const t = overrides.ticketSales ?? ticketSales;
    const m = overrides.merchSales ?? merchSales;
    const o = overrides.otherCosts ?? otherCosts;
    const pn = overrides.performerNotes ?? performerNotes;
    const in_ = overrides.improvementNotes ?? improvementNotes;
    const updated: ShowRecap = {
      attendance: Number(a) || undefined,
      ticketSales: Number(t) || undefined,
      merchSales: Number(m) || undefined,
      otherCosts: Number(o) || undefined,
      performerNotes: storedNote(pn),
      improvementNotes: storedNote(in_),
    };
    updated.profitLoss = recapMoney(updated, vendors).profitLoss;
    onChange(updated);
  }

  function submitTodo() {
    if (!newTodoText.trim()) return;
    onAddTodo(newTodoText.trim());
    setNewTodoText('');
  }

  return (
    <div className="section-body">
      <div className="section-info">
        <strong>Post-Show Recap</strong>
        <p>Track attendance, sales, performer feedback, and lessons learned.</p>
      </div>

      <div className="section-form">
        <label className="section-field">
          <span className="section-field__label">Attendance</span>
          <input
            className="section-field__input"
            type="number"
            value={attendance}
            onChange={(e) => { setAttendance(e.target.value); commitChanges({ attendance: e.target.value }); }}
            placeholder="Number of attendees"
          />
        </label>

        <label className="section-field">
          <span className="section-field__label">Ticket Sales ($)</span>
          <input
            className="section-field__input"
            type="number"
            value={ticketSales}
            onChange={(e) => { setTicketSales(e.target.value); commitChanges({ ticketSales: e.target.value }); }}
            placeholder="0.00"
            step="0.01"
          />
        </label>

        <label className="section-field">
          <span className="section-field__label">Merchandise Sales ($)</span>
          <input
            className="section-field__input"
            type="number"
            value={merchSales}
            onChange={(e) => { setMerchSales(e.target.value); commitChanges({ merchSales: e.target.value }); }}
            placeholder="0.00"
            step="0.01"
          />
        </label>

        <label className="section-field">
          <span className="section-field__label">Other Costs ($)</span>
          <input
            className="section-field__input"
            type="number"
            value={otherCosts}
            onChange={(e) => { setOtherCosts(e.target.value); commitChanges({ otherCosts: e.target.value }); }}
            placeholder="Door split, performer pay, anything else"
            step="0.01"
          />
        </label>

        <div className="section-field">
          <span className="section-field__label">Financial Summary</span>
          <dl className="recap-financial">
            <div className="recap-financial__row">
              <dt>Ticket sales</dt>
              <dd>{formatMoney(money.ticketSales)}</dd>
            </div>
            <div className="recap-financial__row">
              <dt>Merch sales</dt>
              <dd>{formatMoney(money.merchSales)}</dd>
            </div>
            <div className="recap-financial__row">
              <dt>Vendors{vendors.length > 0 ? ` (${vendors.length})` : ''}</dt>
              <dd>{formatMoney(-money.vendorCosts)}</dd>
            </div>
            <div className="recap-financial__row">
              <dt>Other costs</dt>
              <dd>{formatMoney(-money.otherCosts)}</dd>
            </div>
            <div className={`recap-financial__row recap-financial__row--total${money.profitLoss < 0 ? ' recap-financial__row--loss' : ''}`}>
              <dt>Profit / loss</dt>
              <dd>{formatMoney(money.profitLoss)}</dd>
            </div>
          </dl>
          <p className="recap-financial__note">
            Vendors are added up from the Vendors section, booked or not.
          </p>
        </div>

        <div className="section-field">
          <span className="section-field__label">To-Do List</span>
          <div className="recap-todo">
            <div className="recap-todo__add">
              <input
                type="text"
                className="recap-todo__input"
                placeholder="Add a task..."
                value={newTodoText}
                onChange={(e) => setNewTodoText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submitTodo(); } }}
              />
              <button
                type="button"
                className="recap-todo__add-btn"
                onClick={submitTodo}
                disabled={!newTodoText.trim()}
              >
                Add
              </button>
            </div>
            {todos.length > 0 ? (
              <ul className="recap-todo__list">
                {todos.map((todo) => (
                  <li
                    key={todo.id}
                    className={`recap-todo__item ${todo.completed ? 'recap-todo__item--done' : ''}`}
                  >
                    <label className="recap-todo__check">
                      <input
                        type="checkbox"
                        checked={todo.completed}
                        onChange={() => onToggleTodo(todo.id)}
                      />
                      <span className="recap-todo__text">{todo.text}</span>
                    </label>
                    <button
                      type="button"
                      className="recap-todo__delete"
                      onClick={() => onDeleteTodo(todo.id)}
                      title="Remove"
                      aria-label="Remove task"
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="recap-todo__empty">No tasks yet.</p>
            )}
          </div>
        </div>

        <label className="section-field">
          <span className="section-field__label">Performer Notes</span>
          <textarea
            className="section-field__textarea"
            value={performerNotes}
            onChange={(e) => { setPerformerNotes(e.target.value); commitChanges({ performerNotes: e.target.value }); }}
            placeholder="Notes about performer quality, audience response, technical issues, etc."
            rows={4}
          />
        </label>

        <label className="section-field">
          <span className="section-field__label">Improvement Notes</span>
          <textarea
            className="section-field__textarea"
            value={improvementNotes}
            onChange={(e) => { setImprovementNotes(e.target.value); commitChanges({ improvementNotes: e.target.value }); }}
            placeholder="What should we do better next time? Lessons learned, process improvements, etc."
            rows={4}
          />
        </label>
      </div>
    </div>
  );
}

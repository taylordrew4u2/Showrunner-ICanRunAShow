import { useState } from 'react';
import type { AppSettings, Expense } from '../types';
import { EXPENSE_CATEGORIES } from '../types';
import { generateId } from '../utils/id';
import { PageHeader } from './PageHeader';
import './Expenses.css';
import { useConfirm } from './useConfirm';

interface ExpensesProps {
  settings: AppSettings;
  onBack: () => void;
  /** What the back control returns to. */
  backLabel?: string;
  onUpdateSettings: (settings: AppSettings) => void;
}

interface ExpenseDraft {
  category: string;
  itemName: string;
  cost: string;
  date: string;
  notes: string;
}

const EMPTY_DRAFT: ExpenseDraft = {
  category: EXPENSE_CATEGORIES[0],
  itemName: '',
  cost: '',
  date: '',
  notes: '',
};

export function Expenses({ settings, onBack, backLabel = 'Shows', onUpdateSettings }: ExpensesProps) {
  const { confirm, confirmDialog } = useConfirm();
  const [addDraft, setAddDraft] = useState<ExpenseDraft>(EMPTY_DRAFT);
  /**
   * Whether the add-an-expense form is showing.
   *
   * It used to sit permanently above the list: a category select, three
   * inputs, a date and a button — around 1100px of form before the first
   * expense on a phone, on a page whose job is telling you what the show
   * cost. Once there is something to show, the list leads and this folds
   * away behind a button.
   *
   * Not initial state: an empty page has nothing else to offer, so the form
   * stays open on its own until there is a first expense.
   */
  const [addingOpen, setAddingOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<ExpenseDraft>(EMPTY_DRAFT);

  // An empty page has nothing but the form, so it opens showing it; after
  // that the toggle decides.
  const showAddForm = addingOpen || (settings.expenses || []).length === 0;

  const brandBudget = settings.brandBudget || 0;
  const expenses = settings.expenses || [];
  const displayTotal = expenses.reduce((sum, e) => sum + (Number(e.cost) || 0), 0);
  const remaining = brandBudget - displayTotal;

  function addExpense() {
    if (!addDraft.itemName.trim() || !addDraft.cost) return;
    const expense: Expense = {
      id: generateId(),
      category: addDraft.category,
      itemName: addDraft.itemName.trim(),
      cost: Number(addDraft.cost) || 0,
      date: addDraft.date || undefined,
      notes: addDraft.notes.trim() || undefined,
    };
    onUpdateSettings({ ...settings, expenses: [...expenses, expense] });
    // Stay open. Adding the first expense makes the list non-empty, which
    // would otherwise fold this form away mid-flow — you are usually entering
    // a night's costs in one sitting, not one line.
    setAddingOpen(true);
    setAddDraft(EMPTY_DRAFT);
  }

  async function deleteExpense(expenseId: string) {
    const expense = expenses.find((e) => e.id === expenseId);
    if (await confirm(`Delete expense "${expense?.itemName}" ($${expense?.cost})? This cannot be undone.`)) {
      onUpdateSettings({ ...settings, expenses: expenses.filter((e) => e.id !== expenseId) });
    }
  }

  function startEdit(e: Expense) {
    setEditId(e.id);
    setEditDraft({
      category: e.category,
      itemName: e.itemName,
      cost: String(e.cost),
      date: e.date ?? '',
      notes: e.notes ?? '',
    });
  }

  function saveEdit() {
    if (!editDraft.itemName.trim() || !editId) return;
    onUpdateSettings({
      ...settings,
      expenses: expenses.map((e) =>
        e.id === editId
          ? {
              ...e,
              category: editDraft.category,
              itemName: editDraft.itemName.trim(),
              cost: Number(editDraft.cost) || 0,
              date: editDraft.date || undefined,
              notes: editDraft.notes.trim() || undefined,
            }
          : e
      ),
    });
    setEditId(null);
  }

  return (
    <div className="expenses-page">
      <PageHeader
        title="Expenses"
        subtitle="Everything you spend across all shows, tracked against your brand budget."
        onBack={onBack}
        backLabel={backLabel}
      />

      {brandBudget > 0 && (
        <div className="budget-card">
          <div className="budget-card__title">Brand Budget Tracking</div>
          <div className="budget-card__grid">
            <div className="budget-card__item">
              <div className="budget-card__label">Total Budget</div>
              <div className="budget-card__value budget-card__value--primary">${brandBudget.toFixed(2)}</div>
            </div>
            <div className="budget-card__item">
              <div className="budget-card__label">Total Spent (All Shows)</div>
              <div className="budget-card__value budget-card__value--spent">${displayTotal.toFixed(2)}</div>
            </div>
            <div className="budget-card__item">
              <div className="budget-card__label">Remaining</div>
              <div className={`budget-card__value ${remaining >= 0 ? 'budget-card__value--positive' : 'budget-card__value--negative'}`}>
                ${remaining.toFixed(2)}
              </div>
            </div>
          </div>
        </div>
      )}


      <ul className="section-list">
        {expenses.map((e) => (
          <li key={e.id} className="section-list-item">
            <div className="section-list-item__body">
              {editId === e.id ? (
                <div className="section-edit-row">
                  <select className="section-field__select" aria-label="Expense category" value={editDraft.category} onChange={(ev) => setEditDraft(d => ({ ...d, category: ev.target.value }))}>
                    {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <input className="section-field__input" value={editDraft.itemName} onChange={(ev) => setEditDraft(d => ({ ...d, itemName: ev.target.value }))} placeholder="Item" />
                  <input className="section-field__input" type="number" step="0.01" value={editDraft.cost} onChange={(ev) => setEditDraft(d => ({ ...d, cost: ev.target.value }))} placeholder="Cost" />
                  <input className="section-field__input" type="date" aria-label="Expense date" value={editDraft.date} onChange={(ev) => setEditDraft(d => ({ ...d, date: ev.target.value }))} />
                  <input className="section-field__input" value={editDraft.notes} onChange={(ev) => setEditDraft(d => ({ ...d, notes: ev.target.value }))} placeholder="Notes" />
                  <button className="btn btn--primary btn--sm" onClick={saveEdit}>Save</button>
                  <button className="btn btn--ghost btn--sm" onClick={() => setEditId(null)}>Cancel</button>
                </div>
              ) : (
                <>
                  <span className="section-list-item__badge">{e.category}</span>
                  <span className="section-list-item__name">{e.itemName}</span>
                  <span className="section-list-item__cost">${(Number(e.cost) || 0).toFixed(2)}</span>
                  {e.date && <span className="section-list-item__tag">{e.date}</span>}
                  {e.notes && <span className="section-list-item__tag">{e.notes}</span>}
                </>
              )}
            </div>
            {editId !== e.id && (
              <div className="section-list-item__actions">
                <button className="btn btn--ghost btn--sm" onClick={() => startEdit(e)}>Edit</button>
                <button className="btn btn--ghost btn--sm section-list-item__delete" onClick={() => deleteExpense(e.id)}>×</button>
              </div>
            )}
          </li>
        ))}
      </ul>

      {expenses.length > 0 && (
        <div className="section-total">
          <strong>Total:</strong> <span>${displayTotal.toFixed(2)}</span>
        </div>
      )}

      {/* The list is what this page is for, so the form sits under it rather
          than in front of it — and folds away once there is a list to read. */}
      {expenses.length > 0 && (
        <div className="lineup-add">
          <button
            type="button"
            className="btn btn--secondary btn--sm lineup-add__toggle"
            onClick={() => setAddingOpen((v) => !v)}
            aria-expanded={addingOpen}
          >
            {addingOpen ? 'Done adding' : '+ Add expense'}
          </button>
        </div>
      )}

      {showAddForm && (
      <div className="expenses-page__add">
        <h2 className="expenses-page__add-title">Add Expense</h2>
        <div className="section-add-grid">
          <select
            className="section-field__select"
            aria-label="Expense category"
            value={addDraft.category}
            onChange={(e) => setAddDraft(d => ({ ...d, category: e.target.value }))}
          >
            {EXPENSE_CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <input
            className="section-field__input"
            value={addDraft.itemName}
            onChange={(e) => setAddDraft(d => ({ ...d, itemName: e.target.value }))}
            placeholder="Item or service name"
            aria-label="Item or service name"
          />
          <input
            className="section-field__input"
            type="number"
            step="0.01"
            value={addDraft.cost}
            onChange={(e) => setAddDraft(d => ({ ...d, cost: e.target.value }))}
            placeholder="Cost ($)"
            aria-label="Cost in dollars"
          />
          <input
            className="section-field__input"
            type="date"
            aria-label="Expense date"
            value={addDraft.date}
            onChange={(e) => setAddDraft(d => ({ ...d, date: e.target.value }))}
          />
          <input
            className="section-field__input"
            value={addDraft.notes}
            onChange={(e) => setAddDraft(d => ({ ...d, notes: e.target.value }))}
            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addExpense())}
            placeholder="Notes (optional)"
            aria-label="Notes"
          />
          <button className="btn btn--primary btn--sm" onClick={addExpense}>Add</button>
        </div>
      </div>
      )}

      {/* No "No expenses yet" panel. An empty page always opens with the form
          showing, so it was a heading and a sentence telling you that the
          empty fields beside it are empty. */}
      {confirmDialog}
    </div>
  );
}

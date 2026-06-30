import { useState, useRef } from 'react';
import type { AppSettings, Expense } from '../types';
import { EXPENSE_CATEGORIES } from '../types';
import { generateId } from '../utils/id';
import './Expenses.css';

interface ExpensesProps {
  settings: AppSettings;
  onBack: () => void;
  onUpdateSettings: (settings: AppSettings) => void;
}

interface ExpenseDraft {
  category: string;
  itemName: string;
  cost: string;
  date: string;
  notes: string;
  receiptPhoto: string | undefined;
}

const EMPTY_DRAFT: ExpenseDraft = {
  category: EXPENSE_CATEGORIES[0],
  itemName: '',
  cost: '',
  date: '',
  notes: '',
  receiptPhoto: undefined,
};

export function Expenses({ settings, onBack, onUpdateSettings }: ExpensesProps) {
  const [addDraft, setAddDraft] = useState<ExpenseDraft>(EMPTY_DRAFT);
  const [editId, setEditId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<ExpenseDraft>(EMPTY_DRAFT);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const addReceiptInputRef = useRef<HTMLInputElement>(null);
  const editReceiptInputRef = useRef<HTMLInputElement>(null);

  const brandBudget = settings.brandBudget || 0;
  const expenses = settings.expenses || [];
  const displayTotal = expenses.reduce((sum, e) => sum + (Number(e.cost) || 0), 0);
  const remaining = brandBudget - displayTotal;

  function readImageFile(file: File, onDone: (dataUrl: string) => void) {
    const reader = new FileReader();
    reader.onload = () => onDone(reader.result as string);
    reader.readAsDataURL(file);
  }

  function addExpense() {
    if (!addDraft.itemName.trim() || !addDraft.cost) return;
    const expense: Expense = {
      id: generateId(),
      category: addDraft.category,
      itemName: addDraft.itemName.trim(),
      cost: Number(addDraft.cost) || 0,
      date: addDraft.date || undefined,
      notes: addDraft.notes.trim() || undefined,
      receiptPhoto: addDraft.receiptPhoto,
    };
    onUpdateSettings({ ...settings, expenses: [...expenses, expense] });
    setAddDraft(EMPTY_DRAFT);
  }

  function deleteExpense(expenseId: string) {
    const expense = expenses.find((e) => e.id === expenseId);
    if (window.confirm(`Delete expense "${expense?.itemName}" ($${expense?.cost})? This cannot be undone.`)) {
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
      receiptPhoto: e.receiptPhoto,
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
              receiptPhoto: editDraft.receiptPhoto || undefined,
            }
          : e
      ),
    });
    setEditId(null);
  }

  return (
    <div className="expenses-page">
      <div className="expenses-page__topbar">
        <button className="btn btn--ghost" onClick={onBack}>← Back</button>
        <h1 className="expenses-page__title">Expenses</h1>
      </div>

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

      <div className="expenses-page__add">
        <h2 className="expenses-page__add-title">Add Expense</h2>
        <div className="section-add-grid">
          <select
            className="section-field__select"
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
          />
          <input
            className="section-field__input"
            type="number"
            step="0.01"
            value={addDraft.cost}
            onChange={(e) => setAddDraft(d => ({ ...d, cost: e.target.value }))}
            placeholder="Cost ($)"
          />
          <input
            className="section-field__input"
            type="date"
            value={addDraft.date}
            onChange={(e) => setAddDraft(d => ({ ...d, date: e.target.value }))}
          />
          <input
            className="section-field__input"
            value={addDraft.notes}
            onChange={(e) => setAddDraft(d => ({ ...d, notes: e.target.value }))}
            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addExpense())}
            placeholder="Notes (optional)"
          />
          <input
            ref={addReceiptInputRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) readImageFile(file, (url) => setAddDraft(d => ({ ...d, receiptPhoto: url })));
              e.target.value = '';
            }}
          />
          <button
            className="btn btn--ghost btn--sm"
            title={addDraft.receiptPhoto ? 'Receipt attached — click to replace' : 'Attach receipt photo'}
            onClick={() => addReceiptInputRef.current?.click()}
          >
            Receipt
          </button>
          {addDraft.receiptPhoto && (
            <img
              src={addDraft.receiptPhoto}
              alt="receipt preview"
              className="receipt-thumb receipt-thumb--inline"
              onClick={() => setLightboxSrc(addDraft.receiptPhoto!)}
              title="Click to view full size"
            />
          )}
          <button className="btn btn--primary btn--sm" onClick={addExpense}>Add</button>
        </div>
      </div>

      {expenses.length === 0 && <p className="section-empty">No expenses yet.</p>}

      <ul className="section-list">
        {expenses.map((e) => (
          <li key={e.id} className="section-list-item">
            <div className="section-list-item__body">
              {editId === e.id ? (
                <div className="section-edit-row">
                  <select className="section-field__select" value={editDraft.category} onChange={(ev) => setEditDraft(d => ({ ...d, category: ev.target.value }))}>
                    {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <input className="section-field__input" value={editDraft.itemName} onChange={(ev) => setEditDraft(d => ({ ...d, itemName: ev.target.value }))} placeholder="Item" />
                  <input className="section-field__input" type="number" step="0.01" value={editDraft.cost} onChange={(ev) => setEditDraft(d => ({ ...d, cost: ev.target.value }))} placeholder="Cost" />
                  <input className="section-field__input" type="date" value={editDraft.date} onChange={(ev) => setEditDraft(d => ({ ...d, date: ev.target.value }))} />
                  <input className="section-field__input" value={editDraft.notes} onChange={(ev) => setEditDraft(d => ({ ...d, notes: ev.target.value }))} placeholder="Notes" />
                  <input
                    ref={editReceiptInputRef}
                    type="file"
                    accept="image/*"
                    style={{ display: 'none' }}
                    onChange={(ev) => {
                      const file = ev.target.files?.[0];
                      if (file) readImageFile(file, (url) => setEditDraft(d => ({ ...d, receiptPhoto: url })));
                      ev.target.value = '';
                    }}
                  />
                  <button
                    className="btn btn--ghost btn--sm"
                    title={editDraft.receiptPhoto ? 'Receipt attached — click to replace' : 'Attach receipt photo'}
                    onClick={() => editReceiptInputRef.current?.click()}
                  >
                    Receipt
                  </button>
                  {editDraft.receiptPhoto && (
                    <img
                      src={editDraft.receiptPhoto}
                      alt="receipt preview"
                      className="receipt-thumb receipt-thumb--inline"
                      onClick={() => setLightboxSrc(editDraft.receiptPhoto!)}
                      title="Click to view full size"
                    />
                  )}
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
                  {e.receiptPhoto && (
                    <button
                      className="receipt-thumb-btn"
                      onClick={() => setLightboxSrc(e.receiptPhoto!)}
                      title="View receipt"
                      aria-label="View receipt photo"
                    >
                      <img src={e.receiptPhoto} className="receipt-thumb" alt="receipt" />
                    </button>
                  )}
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

      {lightboxSrc && (
        <div className="receipt-lightbox" onClick={() => setLightboxSrc(null)}>
          <img src={lightboxSrc} className="receipt-lightbox__img" alt="receipt" />
          <span className="receipt-lightbox__hint">Click anywhere to close</span>
        </div>
      )}
    </div>
  );
}

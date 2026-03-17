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

export function Expenses({ settings, onBack, onUpdateSettings }: ExpensesProps) {
  const [category, setCategory] = useState(EXPENSE_CATEGORIES[0]);
  const [itemName, setItemName] = useState('');
  const [cost, setCost] = useState('');
  const [date, setDate] = useState('');
  const [notes, setNotes] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [editCategory, setEditCategory] = useState('');
  const [editItemName, setEditItemName] = useState('');
  const [editCost, setEditCost] = useState('');
  const [editDate, setEditDate] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [editReceiptPhoto, setEditReceiptPhoto] = useState<string | undefined>(undefined);
  const [receiptPhoto, setReceiptPhoto] = useState<string | undefined>(undefined);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const addReceiptInputRef = useRef<HTMLInputElement>(null);
  const editReceiptInputRef = useRef<HTMLInputElement>(null);

  const brandBudget = settings.brandBudget || 0;
  const totalSpent = settings.totalSpent || 0;
  const remaining = brandBudget - totalSpent;

  const expenses = settings.expenses || [];
  const displayTotal = expenses.reduce((sum, e) => sum + (Number(e.cost) || 0), 0);

  function readImageFile(file: File, onDone: (dataUrl: string) => void) {
    const reader = new FileReader();
    reader.onload = () => onDone(reader.result as string);
    reader.readAsDataURL(file);
  }

  function addExpense() {
    if (!itemName.trim() || !cost) return;
    const expense: Expense = {
      id: generateId(),
      category,
      itemName: itemName.trim(),
      cost: Number(cost) || 0,
      date: date || undefined,
      notes: notes.trim() || undefined,
      receiptPhoto: receiptPhoto || undefined,
    };
    onUpdateSettings({ ...settings, expenses: [...expenses, expense] });
    setItemName('');
    setCost('');
    setDate('');
    setNotes('');
    setReceiptPhoto(undefined);
  }

  function deleteExpense(expenseId: string) {
    const expense = expenses.find((e) => e.id === expenseId);
    if (window.confirm(`Delete expense "${expense?.itemName}" ($${expense?.cost})? This cannot be undone.`)) {
      onUpdateSettings({ ...settings, expenses: expenses.filter((e) => e.id !== expenseId) });
    }
  }

  function startEdit(e: Expense) {
    setEditId(e.id);
    setEditCategory(e.category);
    setEditItemName(e.itemName);
    setEditCost(String(e.cost));
    setEditDate(e.date ?? '');
    setEditNotes(e.notes ?? '');
    setEditReceiptPhoto(e.receiptPhoto);
  }

  function saveEdit() {
    if (!editItemName.trim() || !editId) return;
    onUpdateSettings({
      ...settings,
      expenses: expenses.map((e) =>
        e.id === editId
          ? {
              ...e,
              category: editCategory,
              itemName: editItemName.trim(),
              cost: Number(editCost) || 0,
              date: editDate || undefined,
              notes: editNotes.trim() || undefined,
              receiptPhoto: editReceiptPhoto || undefined,
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
        <h2 className="expenses-page__title">💰 Expenses</h2>
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
              <div className="budget-card__value budget-card__value--spent">${totalSpent.toFixed(2)}</div>
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
        <h3 className="expenses-page__add-title">Add Expense</h3>
        <div className="section-add-grid">
          <select
            className="section-field__select"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            {EXPENSE_CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <input
            className="section-field__input"
            value={itemName}
            onChange={(e) => setItemName(e.target.value)}
            placeholder="Item or service name"
          />
          <input
            className="section-field__input"
            type="number"
            step="0.01"
            value={cost}
            onChange={(e) => setCost(e.target.value)}
            placeholder="Cost ($)"
          />
          <input
            className="section-field__input"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
          <input
            className="section-field__input"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
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
              if (file) readImageFile(file, setReceiptPhoto);
              e.target.value = '';
            }}
          />
          <button
            className="btn btn--ghost btn--sm"
            title={receiptPhoto ? 'Receipt attached — click to replace' : 'Attach receipt photo'}
            onClick={() => addReceiptInputRef.current?.click()}
          >
            📷
          </button>
          {receiptPhoto && (
            <img
              src={receiptPhoto}
              alt="receipt preview"
              className="receipt-thumb receipt-thumb--inline"
              onClick={() => setLightboxSrc(receiptPhoto)}
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
                  <select className="section-field__select" value={editCategory} onChange={(ev) => setEditCategory(ev.target.value)}>
                    {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <input className="section-field__input" value={editItemName} onChange={(ev) => setEditItemName(ev.target.value)} placeholder="Item" />
                  <input className="section-field__input" type="number" step="0.01" value={editCost} onChange={(ev) => setEditCost(ev.target.value)} placeholder="Cost" />
                  <input className="section-field__input" type="date" value={editDate} onChange={(ev) => setEditDate(ev.target.value)} />
                  <input className="section-field__input" value={editNotes} onChange={(ev) => setEditNotes(ev.target.value)} placeholder="Notes" />
                  <input
                    ref={editReceiptInputRef}
                    type="file"
                    accept="image/*"
                    style={{ display: 'none' }}
                    onChange={(ev) => {
                      const file = ev.target.files?.[0];
                      if (file) readImageFile(file, setEditReceiptPhoto);
                      ev.target.value = '';
                    }}
                  />
                  <button
                    className="btn btn--ghost btn--sm"
                    title={editReceiptPhoto ? 'Receipt attached — click to replace' : 'Attach receipt photo'}
                    onClick={() => editReceiptInputRef.current?.click()}
                  >
                    📷
                  </button>
                  {editReceiptPhoto && (
                    <img
                      src={editReceiptPhoto}
                      alt="receipt preview"
                      className="receipt-thumb receipt-thumb--inline"
                      onClick={() => setLightboxSrc(editReceiptPhoto)}
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
                      className="btn btn--ghost btn--sm receipt-thumb-btn"
                      onClick={() => setLightboxSrc(e.receiptPhoto!)}
                      title="View receipt"
                      style={{ padding: 0, border: 'none', background: 'none' }}
                    >
                      <img src={e.receiptPhoto} className="receipt-thumb" alt="receipt" />
                    </button>
                  )}
                </>
              )}
            </div>
            {editId !== e.id && (
              <div className="section-list-item__actions">
                <button className="btn btn--ghost btn--sm" onClick={() => startEdit(e)}>✏️</button>
                <button className="btn btn--ghost btn--sm section-list-item__delete" onClick={() => deleteExpense(e.id)}>✕</button>
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

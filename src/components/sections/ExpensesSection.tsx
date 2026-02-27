import { useState } from 'react';
import type { Expense, AppSettings } from '../../types';
import { EXPENSE_CATEGORIES } from '../../types';
import { generateId } from '../../utils/id';

interface ExpensesSectionProps {
  expenses: Expense[];
  settings: AppSettings;
  onChange: (expenses: Expense[]) => void;
}

export function ExpensesSection({ expenses, settings, onChange }: ExpensesSectionProps) {
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

  const total = expenses.reduce((sum, e) => sum + (Number(e.cost) || 0), 0);
  const brandBudget = settings.brandBudget || 0;
  const totalSpent = settings.totalSpent || 0;
  const remaining = brandBudget - totalSpent;

  function addExpense() {
    if (!itemName.trim() || !cost) return;
    const expense: Expense = {
      id: generateId(),
      category,
      itemName: itemName.trim(),
      cost: Number(cost) || 0,
      date: date || undefined,
      notes: notes.trim() || undefined,
    };
    onChange([...expenses, expense]);
    setItemName('');
    setCost('');
    setDate('');
    setNotes('');
  }

  function deleteExpense(id: string) {
    const expense = expenses.find((e) => e.id === id);
    if (window.confirm(`Delete expense "${expense?.itemName}" ($${expense?.cost})? This cannot be undone.`)) {
      onChange(expenses.filter((e) => e.id !== id));
    }
  }

  function startEdit(e: Expense) {
    setEditId(e.id);
    setEditCategory(e.category);
    setEditItemName(e.itemName);
    setEditCost(String(e.cost));
    setEditDate(e.date ?? '');
    setEditNotes(e.notes ?? '');
  }

  function saveEdit() {
    if (!editItemName.trim() || !editId) return;
    onChange(expenses.map((e) =>
      e.id === editId
        ? {
            ...e,
            category: editCategory,
            itemName: editItemName.trim(),
            cost: Number(editCost) || 0,
            date: editDate || undefined,
            notes: editNotes.trim() || undefined,
          }
        : e
    ));
    setEditId(null);
  }

  return (
    <div className="section-body">
      {brandBudget > 0 && (
        <div style={{ marginBottom: '16px', padding: '12px', background: '#f0f9ff', border: '1px solid #0ea5e9', borderRadius: '4px' }}>
          <div style={{ fontWeight: 'bold', marginBottom: '8px' }}>Brand Budget Tracking</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', fontSize: '14px' }}>
            <div>
              <div style={{ color: '#666' }}>Total Budget</div>
              <div style={{ fontWeight: 'bold', color: '#0ea5e9' }}>${brandBudget.toFixed(2)}</div>
            </div>
            <div>
              <div style={{ color: '#666' }}>Total Spent (All Shows)</div>
              <div style={{ fontWeight: 'bold', color: '#dc2626' }}>${totalSpent.toFixed(2)}</div>
            </div>
            <div>
              <div style={{ color: '#666' }}>Remaining</div>
              <div style={{ fontWeight: 'bold', color: remaining >= 0 ? '#16a34a' : '#dc2626' }}>
                ${remaining.toFixed(2)}
              </div>
            </div>
          </div>
        </div>
      )}
      
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
          placeholder="Notes / receipt (optional)"
        />
        <button className="btn btn--primary btn--sm" onClick={addExpense}>Add</button>
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
                <button className="btn btn--ghost btn--sm" onClick={() => startEdit(e)}>✏️</button>
                <button className="btn btn--ghost btn--sm section-list-item__delete" onClick={() => deleteExpense(e.id)}>✕</button>
              </div>
            )}
          </li>
        ))}
      </ul>

      {expenses.length > 0 && (
        <div className="section-total">
          <strong>Total Expenses:</strong> <span>${total.toFixed(2)}</span>
        </div>
      )}
    </div>
  );
}

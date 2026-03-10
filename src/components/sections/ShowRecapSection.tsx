import { useState, useEffect } from 'react';
import type { ShowRecap, Expense } from '../../types';

interface ShowRecapSectionProps {
  recap: ShowRecap | undefined;
  expenses: Expense[];
  onChange: (recap: ShowRecap) => void;
}

export function ShowRecapSection({ recap, expenses, onChange }: ShowRecapSectionProps) {
  const [attendance, setAttendance] = useState(recap?.attendance?.toString() || '');
  const [merchSales, setMerchSales] = useState(recap?.merchSales?.toString() || '');
  const [performerNotes, setPerformerNotes] = useState(recap?.performerNotes || '');
  const [improvementNotes, setImprovementNotes] = useState(recap?.improvementNotes || '');

  const totalExpenses = expenses.reduce((sum, e) => sum + e.cost, 0);
  const totalRevenue = Number(merchSales) || 0;
  const profitLoss = totalRevenue - totalExpenses;

  // Sync local state when recap prop changes from outside
  const recapKey = JSON.stringify(recap);
  useEffect(() => {
    setAttendance(recap?.attendance?.toString() || '');
    setMerchSales(recap?.merchSales?.toString() || '');
    setPerformerNotes(recap?.performerNotes || '');
    setImprovementNotes(recap?.improvementNotes || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recapKey]);

  function commitChanges(overrides: Partial<{ attendance: string; merchSales: string; performerNotes: string; improvementNotes: string }>) {
    const a = overrides.attendance ?? attendance;
    const m = overrides.merchSales ?? merchSales;
    const pn = overrides.performerNotes ?? performerNotes;
    const in_ = overrides.improvementNotes ?? improvementNotes;
    const rev = Number(m) || 0;
    const updated: ShowRecap = {
      attendance: Number(a) || undefined,
      merchSales: Number(m) || undefined,
      performerNotes: pn.trim() || undefined,
      improvementNotes: in_.trim() || undefined,
      profitLoss: rev - totalExpenses,
    };
    onChange(updated);
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

        <div className="section-field">
          <strong className="recap-financial__title">Financial Summary</strong>
          <div className="recap-financial">
            <div className="recap-financial__row">
              <span className="recap-financial__label">Total Revenue (Merch):</span>
              <span className="recap-financial__value">${totalRevenue.toFixed(2)}</span>
            </div>
            <div className="recap-financial__row">
              <span className="recap-financial__label">Total Expenses:</span>
              <span className="recap-financial__value recap-financial__value--negative">-${totalExpenses.toFixed(2)}</span>
            </div>
            <div className="recap-financial__row recap-financial__row--total">
              <span className="recap-financial__label recap-financial__label--strong">Profit/Loss:</span>
              <span className={`recap-financial__value recap-financial__value--total ${profitLoss >= 0 ? 'recap-financial__value--positive' : 'recap-financial__value--negative'}`}>
                {profitLoss >= 0 ? '+' : ''}${profitLoss.toFixed(2)}
              </span>
            </div>
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

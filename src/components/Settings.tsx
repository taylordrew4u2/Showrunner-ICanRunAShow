import { useState, useEffect } from 'react';
import type { AppSettings, Producer } from '../types';
import { generateId } from '../utils/id';
import './Settings.css';

interface SettingsProps {
  settings: AppSettings;
  onSave: (settings: AppSettings) => void;
  onBack: () => void;
  saving?: boolean;
  onRecoverShow?: (trashItemId: string) => void;
  onPermanentlyDelete?: (trashItemId: string) => void;
}

export function Settings({ settings: initialSettings, onSave, onBack, saving = false, onRecoverShow, onPermanentlyDelete }: SettingsProps) {
  const [settings, setSettings] = useState<AppSettings>(initialSettings);
  const [newProducerName, setNewProducerName] = useState('');
  const [newProducerRole, setNewProducerRole] = useState('');

  useEffect(() => {
    setSettings(initialSettings);
  }, [initialSettings]);

  function handleSave() {
    onSave(settings);
  }

  function addProducer() {
    if (!newProducerName.trim() || !newProducerRole.trim()) return;
    const producer: Producer = {
      id: generateId(),
      name: newProducerName.trim(),
      role: newProducerRole.trim(),
    };
    setSettings((s) => ({ ...s, producers: [...s.producers, producer] }));
    setNewProducerName('');
    setNewProducerRole('');
  }

  function removeProducer(id: string) {
    setSettings((s) => ({
      ...s,
      producers: s.producers.filter((p) => p.id !== id),
    }));
  }

  return (
    <div className="settings">
      <button className="btn btn--ghost" onClick={onBack}>← Back</button>
      <h2 className="settings__title">Settings</h2>

      <div className="settings__card">
        <label className="section-field">
          <span className="section-field__label">Brand Name</span>
          <input
            className="section-field__input"
            value={settings.brandName}
            onChange={(e) => setSettings((s) => ({ ...s, brandName: e.target.value }))}
            placeholder="e.g. Show Producer"
          />
        </label>

        <div className="section-field">
          <span className="section-field__label">Producers</span>
          <div className="settings__producer-block">
            {settings.producers.length === 0 && (
              <p className="settings__empty">No producers added yet.</p>
            )}
            {settings.producers.map((producer) => (
              <div key={producer.id} className="settings__producer-row">
                <div className="settings__producer-content">
                  <span className="settings__producer-name">{producer.name}</span>
                  <span className="settings__producer-role">{producer.role}</span>
                </div>
                <button
                  className="btn btn--danger btn--sm"
                  onClick={() => removeProducer(producer.id)}
                >
                  Remove
                </button>
              </div>
            ))}
            <div className="settings__producer-add">
              <input
                className="section-field__input settings__producer-input"
                value={newProducerName}
                onChange={(e) => setNewProducerName(e.target.value)}
                placeholder="Producer name"
              />
              <input
                className="section-field__input settings__producer-input"
                value={newProducerRole}
                onChange={(e) => setNewProducerRole(e.target.value)}
                placeholder="Role (e.g., Executive Producer)"
              />
              <button className="btn btn--secondary settings__producer-add-btn" onClick={addProducer}>
                Add
              </button>
            </div>
          </div>
        </div>

        <label className="section-field">
          <span className="section-field__label">Brand Budget (Starting Amount)</span>
          <input
            className="section-field__input"
            type="number"
            value={settings.brandBudget}
            onChange={(e) => setSettings((s) => ({ ...s, brandBudget: Number(e.target.value) || 0 }))}
            placeholder="0.00"
            step="0.01"
          />
          <small className="settings__budget-hint">
            Total spent across all shows: ${settings.totalSpent.toFixed(2)} | Remaining: ${(settings.brandBudget - settings.totalSpent).toFixed(2)}
          </small>
        </label>

        <label className="section-field">
          <span className="section-field__label">Rules / Notes</span>
          <textarea
            className="section-field__textarea"
            value={settings.rules}
            onChange={(e) => setSettings((s) => ({ ...s, rules: e.target.value }))}
            placeholder="Enter rules, guidelines, or important notes..."
            rows={6}
          />
        </label>
      </div>

      <button className="btn btn--primary settings__save" onClick={handleSave} disabled={saving}>
        {saving ? 'Saving...' : 'Save Settings'}
      </button>
    </div>
  );

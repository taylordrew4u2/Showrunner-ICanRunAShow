import { useState, useEffect } from 'react';
import type { AppSettings } from '../types';
import './Settings.css';

interface SettingsProps {
  settings: AppSettings;
  onSave: (settings: AppSettings) => void;
  onBack: () => void;
  saving?: boolean;
}

export function Settings({ settings: initialSettings, onSave, onBack, saving = false }: SettingsProps) {
  const [settings, setSettings] = useState<AppSettings>(initialSettings);

  useEffect(() => {
    setSettings(initialSettings);
  }, [initialSettings]);

  function handleSave() {
    onSave(settings);
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

        <label className="section-field">
          <span className="section-field__label">Producer Names</span>
          <input
            className="section-field__input"
            value={settings.producerNames}
            onChange={(e) => setSettings((s) => ({ ...s, producerNames: e.target.value }))}
            placeholder="e.g. Jane Smith, John Doe"
          />
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
}

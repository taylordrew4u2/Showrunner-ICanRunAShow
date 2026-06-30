import { useState, useEffect } from 'react';
import type { AppSettings, Producer } from '../types';
import { SHOW_TYPES } from '../types';
import { COLOR_SCHEMES, type ColorScheme } from '../utils/theme';
import { defaultRolodexTerm } from '../utils/terminology';
import { generateId } from '../utils/id';
import './Settings.css';

interface SettingsProps {
  settings: AppSettings;
  onSave: (settings: AppSettings) => void;
  onBack: () => void;
  saving?: boolean;
  colorScheme?: ColorScheme;
  onColorSchemeChange?: (scheme: ColorScheme) => void;
  onExport?: () => Promise<void>;
}

export function Settings({ settings: initialSettings, onSave, onBack, saving = false, colorScheme, onColorSchemeChange, onExport }: SettingsProps) {
  const [settings, setSettings] = useState<AppSettings>(initialSettings);
  const [newProducerName, setNewProducerName] = useState('');
  const [newProducerRole, setNewProducerRole] = useState('');

  const totalSpent = (settings.expenses || []).reduce((sum, e) => sum + (Number(e.cost) || 0), 0);
  const remaining = (settings.brandBudget || 0) - totalSpent;

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

  function toggleShowType(type: string) {
    setSettings((s) => {
      const current = s.showTypes ?? [];
      return {
        ...s,
        showTypes: current.includes(type)
          ? current.filter((t) => t !== type)
          : [...current, type],
      };
    });
  }

  return (
    <div className="settings">
      <button className="btn btn--ghost" onClick={onBack}>← Back</button>
      <h1 className="settings__title">Settings</h1>

      {onColorSchemeChange && (
        <div className="settings__card">
          <div className="section-field">
            <span className="section-field__label">Color Scheme</span>
            <p className="settings__hint">Pick the look that fits you. Applies across the whole app instantly.</p>
            <div className="settings__themes">
              {COLOR_SCHEMES.map((scheme) => (
                <button
                  key={scheme.id}
                  type="button"
                  className={`settings__theme ${colorScheme === scheme.id ? 'settings__theme--active' : ''}`}
                  onClick={() => onColorSchemeChange(scheme.id)}
                  aria-pressed={colorScheme === scheme.id}
                  title={scheme.description}
                >
                  <span
                    className="settings__theme-swatch"
                    style={{ background: scheme.bg }}
                    aria-hidden="true"
                  >
                    <span className="settings__theme-dot" style={{ background: scheme.swatch }} />
                  </span>
                  <span className="settings__theme-label">{scheme.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

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
          <span className="section-field__label">Show Types</span>
          <p className="settings__hint">The kinds of shows you produce. Used to tailor your workspace.</p>
          <div className="settings__show-types">
            {/* Saved custom types (e.g. an "Other" value) that aren't in the preset list. */}
            {Array.from(new Set([...SHOW_TYPES, ...(settings.showTypes ?? [])])).map((type) => (
              <button
                key={type}
                type="button"
                className={`settings__chip ${(settings.showTypes ?? []).includes(type) ? 'settings__chip--active' : ''}`}
                onClick={() => toggleShowType(type)}
                aria-pressed={(settings.showTypes ?? []).includes(type)}
              >
                {type}
              </button>
            ))}
          </div>
        </div>

        <div className="section-field">
          <span className="section-field__label">Rolodex Wording</span>
          <p className="settings__hint">
            What you call the people you book. Defaults to{' '}
            <strong>{defaultRolodexTerm(settings.showTypes).singular} Rolodex</strong> based on your show types — override it here.
          </p>
          <div className="settings__term-grid">
            <label className="settings__term-field">
              <span className="settings__term-label">Singular</span>
              <input
                className="section-field__input"
                value={settings.rolodexTermSingular ?? ''}
                onChange={(e) => setSettings((s) => ({ ...s, rolodexTermSingular: e.target.value || undefined }))}
                placeholder={defaultRolodexTerm(settings.showTypes).singular}
              />
            </label>
            <label className="settings__term-field">
              <span className="settings__term-label">Plural</span>
              <input
                className="section-field__input"
                value={settings.rolodexTermPlural ?? ''}
                onChange={(e) => setSettings((s) => ({ ...s, rolodexTermPlural: e.target.value || undefined }))}
                placeholder={defaultRolodexTerm(settings.showTypes).plural}
              />
            </label>
          </div>
        </div>

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
            Total spent: ${totalSpent.toFixed(2)} | Remaining: ${remaining.toFixed(2)}
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

      {onExport && (
        <button className="btn btn--secondary settings__save" onClick={onExport}>
          Export Backup (JSON)
        </button>
      )}
    </div>
  );
}
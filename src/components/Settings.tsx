import { useState, useEffect } from 'react';
import type { AppSettings, Producer } from '../types';
import { SHOW_TYPES } from '../types';
import { COLOR_SCHEMES, type ColorScheme } from '../utils/theme';
import { defaultRolodexTerm } from '../utils/terminology';
import { generateId } from '../utils/id';
import { PageHeader } from './PageHeader';
import { Icon } from './Icon';
import './Settings.css';

interface SettingsProps {
  settings: AppSettings;
  onSave: (settings: AppSettings) => void;
  onBack: () => void;
  saving?: boolean;
  colorScheme?: ColorScheme;
  onColorSchemeChange?: (scheme: ColorScheme) => void;
  onExport?: () => Promise<void>;
  /** ISO date of the last downloaded backup file, or null if never. */
  lastBackupAt?: string | null;
  /** Epoch ms of the last save confirmed by the server. */
  lastSavedAt?: number | null;
  /** Who's signed in — shown in the account card. */
  username?: string;
  onLogout?: () => void;
  onRestoreShow?: (trashId: string) => void;
  onDeleteForever?: (trashId: string) => void;
  onEmptyTrash?: () => void;
}

export function Settings({
  settings: initialSettings,
  onSave,
  onBack,
  saving = false,
  colorScheme,
  onColorSchemeChange,
  onExport,
  lastBackupAt = null,
  lastSavedAt = null,
  username,
  onLogout,
  onRestoreShow,
  onDeleteForever,
  onEmptyTrash,
}: SettingsProps) {
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

  const trash = settings.trash || [];

  return (
    <div className="settings">
      <PageHeader title="Settings" onBack={onBack} backLabel="Shows" />

      {onColorSchemeChange && (
        <div className="settings__card">
          <h2 className="settings__card-title">Appearance</h2>
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
        <h2 className="settings__card-title">Your workspace</h2>
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
        {saving ? 'Saving…' : 'Save Settings'}
      </button>

      {/* Deleting a show has always said it goes to the trash "where you can
          recover it" — this is where you actually recover it. */}
      {onRestoreShow && onDeleteForever && (
        <div className="settings__card">
          <h2 className="settings__card-title">Recently deleted</h2>
          <p className="settings__hint">
            Deleted shows are kept here so you can put them back. Walk-on audio isn't kept, so a
            restored show comes back without it.
          </p>

          {trash.length === 0 ? (
            <p className="settings__empty">Nothing deleted.</p>
          ) : (
            <>
              <ul className="settings__trash-list">
                {trash.map((item) => (
                  <li key={item.id} className="settings__trash-row">
                    <div className="settings__trash-info">
                      <span className="settings__trash-name">{item.data.name || 'Untitled show'}</span>
                      <span className="settings__trash-date">
                        Deleted {new Date(item.deletedAt).toLocaleDateString()}
                      </span>
                    </div>
                    <div className="settings__trash-actions">
                      <button className="btn btn--secondary btn--sm" onClick={() => onRestoreShow(item.id)}>
                        Restore
                      </button>
                      <button
                        className="btn btn--danger btn--sm"
                        onClick={() => {
                          if (window.confirm(`Permanently delete "${item.data.name}"? This can't be undone.`)) {
                            onDeleteForever(item.id);
                          }
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
              {onEmptyTrash && (
                <button
                  className="btn btn--ghost btn--sm settings__trash-empty"
                  onClick={() => {
                    if (window.confirm(`Permanently delete all ${trash.length} item(s)? This can't be undone.`)) {
                      onEmptyTrash();
                    }
                  }}
                >
                  Empty trash
                </button>
              )}
            </>
          )}
        </div>
      )}

      {/* The safety story in one place. It was all true before — encrypted
          client-side, auto-saved, locally backed up — but nowhere in the app
          said so, which made careful work feel like a gamble. */}
      <div className="settings__card">
        <h2 className="settings__card-title">Your data</h2>
        <ul className="settings__assurances">
          <li className="settings__assurance">
            <Icon name="lock" size={16} aria-hidden />
            <div>
              <strong>Encrypted before it leaves your device</strong>
              <span>
                Your password is the encryption key. It's used the moment you sign in and then
                discarded — never sent to us, and never written to this browser. What's stored
                is unreadable without it, including to us.
              </span>
            </div>
          </li>
          <li className="settings__assurance">
            <Icon name="cloud" size={16} aria-hidden />
            <div>
              <strong>Saved as you work</strong>
              <span>
                {lastSavedAt
                  ? `Last confirmed save ${new Date(lastSavedAt).toLocaleString(undefined, {
                      month: 'short',
                      day: 'numeric',
                      hour: 'numeric',
                      minute: '2-digit',
                    })}. `
                  : 'Every change saves on its own. '}
                There's no save button to forget, and a failed save keeps retrying instead of
                giving up.
              </span>
            </div>
          </li>
          <li className="settings__assurance">
            <Icon name="shield" size={16} aria-hidden />
            <div>
              <strong>A spare copy on this device</strong>
              <span>
                If a save can't get through, your edits are held here and re-sent next time the
                app opens. Closing the app mid-edit doesn't lose anything.
              </span>
            </div>
          </li>
          <li className="settings__assurance">
            <Icon name="download" size={16} aria-hidden />
            <div>
              <strong>A copy you own outright</strong>
              <span>
                {lastBackupAt
                  ? `You last downloaded a backup on ${new Date(lastBackupAt).toLocaleDateString(
                      undefined,
                      { month: 'long', day: 'numeric', year: 'numeric' },
                    )}.`
                  : "You haven't downloaded a backup yet — worth doing once your shows matter."}{' '}
                It's a plain file with every show, contact, and expense in it, readable without
                this app.
              </span>
            </div>
          </li>
        </ul>
        {onExport && (
          <button className="btn btn--primary settings__backup-btn" onClick={onExport}>
            Download a backup
          </button>
        )}
      </div>

      <div className="settings__card">
        <h2 className="settings__card-title">Account</h2>
        {username && (
          <p className="settings__hint">
            Signed in as <strong>{username}</strong>.
          </p>
        )}
        <p className="settings__hint">
          There's no password reset — your password is the key to your own encryption, so nobody
          can restore it for you. Keep it somewhere safe.
        </p>
        <div className="settings__account-actions">
          {onLogout && (
            <button className="btn btn--ghost" onClick={onLogout}>
              Log out
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
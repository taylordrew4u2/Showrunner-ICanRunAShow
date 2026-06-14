import { useState } from 'react';
import { SHOW_TYPES } from '../types';
import './Onboarding.css';

interface OnboardingProps {
  username: string;
  /** Persist the producer's choices and dismiss the onboarding flow. */
  onComplete: (data: { brandName: string; showTypes: string[] }) => void;
  saving?: boolean;
}

type Step = 'welcome' | 'showTypes' | 'brand';

/**
 * First-run onboarding shown immediately after a new account is created.
 * Walks the producer through naming their brand and picking the kinds of shows
 * they run, so the workspace can be tailored to their world.
 */
export function Onboarding({ username, onComplete, saving = false }: OnboardingProps) {
  const [step, setStep] = useState<Step>('welcome');
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [otherType, setOtherType] = useState('');
  const [brandName, setBrandName] = useState('');

  function toggleType(type: string) {
    setSelectedTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type],
    );
  }

  function buildShowTypes(): string[] {
    const trimmedOther = otherType.trim();
    // Replace the generic "Other" chip with whatever the producer typed.
    const base = selectedTypes.filter((t) => t !== 'Other');
    if (selectedTypes.includes('Other') && trimmedOther) base.push(trimmedOther);
    return base;
  }

  function finish() {
    onComplete({ brandName: brandName.trim(), showTypes: buildShowTypes() });
  }

  return (
    <div className="onboarding">
      <div className="onboarding__container">
        <div className="onboarding__progress" aria-hidden="true">
          {(['welcome', 'showTypes', 'brand'] as Step[]).map((s) => (
            <span
              key={s}
              className={`onboarding__dot ${step === s ? 'onboarding__dot--active' : ''}`}
            />
          ))}
        </div>

        {step === 'welcome' && (
          <div className="onboarding__step">
            <div className="onboarding__wordmark">
              <span className="onboarding__wordmark-dot" />
              <span className="onboarding__wordmark-text">Showrunner</span>
            </div>
            <h1 className="onboarding__title">Welcome, @{username} 👋</h1>
            <p className="onboarding__subtitle">
              Let's set up your workspace. A couple of quick questions so Showrunner
              fits the kind of shows you produce.
            </p>
            <button
              className="onboarding__button"
              type="button"
              onClick={() => setStep('showTypes')}
            >
              Get started
            </button>
          </div>
        )}

        {step === 'showTypes' && (
          <div className="onboarding__step">
            <h1 className="onboarding__title">What kind of shows do you make?</h1>
            <p className="onboarding__subtitle">Pick all that apply — you can change this later.</p>

            <div className="onboarding__chips" role="group" aria-label="Show types">
              {SHOW_TYPES.map((type) => (
                <button
                  key={type}
                  type="button"
                  className={`onboarding__chip ${selectedTypes.includes(type) ? 'onboarding__chip--active' : ''}`}
                  onClick={() => toggleType(type)}
                  aria-pressed={selectedTypes.includes(type)}
                >
                  {type}
                </button>
              ))}
            </div>

            {selectedTypes.includes('Other') && (
              <input
                className="onboarding__input"
                value={otherType}
                onChange={(e) => setOtherType(e.target.value)}
                placeholder="Tell us what kind of show"
                autoFocus
              />
            )}

            <div className="onboarding__actions">
              <button
                className="onboarding__button onboarding__button--secondary"
                type="button"
                onClick={() => setStep('welcome')}
              >
                Back
              </button>
              <button
                className="onboarding__button"
                type="button"
                onClick={() => setStep('brand')}
                disabled={selectedTypes.length === 0}
              >
                Continue
              </button>
            </div>
          </div>
        )}

        {step === 'brand' && (
          <div className="onboarding__step">
            <h1 className="onboarding__title">Name your brand</h1>
            <p className="onboarding__subtitle">
              This is how your production company or show series appears across Showrunner.
            </p>

            <input
              className="onboarding__input"
              value={brandName}
              onChange={(e) => setBrandName(e.target.value)}
              placeholder="e.g. Late Night Laughs"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !saving) finish();
              }}
            />

            <div className="onboarding__actions">
              <button
                className="onboarding__button onboarding__button--secondary"
                type="button"
                onClick={() => setStep('showTypes')}
                disabled={saving}
              >
                Back
              </button>
              <button
                className="onboarding__button"
                type="button"
                onClick={finish}
                disabled={saving}
              >
                {saving ? 'Setting up…' : 'Finish'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Help & setup: the tour, and a short step-by-step for each part of the app.
 *
 * Nothing here is required and nothing here changes the account. A step's
 * button takes the producer to the real page for it; whether the step is
 * done is read from the account itself, so the page is a picture of what is
 * set up, not a checklist to keep in step with it.
 *
 * In co-producer view it is read-only: no tour, no ticks, and only the
 * wizards about pages a co-producer can use.
 */
import { Icon } from '../components/Icon';
import { PageHeader } from '../components/PageHeader';
import { ProducerLock } from '../components/ProducerLock';
import { useOnline } from './GuideDock';
import { useGuide, type GuideApi } from './GuideContext';
import { placeShow } from './places';
import { resumeStepId, stepNumber } from './tourEngine';
import { LOCKED_FEATURE_LABELS } from './tourSteps';
import {
  progressLabel,
  stepDone,
  stepIsManual,
  wizardProgress,
  wizardsFor,
  type Wizard,
  type WizardStep,
} from './wizards';
import './guide.css';

function TourSection({ guide }: { guide: GuideApi }) {
  const { tour } = guide.state;
  const active = guide.session?.kind === 'tour';
  const at = stepNumber(resumeStepId(tour.stepId), false);
  return (
    <section className="help-card" data-tour="help-tour" aria-labelledby="help-tour-heading">
      <h2 className="help-card__title" id="help-tour-heading">Guided tour</h2>
      <p className="help-card__text">
        A walk through every part of the app on a sample show. About five minutes. It changes nothing in your
        account except adding the sample show.
      </p>
      <div className="help-card__actions">
        {active ? (
          <button type="button" className="btn btn--primary btn--sm" onClick={guide.goToCurrent}>Go to the current step</button>
        ) : tour.status === 'paused' ? (
          <>
            <button type="button" className="btn btn--primary btn--sm" onClick={guide.resumeTour}>
              {`Resume the tour (step ${at.n} of ${at.total})`}
            </button>
            <button type="button" className="btn btn--secondary btn--sm" onClick={() => void guide.startTour()}>
              Start again from the beginning
            </button>
          </>
        ) : tour.status === 'done' ? (
          <button type="button" className="btn btn--secondary btn--sm" onClick={() => void guide.startTour()}>Take the tour again</button>
        ) : (
          <button type="button" className="btn btn--primary btn--sm" onClick={() => void guide.startTour()}>Start the tour</button>
        )}
      </div>
    </section>
  );
}

function StepRow({ guide, wizard, step, online }: { guide: GuideApi; wizard: Wizard; step: WizardStep; online: boolean }) {
  const { context } = guide;
  const reviewing = !guide.enabled;
  const ticked = guide.state.checked[wizard.id] ?? [];
  const done = !reviewing && stepDone(wizard.id, step.id, guide.facts, ticked) === true;
  const manual = stepIsManual(wizard.id, step.id);
  const locked = context.locked && !!step.locked;
  const action = step.action;
  const needsShow = placeShow(action?.place) === 'real' && !context.hasRealShow;
  const checking = action?.check === 'connections';
  const connected = guide.facts.assistantConnections;

  return (
    <li className={`help-step${done ? ' help-step--done' : ''}`}>
      <div className="help-step__head">
        <h4 className="help-step__title">{step.title}</h4>
        {done && !manual && (
          <span className="help-step__done">
            <Icon name="check" size={14} />
            <span>Done</span>
          </span>
        )}
      </div>
      <p className="help-step__text">
        {step.text}
        {context.native && step.nativeText ? ` ${step.nativeText}` : ''}
      </p>
      {step.online && !online && <p className="help-step__note">You are offline. This step needs a connection.</p>}
      {locked && step.locked && <ProducerLock feature={LOCKED_FEATURE_LABELS[step.locked]} compact />}
      {checking && connected !== null && (
        <p className="help-step__note" role="status">
          {connected === 0 ? 'No AI assistants are connected.' : `${connected} connected`}
        </p>
      )}
      {checking && guide.connections.error && <p className="help-step__error" role="alert">{guide.connections.error}</p>}
      <div className="help-step__actions">
        {action && checking && guide.connections.canCheck && (
          <button type="button" className="btn btn--secondary btn--sm" disabled={guide.connections.busy} onClick={() => void guide.checkConnections()}>
            {guide.connections.busy ? 'Checking…' : action.label}
          </button>
        )}
        {action?.place && reviewing && !needsShow && (
          <button type="button" className="btn btn--secondary btn--sm" onClick={() => { if (action.place) guide.visit(action.place); }}>
            {action.label}
          </button>
        )}
        {action?.place && !reviewing && (
          <button type="button" className="btn btn--secondary btn--sm" onClick={() => guide.startWizardStep(wizard.id, step.id)}>
            {needsShow ? 'Make a show first' : action.label}
          </button>
        )}
        {manual && !reviewing && (
          <label className="help-step__check">
            <input
              type="checkbox"
              checked={ticked.includes(step.id)}
              onChange={() => guide.toggleChecked(wizard.id, step.id)}
            />
            <span>I have done this</span>
          </label>
        )}
      </div>
    </li>
  );
}

function WizardRow({ guide, wizard, online }: { guide: GuideApi; wizard: Wizard; online: boolean }) {
  const reviewing = !guide.enabled;
  const open = guide.state.openWizard === wizard.id;
  const headerId = `help-wizard-header-${wizard.id}`;
  const panelId = `help-wizard-panel-${wizard.id}`;
  const progress = wizardProgress(wizard, guide.facts, guide.state.checked[wizard.id] ?? [], guide.context.locked);
  const label = progressLabel(progress);
  return (
    <div className={`help-wizard${open ? ' help-wizard--open' : ''}`}>
      <h3 className="help-wizard__heading">
        <button
          type="button"
          id={headerId}
          className="help-wizard__header"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => guide.setOpenWizard(open ? undefined : wizard.id)}
        >
          <span className="help-wizard__text">
            <span className="help-wizard__title">{wizard.title}</span>
            <span className="help-wizard__desc">{wizard.description}</span>
          </span>
          {!reviewing && (
            <span className={`help-wizard__chip${label === 'Done' ? ' help-wizard__chip--done' : ''}`}>
              {label === 'Done' && <Icon name="check" size={13} />}
              <span>{label}</span>
            </span>
          )}
          <svg className="help-wizard__chevron" viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M5 7.5 10 12.5l5-5" />
          </svg>
        </button>
      </h3>
      {open && (
        <div id={panelId} className="help-wizard__panel" role="region" aria-labelledby={headerId}>
          <ol className="help-steps">
            {wizard.steps.map((step) => <StepRow key={step.id} guide={guide} wizard={wizard} step={step} online={online} />)}
          </ol>
        </div>
      )}
    </div>
  );
}

export function HelpPage({ onBack }: { onBack: () => void }) {
  const guide = useGuide();
  const online = useOnline();
  const reviewing = !guide.enabled;
  return (
    <div className="page help-page">
      <PageHeader
        title="Help & setup"
        subtitle="Nothing here is required. Open what you need."
        onBack={onBack}
        backLabel="More"
      />
      {reviewing && guide.reviewLabel && (
        <p className="help-page__review" role="note">
          {`You are helping with ${guide.reviewLabel}’s shows. Anything you change here is sent to them to approve.`}
        </p>
      )}
      {!reviewing && <TourSection guide={guide} />}
      <section className="help-card help-card--wizards" data-tour="help-wizards" aria-labelledby="help-wizards-heading">
        <h2 className="help-card__title" id="help-wizards-heading">Set up, step by step</h2>
        <div className="help-wizards">
          {wizardsFor(reviewing).map((wizard) => <WizardRow key={wizard.id} guide={guide} wizard={wizard} online={online} />)}
        </div>
      </section>
      {!reviewing && !guide.context.native && (
        <section className="help-card" aria-labelledby="help-more-heading">
          <h2 className="help-card__title" id="help-more-heading">Also here</h2>
          <p className="help-card__text">Both open in a new tab, so your place in the app is kept.</p>
          <ul className="help-links">
            <li><a href="/guides/" target="_blank" rel="noopener">Read the guides</a></li>
            <li><a href="/tour/" target="_blank" rel="noopener">See the product tour page</a></li>
          </ul>
        </section>
      )}
    </div>
  );
}

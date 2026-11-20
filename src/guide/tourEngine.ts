/**
 * How the tour moves. Pure, so the rules can be pinned by tests: the order,
 * what Run Show opening and closing does, where a stopped tour picks up, and
 * what "step N of M" counts.
 */
import { FIRST_STEP_ID, TOUR_STEPS, type TourStep } from './tourSteps';

export interface TourContext {
  /** The free plan, with paid features held back. */
  locked: boolean;
  /** The desktop layout: the nav is behind the menu button, not along the bottom. */
  desktop: boolean;
  runShowOpen: boolean;
}

/** The step that asks the producer to open the live board. */
export const RUN_OPEN_STEP_ID = 'run-open';
/** Where the tour goes once the live board is closed, or skipped. */
export const AFTER_RUN_SHOW_STEP_ID = 'viewer';

export function stepById(id: string | undefined): TourStep | undefined {
  return TOUR_STEPS.find((step) => step.id === id);
}

/** The steps that count right now: Run Show's own only while the board is open. */
export function countedSteps(runShowOpen: boolean): TourStep[] {
  return TOUR_STEPS.filter((step) => runShowOpen || step.surface === 'app');
}

/** "Step N of M". An unknown id numbers as the first step. */
export function stepNumber(id: string | undefined, runShowOpen: boolean): { n: number; total: number } {
  const step = stepById(id);
  // A Run Show step is only ever shown inside the board, so it is counted with it.
  const steps = countedSteps(runShowOpen || step?.surface === 'runshow');
  const index = steps.findIndex((other) => other.id === id);
  return { n: index < 0 ? 1 : index + 1, total: steps.length };
}

/**
 * The step "Next step" leads to, or null when there is none: the last step,
 * and the last step inside Run Show, where closing the board is the way on.
 */
export function nextStepId(id: string, runShowOpen: boolean): string | null {
  const index = TOUR_STEPS.findIndex((step) => step.id === id);
  if (index < 0) return FIRST_STEP_ID;
  const current = TOUR_STEPS[index];
  // Asked to try the board and chose not to: straight past its steps.
  if (current.id === RUN_OPEN_STEP_ID && !runShowOpen) return AFTER_RUN_SHOW_STEP_ID;
  const next = TOUR_STEPS[index + 1];
  if (!next) return null;
  if (current.surface === 'runshow' && next.surface !== 'runshow') return null;
  return next.id;
}

/** The step "Previous step" leads to, or null on the first step and the first step inside Run Show. */
export function previousStepId(id: string): string | null {
  const index = TOUR_STEPS.findIndex((step) => step.id === id);
  if (index <= 0) return null;
  const current = TOUR_STEPS[index];
  if (current.surface === 'runshow') {
    const previous = TOUR_STEPS[index - 1];
    return previous.surface === 'runshow' ? previous.id : null;
  }
  // Back from the page never lands inside a board that is closed.
  for (let i = index - 1; i >= 0; i--) {
    if (TOUR_STEPS[i].surface === 'app') return TOUR_STEPS[i].id;
  }
  return null;
}

/**
 * What the live board opening or closing does to the tour. Opening it on the
 * step that asks for it starts the board's own steps; closing it on any of
 * those carries on with the page. Anywhere else the tour stays where it is.
 */
export function afterRunShowChange(id: string, open: boolean): string {
  const step = stepById(id);
  if (!step) return id;
  if (open) {
    if (step.id !== RUN_OPEN_STEP_ID) return id;
    return TOUR_STEPS.find((other) => other.surface === 'runshow')?.id ?? id;
  }
  return step.surface === 'runshow' ? AFTER_RUN_SHOW_STEP_ID : id;
}

/**
 * Where a stopped tour picks up. A step an update removed starts over, and a
 * step inside the board goes back to the one that opens it: the board is not
 * open on a cold start.
 */
export function resumeStepId(stored: string | undefined): string {
  const step = stepById(stored);
  if (!step) return FIRST_STEP_ID;
  return step.surface === 'runshow' ? RUN_OPEN_STEP_ID : step.id;
}

/** What a step says here: the locked wording on the free plan, and the right words for this layout. */
export function stepBody(step: TourStep, context: Pick<TourContext, 'locked' | 'desktop'>): string {
  if (context.locked && step.locked) return step.locked.body;
  if (typeof step.body === 'string') return step.body;
  return context.desktop ? step.body.desktop : step.body.phone;
}

export interface TourProgress {
  status: 'new' | 'active' | 'paused' | 'done';
  stepId?: string;
}

/**
 * Only one guide shows at a time. Opening a wizard step while the tour is
 * running sets the tour aside where it was, to be picked up from Help & setup.
 */
export function setAsideForWizard(tour: TourProgress): TourProgress {
  return tour.status === 'active' ? { status: 'paused', stepId: tour.stepId } : tour;
}

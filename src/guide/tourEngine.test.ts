import { describe, expect, it } from 'vitest';
import {
  afterRunShowChange,
  countedSteps,
  nextStepId,
  previousStepId,
  resumeStepId,
  setAsideForWizard,
  stepBody,
  stepById,
  stepNumber,
} from './tourEngine';
import { FIRST_STEP_ID, LAST_STEP_ID, TOUR_STEPS } from './tourSteps';

const appSteps = TOUR_STEPS.filter((step) => step.surface === 'app').map((step) => step.id);
const boardSteps = TOUR_STEPS.filter((step) => step.surface === 'runshow').map((step) => step.id);

describe('moving through the tour', () => {
  it('walks the page steps in order when the live board is never opened', () => {
    const walked = [FIRST_STEP_ID];
    for (let next = nextStepId(FIRST_STEP_ID, false); next; next = nextStepId(next, false)) walked.push(next);
    expect(walked).toEqual(appSteps);
    expect(walked[walked.length - 1]).toBe(LAST_STEP_ID);
  });

  it('walks back the same way, and stops at the first step', () => {
    const walked = [LAST_STEP_ID];
    for (let previous = previousStepId(LAST_STEP_ID); previous; previous = previousStepId(previous)) walked.push(previous);
    expect(walked.reverse()).toEqual(appSteps);
    expect(previousStepId(FIRST_STEP_ID)).toBeNull();
  });

  it('skips the board when Next step is pressed without opening it', () => {
    expect(nextStepId('run-open', false)).toBe('viewer');
    expect(previousStepId('viewer')).toBe('run-open');
  });

  it('starts the board’s own steps when the board is opened on the step that asks for it', () => {
    expect(afterRunShowChange('run-open', true)).toBe('run-clock');
    expect(nextStepId('run-clock', true)).toBe('run-board');
    expect(nextStepId('run-board', true)).toBe('run-close');
    // Closing the board is the way on from its last step.
    expect(nextStepId('run-close', true)).toBeNull();
    expect(previousStepId('run-clock')).toBeNull();
    expect(previousStepId('run-close')).toBe('run-board');
  });

  it('carries on with the page when the board is closed on any of its steps', () => {
    for (const id of boardSteps) expect(afterRunShowChange(id, false)).toBe('viewer');
  });

  it('stays where it is when the board is opened or closed on any other step', () => {
    for (const id of appSteps) {
      if (id !== 'run-open') expect(afterRunShowChange(id, true)).toBe(id);
      expect(afterRunShowChange(id, false)).toBe(id);
    }
    expect(afterRunShowChange('not-a-step', true)).toBe('not-a-step');
  });
});

describe('picking a stopped tour back up', () => {
  it('resumes at the stored step', () => {
    expect(resumeStepId('lineup')).toBe('lineup');
  });

  it('starts over when an update removed the stored step', () => {
    expect(resumeStepId('a-step-that-was-removed')).toBe(FIRST_STEP_ID);
    expect(resumeStepId(undefined)).toBe(FIRST_STEP_ID);
  });

  it('goes back to the step that opens the board when it stopped inside it', () => {
    expect(resumeStepId('run-board')).toBe('run-open');
  });

  // Only one guide shows at a time, and the wizard takes the card without asking.
  it('sets a running tour aside on the same step when a wizard step opens', () => {
    expect(setAsideForWizard({ status: 'active', stepId: 'flyer' })).toEqual({ status: 'paused', stepId: 'flyer' });
    expect(setAsideForWizard({ status: 'done' })).toEqual({ status: 'done' });
    expect(setAsideForWizard({ status: 'new' })).toEqual({ status: 'new' });
  });
});

describe('step N of M', () => {
  it('leaves the board’s steps out of the count while the board is closed', () => {
    expect(countedSteps(false).map((step) => step.id)).toEqual(appSteps);
    expect(stepNumber(FIRST_STEP_ID, false)).toEqual({ n: 1, total: appSteps.length });
    expect(stepNumber('run-open', false).n + 1).toBe(stepNumber('viewer', false).n);
    expect(stepNumber(LAST_STEP_ID, false)).toEqual({ n: appSteps.length, total: appSteps.length });
  });

  it('counts them inside the board', () => {
    expect(stepNumber('run-clock', true)).toEqual({ n: stepNumber('run-open', false).n + 1, total: TOUR_STEPS.length });
    // A board step is only ever shown in the board, whatever the caller says.
    expect(stepNumber('run-clock', false).total).toBe(TOUR_STEPS.length);
  });

  it('numbers a step it does not know as the first', () => {
    expect(stepNumber('gone', false).n).toBe(1);
  });
});

describe('what a step says', () => {
  it('uses the locked wording on the free plan for exactly the steps that have one', () => {
    const tagged = TOUR_STEPS.filter((step) => step.locked).map((step) => step.id);
    expect(tagged).toEqual(['schedule', 'viewer', 'contracts', 'season']);
    for (const step of TOUR_STEPS) {
      const free = stepBody(step, { locked: true, desktop: false });
      const paid = stepBody(step, { locked: false, desktop: false });
      if (step.locked) {
        expect(free).toBe(step.locked.body);
        expect(free).not.toBe(paid);
        expect(free).toMatch(/part of the Producer plan/);
      } else {
        expect(free).toBe(paid);
      }
    }
  });

  it('describes the nav as it is on this screen', () => {
    const nav = stepById('nav')!;
    expect(stepBody(nav, { locked: false, desktop: false })).toMatch(/bar along the bottom/);
    expect(stepBody(nav, { locked: false, desktop: true })).toMatch(/menu button at the top left/);
  });
});

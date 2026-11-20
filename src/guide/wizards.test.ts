import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type AppSettings, type Show } from '../types';
import { buildSampleShow } from '../utils/sampleShow';
import { resolveShow } from './places';
import {
  WIZARDS,
  progressLabel,
  stepDone,
  stepIsManual,
  wizardById,
  wizardFacts,
  wizardProgress,
  wizardsFor,
  type WizardFacts,
  type WizardId,
} from './wizards';

function show(overrides: Partial<Show> = {}): Show {
  return {
    ...buildSampleShow(new Date('2030-01-01T12:00:00')),
    // A bare show of the producer's own: nothing on the bill, nothing planned.
    sample: undefined,
    schedule: [],
    id: 'show-1',
    createdAt: '2030-01-01T00:00:00.000Z',
    updatedAt: '2030-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const sample: Show = { ...show({ id: 'sample-1' }), ...buildSampleShow(new Date('2030-01-01T12:00:00')) };

function facts(input: { shows?: Show[]; settings?: Partial<AppSettings>; links?: number; lastBackupAt?: string | null; ranShow?: boolean; assistantConnections?: number | null } = {}): WizardFacts {
  return wizardFacts({
    shows: input.shows ?? [],
    settings: { ...DEFAULT_SETTINGS, ...input.settings },
    links: input.links ?? 0,
    lastBackupAt: input.lastBackupAt ?? null,
    ranShow: input.ranShow ?? false,
    assistantConnections: input.assistantConnections ?? null,
  });
}

/** Every step's state, as one comparable picture of the page. */
function picture(f: WizardFacts): Record<string, boolean | null> {
  const all: Record<string, boolean | null> = {};
  for (const wizard of WIZARDS) {
    for (const step of wizard.steps) all[`${wizard.id}/${step.id}`] = stepDone(wizard.id, step.id, f, []);
  }
  return all;
}

const done = (wizard: WizardId, step: string, f: WizardFacts, ticked: string[] = []) => stepDone(wizard, step, f, ticked);

describe('what a new account sees', () => {
  it('has nothing done, and a tick box wherever there is nothing to read', () => {
    const empty = facts();
    for (const wizard of WIZARDS) {
      for (const step of wizard.steps) {
        expect(done(wizard.id, step.id, empty), `${wizard.id}/${step.id}`).toBe(stepIsManual(wizard.id, step.id) ? null : false);
      }
      expect(progressLabel(wizardProgress(wizard, empty, [], false))).toBe('Not started');
    }
  });

  // The sample show is for trying things. Running it, or filling it in, sets nothing up.
  it('is not changed by the sample show, however much is on it', () => {
    const busySample: Show = {
      ...sample,
      viewToken: 'tok',
      flyer: 'media:flyer',
      hiddenSections: [],
      performers: [{ id: 'p1', name: 'Ada', walkOnMusic: 'media:walk' }] as Show['performers'],
    };
    expect(busySample.schedule.length).toBeGreaterThan(0);
    expect(picture(facts({ shows: [busySample] }))).toEqual(picture(facts()));
  });

  it('never opens the sample where a step needs a show of the producer’s own', () => {
    expect(resolveShow([sample], 'real')).toBeNull();
    expect(resolveShow([sample], 'sample')?.id).toBe('sample-1');
    expect(resolveShow([sample, show()], 'real')?.id).toBe('show-1');
    expect(resolveShow([show()], 'sample')).toBeNull();
  });
});

describe('which show a step opens', () => {
  const today = new Date('2030-06-15T12:00:00');
  it('is the next one still ahead', () => {
    const shows = [
      show({ id: 'past', date: '2030-06-01' }),
      show({ id: 'later', date: '2030-08-01' }),
      show({ id: 'next', date: '2030-06-20' }),
      show({ id: 'cancelled', date: '2030-06-16', status: 'cancelled' }),
    ];
    expect(resolveShow(shows, 'real', today)?.id).toBe('next');
  });

  it('is the one touched last when none is ahead', () => {
    const shows = [
      show({ id: 'old', date: '2030-05-01', updatedAt: '2030-05-02T00:00:00.000Z' }),
      show({ id: 'recent', date: '2030-04-01', updatedAt: '2030-06-10T00:00:00.000Z' }),
    ];
    expect(resolveShow(shows, 'real', today)?.id).toBe('recent');
  });
});

describe('telling that a step is done from the account itself', () => {
  it('first show: a show, someone on it, a running order', () => {
    expect(done('first-show', 'create', facts({ shows: [show()] }))).toBe(true);
    expect(done('first-show', 'lineup', facts({ shows: [show()] }))).toBe(false);
    expect(done('first-show', 'lineup', facts({ shows: [show({ performers: [{ id: 'p', name: 'Ada' }] as Show['performers'] })] }))).toBe(true);
    expect(done('first-show', 'schedule', facts({ shows: [show({ schedule: sample.schedule })] }))).toBe(true);
  });

  it('Rolodex: a person, a detail about them, a request, a word of your own', () => {
    const one = { id: 'c1', name: 'Ada' };
    expect(done('rolodex', 'add', facts({ settings: { potentialComics: [one] } }))).toBe(true);
    expect(done('rolodex', 'profile', facts({ settings: { potentialComics: [one] } }))).toBe(false);
    expect(done('rolodex', 'profile', facts({ settings: { potentialComics: [{ ...one, email: 'ada@example.com' }] } }))).toBe(true);
    expect(done('rolodex', 'ask', facts({ settings: { profileRequests: [{ token: 't' }] as AppSettings['profileRequests'] } }))).toBe(true);
    expect(done('rolodex', 'term', facts({ settings: { rolodexTermSingular: 'Queen' } }))).toBe(true);
  });

  it('contracts: a PDF, a request, a signed one, one filed by hand', () => {
    const request = { token: 't', signed: false };
    expect(done('contracts', 'add', facts({ settings: { contracts: [{ id: 'k' }] as AppSettings['contracts'] } }))).toBe(true);
    expect(done('contracts', 'send', facts({ settings: { signatureRequests: [request] as unknown as AppSettings['signatureRequests'] } }))).toBe(true);
    expect(done('contracts', 'signed', facts({ settings: { signatureRequests: [request] as unknown as AppSettings['signatureRequests'] } }))).toBe(false);
    expect(done('contracts', 'signed', facts({ settings: { signatureRequests: [{ ...request, signed: true }] as unknown as AppSettings['signatureRequests'] } }))).toBe(true);
    expect(done('contracts', 'file', facts({ settings: { signedAgreements: [{ id: 'a' }] as AppSettings['signedAgreements'] } }))).toBe(true);
  });

  it('live: a viewer link, the board opened here, a remote paired', () => {
    expect(done('live', 'viewer', facts({ shows: [show({ viewToken: 'tok' })] }))).toBe(true);
    expect(done('live', 'board', facts({ ranShow: true }))).toBe(true);
    expect(done('live', 'remote', facts({ settings: { remoteMusicKey: 'PageDown' } }))).toBe(true);
  });

  it('music: a track, a walk-on in the Rolodex or on a bill, DJ Music turned on', () => {
    expect(done('music', 'upload', facts({ settings: { musicLibrary: [{ id: 'm' }] as AppSettings['musicLibrary'] } }))).toBe(true);
    expect(done('music', 'walk-on', facts({ settings: { potentialComics: [{ id: 'c', name: 'Ada', walkOnMusic: 'media:w' }] } }))).toBe(true);
    expect(done('music', 'walk-on', facts({ shows: [show({ performers: [{ id: 'p', name: 'Ada', walkOnMusic: 'media:w' }] as Show['performers'] })] }))).toBe(true);
    expect(done('music', 'dj', facts({ shows: [show()] }))).toBe(false);
    expect(done('music', 'dj', facts({ shows: [show({ hiddenSections: ['staff'] })] }))).toBe(true);
  });

  it('the rest: a flyer, a link, a backup, a brand, an expense, an address', () => {
    expect(done('promo', 'flyer', facts({ shows: [show({ flyer: 'media:f' })] }))).toBe(true);
    expect(done('coproducers', 'link', facts({ links: 1 }))).toBe(true);
    expect(done('backup', 'download', facts({ lastBackupAt: '2030-01-01T00:00:00.000Z' }))).toBe(true);
    expect(done('workspace', 'brand', facts({ settings: { brandName: 'Basement Comedy' } }))).toBe(false);
    expect(done('workspace', 'brand', facts({ settings: { brandName: 'Basement Comedy', showTypes: ['Comedy'] } }))).toBe(true);
    expect(done('workspace', 'house', facts({ settings: { rules: 'Be kind.' } }))).toBe(true);
    expect(done('money', 'expense', facts({ settings: { expenses: [{ id: 'e' }] as AppSettings['expenses'] } }))).toBe(true);
    expect(done('money', 'emails', facts({ settings: { emailList: [{ id: 'm' }] as AppSettings['emailList'] } }))).toBe(true);
  });

  // Asked of the server only when the producer presses the button.
  it('assistants: unknown until checked, then counted', () => {
    expect(done('assistants', 'check', facts())).toBe(false);
    expect(done('assistants', 'allow', facts())).toBe(false);
    expect(done('assistants', 'check', facts({ assistantConnections: 0 }))).toBe(true);
    expect(done('assistants', 'allow', facts({ assistantConnections: 0 }))).toBe(false);
    expect(done('assistants', 'allow', facts({ assistantConnections: 2 }))).toBe(true);
  });

  it('takes the producer’s word where there is nothing to read', () => {
    expect(done('music', 'trim', facts())).toBeNull();
    expect(done('music', 'trim', facts(), ['trim'])).toBe(true);
    // A tick never overrides what the account says.
    expect(done('music', 'upload', facts(), ['upload'])).toBe(false);
  });
});

describe('how far along a wizard is', () => {
  it('counts what is done', () => {
    const rolodex = wizardById('rolodex')!;
    const some = facts({ settings: { potentialComics: [{ id: 'c', name: 'Ada' }] } });
    expect(wizardProgress(rolodex, some, [], false)).toEqual({ done: 1, total: 4 });
    expect(progressLabel({ done: 1, total: 4 })).toBe('1 of 4');
    expect(progressLabel({ done: 4, total: 4 })).toBe('Done');
    expect(progressLabel({ done: 0, total: 4 })).toBe('Not started');
  });

  // A wizard can still read "Done" on the plan it is being used on.
  it('leaves a step the free plan holds back out of both numbers', () => {
    const contracts = wizardById('contracts')!;
    const filed = facts({ settings: { signedAgreements: [{ id: 'a' }] as AppSettings['signedAgreements'] } });
    expect(wizardProgress(contracts, filed, [], false)).toEqual({ done: 1, total: 4 });
    expect(wizardProgress(contracts, filed, [], true)).toEqual({ done: 1, total: 2 });
    const money = wizardById('money')!;
    expect(wizardProgress(money, facts(), [], true).total).toBe(money.steps.length - 1);
  });
});

describe('co-producer view', () => {
  it('shows only the wizards about pages a co-producer can use', () => {
    expect(wizardsFor(true).map((wizard) => wizard.id)).toEqual(['rolodex', 'contracts', 'live', 'music', 'promo', 'money']);
    expect(wizardsFor(false)).toHaveLength(WIZARDS.length);
  });

  // The New show form there would become a request on the owner's account.
  it('never opens the New show form', () => {
    for (const wizard of wizardsFor(true)) {
      for (const step of wizard.steps) expect(step.action?.place && 'newShow' in step.action.place, `${wizard.id}/${step.id}`).toBeFalsy();
    }
  });
});

/**
 * The guide: the tour and the setup wizards, and the one card that shows
 * either of them.
 *
 * Everything here is optional and changes nothing in the account. The guide
 * navigates, opens sections and points at controls; the only thing it ever
 * creates is the sample show, once, after asking. What it remembers is kept
 * on this device (see guideStore).
 *
 * Off entirely in co-producer view: a tour there would turn its sample show
 * into a request on the owner's account.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { DEFAULT_SETTINGS, type AppSettings, type Show } from '../types';
import { useConfirm } from '../components/useConfirm';
import { localConfirm } from '../components/coproducer/localConfirm';
import { isNativeShell } from '../utils/nativeShell';
import { EMPTY_GUIDE, readGuide, writeGuide, type GuideState } from './guideStore';
import { placeShow, resolveShow, type GuidePlace } from './places';
import {
  afterRunShowChange,
  nextStepId,
  previousStepId,
  resumeStepId,
  setAsideForWizard,
  stepById,
} from './tourEngine';
import { FIRST_STEP_ID } from './tourSteps';
import { isOwnShow, wizardById, wizardFacts, wizardStep, type WizardFacts, type WizardId } from './wizards';

export type GuideSession =
  | { kind: 'tour'; stepId: string }
  | { kind: 'wizard'; id: WizardId; stepId: string }
  | null;

/** What the dock and the Help page need to know about where the app is. */
export interface GuideContextInfo {
  desktop: boolean;
  locked: boolean;
  native: boolean;
  view: string;
  selectedShowId: string | null;
  runShowOpen: boolean;
  /** The sample show, if the account has one. */
  sampleId: string | null;
  /** Whether the producer has a show of their own to open. */
  hasRealShow: boolean;
}

export interface GuideApi {
  /** False in co-producer view: no tour, no offer, nothing stored. */
  enabled: boolean;
  /** The co-producer's name in co-producer view, else ''. */
  reviewLabel: string;
  session: GuideSession;
  /** The card is folded down to a pill. Not stored. */
  minimized: boolean;
  setMinimized(minimized: boolean): void;
  state: GuideState;
  context: GuideContextInfo;
  facts: WizardFacts;
  /** The one line left behind when a tour is ended. */
  closedNote: boolean;
  dismissClosedNote(): void;
  /** Asks about the sample show if there is none. */
  startTour(): Promise<void>;
  resumeTour(): void;
  next(): void;
  previous(): void;
  /** Stop here, to be picked up later. */
  endTour(): void;
  finishTour(options?: { deleteSample?: boolean }): void;
  /** Put the sample show back after it was deleted mid-tour. */
  addSample(): void;
  /**
   * The "Tour closed" note's "Delete the sample show": the same delete as the
   * tour's last step, and the tour stays where it was stopped.
   */
  deleteSampleAfterTour(): void;
  startWizardStep(id: WizardId, stepId: string): void;
  nextWizardStep(): void;
  closeWizard(): void;
  backToHelp(): void;
  /** "Go to this step": back to the page the current step is about. */
  goToCurrent(): void;
  /** Just go somewhere, with no card. All co-producer view ever does. */
  visit(place: GuidePlace): boolean;
  dismissOffer(): void;
  toggleChecked(id: WizardId, stepId: string): void;
  setOpenWizard(id: WizardId | undefined): void;
  /** Ask the server which assistants are connected. Only ever on a press. */
  checkConnections(): Promise<void>;
  connections: { busy: boolean; error: string; canCheck: boolean };
}

const NOTHING = () => {};

const DISABLED: GuideApi = {
  enabled: false,
  reviewLabel: '',
  session: null,
  minimized: false,
  setMinimized: NOTHING,
  state: EMPTY_GUIDE,
  context: { desktop: false, locked: false, native: false, view: '', selectedShowId: null, runShowOpen: false, sampleId: null, hasRealShow: false },
  facts: { realShows: [], comics: [], settings: DEFAULT_SETTINGS, links: 0, lastBackupAt: null, ranShow: false, assistantConnections: null },
  closedNote: false,
  dismissClosedNote: NOTHING,
  startTour: async () => {},
  resumeTour: NOTHING,
  next: NOTHING,
  previous: NOTHING,
  endTour: NOTHING,
  finishTour: NOTHING,
  addSample: NOTHING,
  deleteSampleAfterTour: NOTHING,
  startWizardStep: NOTHING,
  nextWizardStep: NOTHING,
  closeWizard: NOTHING,
  backToHelp: NOTHING,
  goToCurrent: NOTHING,
  visit: () => false,
  dismissOffer: NOTHING,
  toggleChecked: NOTHING,
  setOpenWizard: NOTHING,
  checkConnections: async () => {},
  connections: { busy: false, error: '', canCheck: false },
};

const GuideContext = createContext<GuideApi>(DISABLED);

/** The guide. Outside the provider (a test, a public page) it is simply off. */
// eslint-disable-next-line react-refresh/only-export-components
export function useGuide(): GuideApi {
  return useContext(GuideContext);
}

interface GuideProviderProps {
  username: string;
  /** Co-producer view: the guide is off and nothing is read or stored. */
  reviewing: boolean;
  reviewLabel?: string;
  shows: Show[];
  settings: AppSettings;
  view: string;
  selectedShowId: string | null;
  runShowOpen: boolean;
  desktop: boolean;
  locked: boolean;
  /**
   * Take the app to a place. False when the place needs a show the account
   * does not have. `then` runs once the app is there, which is later than
   * the call, or never, when Settings asks about unsaved changes first.
   */
  go: (place: GuidePlace, then?: () => void) => boolean;
  /** Add the sample show and open it, as "Try a sample show" does. */
  createSample: (then?: () => void) => void;
  deleteShow: (id: string) => void;
  /** Co-producer links made. */
  links: number;
  lastBackupAt: string | null;
  /** How many assistants are connected, asked of the server. Absent where there is no session to ask with. */
  countConnections?: () => Promise<number>;
  children: ReactNode;
}

export function GuideProvider({
  username,
  reviewing,
  reviewLabel = '',
  shows,
  settings,
  view,
  selectedShowId,
  runShowOpen,
  desktop,
  locked,
  go,
  createSample,
  deleteShow,
  links,
  lastBackupAt,
  countConnections,
  children,
}: GuideProviderProps) {
  const enabled = !reviewing;
  const { confirm, confirmDialog } = useConfirm();
  const [state, setState] = useState<GuideState>(() => (enabled ? readGuide(username) : EMPTY_GUIDE));
  const [minimized, setMinimized] = useState(false);
  const [closedAt, setClosedAt] = useState<string | null>(null);
  const [assistantConnections, setAssistantConnections] = useState<number | null>(null);
  const [connectionsBusy, setConnectionsBusy] = useState(false);
  const [connectionsError, setConnectionsError] = useState('');

  // App hands these over as new functions on every render. Held in a ref so
  // the guide's own callbacks, and everything that depends on them, stay put.
  const app = useRef({ go, createSample, deleteShow, countConnections });
  useEffect(() => {
    app.current = { go, createSample, deleteShow, countConnections };
  });

  const sampleId = useMemo(() => resolveShow(shows, 'sample')?.id ?? null, [shows]);
  const hasRealShow = useMemo(() => shows.some((show) => !show.sample), [shows]);

  // Kept on this device as it changes. Not on the first render: reading the
  // guide must not be what creates its key.
  const stored = useRef(state);
  useEffect(() => {
    if (!enabled || stored.current === state) return;
    stored.current = state;
    writeGuide(username, state);
  }, [enabled, username, state]);

  // The live board opening and closing moves the tour through the board's
  // own steps, and opening it on a show of the producer's own is a fact a
  // wizard reads. Adjusted while rendering, on the change itself.
  const [seenRunShow, setSeenRunShow] = useState(runShowOpen);
  if (seenRunShow !== runShowOpen) {
    setSeenRunShow(runShowOpen);
    if (enabled) {
      // Any sample show, not only the newest one the tour uses.
      const onOwnShow = runShowOpen && isOwnShow(shows, selectedShowId);
      setState((current) => {
        let next = current;
        if (onOwnShow && !current.facts.ranShow) next = { ...next, facts: { ...next.facts, ranShow: true } };
        if (next.tour.status === 'active' && next.tour.stepId) {
          const stepId = afterRunShowChange(next.tour.stepId, runShowOpen);
          if (stepId !== next.tour.stepId) next = { ...next, tour: { status: 'active', stepId } };
        }
        return next;
      });
    }
  }
  // Found the Help page: the offer on the Shows list has done its job.
  if (enabled && view === 'help' && state.offer !== 'dismissed') {
    setState((current) => ({ ...current, offer: 'dismissed' }));
  }

  const session = useMemo<GuideSession>(() => {
    if (!enabled) return null;
    if (state.tour.status === 'active') return { kind: 'tour', stepId: stepById(state.tour.stepId)?.id ?? FIRST_STEP_ID };
    if (state.wizard && wizardStep(state.wizard.id, state.wizard.stepId)) return { kind: 'wizard', ...state.wizard };
    return null;
  }, [enabled, state.tour, state.wizard]);

  const whereKey = `${view}:${selectedShowId ?? ''}`;
  const closedNote = enabled && session === null && closedAt === whereKey && !runShowOpen;

  /** Show a tour step: go to its page, and only then say so. */
  const moveTo = useCallback((stepId: string) => {
    const step = stepById(stepId);
    if (!step) return;
    const commit = () => {
      setClosedAt(null);
      setState((current) => ({ ...current, wizard: undefined, tour: { status: 'active', stepId } }));
    };
    // A step inside the live board has nowhere to go: the board is already up.
    if (step.surface === 'runshow' || !step.place) {
      commit();
      return;
    }
    // A missing sample show still shows the step, which offers to add it back.
    if (!app.current.go(step.place, commit)) commit();
  }, []);

  const startTour = useCallback(async () => {
    if (!enabled) return;
    const begin = () => {
      setMinimized(false);
      setClosedAt(null);
      setState((current) => ({ ...current, wizard: undefined, tour: { status: 'active', stepId: FIRST_STEP_ID } }));
    };
    if (sampleId) {
      const first = stepById(FIRST_STEP_ID);
      if (first?.place && app.current.go(first.place, begin)) return;
      begin();
      return;
    }
    const ok = await confirm(localConfirm({
      title: 'Add the sample show?',
      message: 'The tour walks through a sample show. It is added to your Shows like any other, is never counted in your Season report, and you can delete it whenever you like.',
      confirmLabel: 'Add it and start',
    }));
    if (!ok) return;
    // Adding it opens it, which is where the first step is.
    app.current.createSample(begin);
  }, [enabled, sampleId, confirm]);

  const resumeTour = useCallback(() => {
    if (!enabled) return;
    setMinimized(false);
    moveTo(resumeStepId(state.tour.stepId));
  }, [enabled, moveTo, state.tour.stepId]);

  const next = useCallback(() => {
    if (session?.kind !== 'tour') return;
    const stepId = nextStepId(session.stepId, runShowOpen);
    if (stepId) moveTo(stepId);
  }, [session, runShowOpen, moveTo]);

  const previous = useCallback(() => {
    if (session?.kind !== 'tour') return;
    const stepId = previousStepId(session.stepId);
    if (stepId) moveTo(stepId);
  }, [session, moveTo]);

  const endTour = useCallback(() => {
    setClosedAt(whereKey);
    setState((current) => (current.tour.status === 'active'
      ? { ...current, tour: { status: 'paused', stepId: current.tour.stepId } }
      : current));
  }, [whereKey]);

  const finishTour = useCallback((options?: { deleteSample?: boolean }) => {
    if (options?.deleteSample && sampleId) app.current.deleteShow(sampleId);
    setClosedAt(null);
    setState((current) => ({ ...current, tour: { status: 'done' } }));
  }, [sampleId]);

  const addSample = useCallback(() => {
    if (!enabled || sampleId) return;
    app.current.createSample();
  }, [enabled, sampleId]);

  const deleteSampleAfterTour = useCallback(() => {
    if (!enabled) return;
    if (sampleId) app.current.deleteShow(sampleId);
    setClosedAt(null);
  }, [enabled, sampleId]);

  const startWizardStep = useCallback((id: WizardId, stepId: string) => {
    const step = wizardStep(id, stepId);
    if (!step) return;
    const place = step.action?.place;
    if (!enabled) {
      if (place) app.current.go(place);
      return;
    }
    const commit = () => {
      setMinimized(false);
      setClosedAt(null);
      setState((current) => ({ ...current, tour: setAsideForWizard(current.tour), wizard: { id, stepId }, openWizard: id }));
    };
    if (!place) {
      commit();
      return;
    }
    if (app.current.go(place, commit)) return;
    // The step needs a show of the producer's own and there is none yet.
    const first = wizardById('first-show')?.steps[0];
    const firstPlace = first?.action?.place;
    if (!first || !firstPlace) return;
    app.current.go(firstPlace, () => {
      setMinimized(false);
      setClosedAt(null);
      setState((current) => ({
        ...current,
        tour: setAsideForWizard(current.tour),
        wizard: { id: 'first-show', stepId: first.id },
        openWizard: 'first-show',
      }));
    });
  }, [enabled]);

  const nextWizardStep = useCallback(() => {
    if (session?.kind !== 'wizard') return;
    const steps = wizardById(session.id)?.steps ?? [];
    const following = steps[steps.findIndex((step) => step.id === session.stepId) + 1];
    if (following) startWizardStep(session.id, following.id);
  }, [session, startWizardStep]);

  const closeWizard = useCallback(() => {
    setState((current) => (current.wizard ? { ...current, wizard: undefined } : current));
  }, []);

  const backToHelp = useCallback(() => {
    app.current.go({ view: 'help' }, closeWizard);
  }, [closeWizard]);

  const goToCurrent = useCallback(() => {
    if (!session) return;
    const place = session.kind === 'tour' ? stepById(session.stepId)?.place : wizardStep(session.id, session.stepId)?.action?.place;
    if (place) app.current.go(place);
  }, [session]);

  const visit = useCallback((place: GuidePlace) => app.current.go(place), []);

  const dismissOffer = useCallback(() => {
    setState((current) => ({ ...current, offer: 'dismissed' }));
  }, []);

  const toggleChecked = useCallback((id: WizardId, stepId: string) => {
    setState((current) => {
      const ticked = current.checked[id] ?? [];
      const nextTicked = ticked.includes(stepId) ? ticked.filter((other) => other !== stepId) : [...ticked, stepId];
      return { ...current, checked: { ...current.checked, [id]: nextTicked } };
    });
  }, []);

  const setOpenWizard = useCallback((id: WizardId | undefined) => {
    setState((current) => ({ ...current, openWizard: id }));
  }, []);

  const checkConnections = useCallback(async () => {
    const count = app.current.countConnections;
    if (!count) return;
    setConnectionsBusy(true);
    setConnectionsError('');
    try {
      setAssistantConnections(await count());
    } catch {
      // The same sentence the AI assistants card in Settings uses.
      setConnectionsError('Couldn’t load connections. Check your connection and try again.');
    } finally {
      setConnectionsBusy(false);
    }
  }, []);

  const facts = useMemo(() => wizardFacts({
    shows,
    settings,
    links,
    lastBackupAt,
    ranShow: state.facts.ranShow === true,
    assistantConnections,
  }), [shows, settings, links, lastBackupAt, state.facts.ranShow, assistantConnections]);

  const context = useMemo<GuideContextInfo>(() => ({
    desktop,
    locked,
    native: isNativeShell(),
    view,
    selectedShowId,
    runShowOpen,
    sampleId,
    hasRealShow,
  }), [desktop, locked, view, selectedShowId, runShowOpen, sampleId, hasRealShow]);

  const api = useMemo<GuideApi>(() => ({
    enabled,
    reviewLabel,
    session,
    minimized,
    setMinimized,
    state,
    context,
    facts,
    closedNote,
    dismissClosedNote: () => setClosedAt(null),
    startTour,
    resumeTour,
    next,
    previous,
    endTour,
    finishTour,
    addSample,
    deleteSampleAfterTour,
    startWizardStep,
    nextWizardStep,
    closeWizard,
    backToHelp,
    goToCurrent,
    visit,
    dismissOffer,
    toggleChecked,
    setOpenWizard,
    checkConnections,
    connections: { busy: connectionsBusy, error: connectionsError, canCheck: !!countConnections },
  }), [
    enabled, reviewLabel, session, minimized, state, context, facts, closedNote, startTour, resumeTour, next, previous,
    endTour, finishTour, addSample, deleteSampleAfterTour, startWizardStep, nextWizardStep, closeWizard, backToHelp, goToCurrent, visit,
    dismissOffer, toggleChecked, setOpenWizard, checkConnections, connectionsBusy, connectionsError, countConnections,
  ]);

  return (
    <GuideContext.Provider value={api}>
      {children}
      {confirmDialog}
    </GuideContext.Provider>
  );
}

/** Whether a place is where the app already is. */
// eslint-disable-next-line react-refresh/only-export-components
export function atPlace(place: GuidePlace | undefined, context: GuideContextInfo): boolean {
  if (!place) return true;
  if (place.view !== context.view) return false;
  const which = placeShow(place);
  if (which === 'sample') return context.selectedShowId !== null && context.selectedShowId === context.sampleId;
  if (which === 'real') return context.selectedShowId !== null && context.selectedShowId !== context.sampleId;
  return true;
}

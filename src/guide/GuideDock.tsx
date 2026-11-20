/**
 * The guide's one card.
 *
 * A region docked to the bottom of the screen, never a dialog: nothing is
 * covered, nothing is trapped, and focus stays wherever the producer put it.
 * It says what the current step is about, outlines the real control, and
 * waits. The same card serves the tour and a wizard step.
 *
 * Inside Run Show it is a strip under the board's top bar instead, so it is
 * inside the board's own focus trap and never over the clock.
 */
import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { Icon } from '../components/Icon';
import { ProducerLock } from '../components/ProducerLock';
import { atPlace, useGuide, type GuideApi } from './GuideContext';
import { opensNewShow, placeShow } from './places';
import { applyOutline, clearOutline, focusableIn, resolveTarget, scrollClearOfCard } from './targets';
import { nextStepId, previousStepId, stepBody, stepById, stepNumber } from './tourEngine';
import { LAST_STEP_ID, LOCKED_FEATURE_LABELS, type LockedFeature } from './tourSteps';
import { stepDone, wizardById } from './wizards';
import './guide.css';

/** The stylesheet adds this much room under the page, so the last control can scroll clear of the card. */
const DOCK_HEIGHT_PROPERTY = '--guide-dock-h';
/** And how much of the bottom of the screen it takes, so the outline's scroll margin keeps the control above it. */
const DOCK_CLEAR_PROPERTY = '--guide-dock-clear';
const GUIDE_ON_CLASS = 'guide-on';

function subscribeOnline(notify: () => void): () => void {
  window.addEventListener('online', notify);
  window.addEventListener('offline', notify);
  return () => {
    window.removeEventListener('online', notify);
    window.removeEventListener('offline', notify);
  };
}

/** Whether the browser says it has a connection. */
// eslint-disable-next-line react-refresh/only-export-components
export function useOnline(): boolean {
  return useSyncExternalStore(subscribeOnline, () => navigator.onLine !== false, () => true);
}

interface Outlined {
  key: string;
  canFocus: boolean;
}

/**
 * Outline the step's control for as long as the step shows.
 *
 * Looked for again every 300ms rather than once: the control may mount a
 * frame late (a section opening), remount, or change with the breakpoint,
 * and React does not strip an attribute it did not render. Scrolled into
 * view when it is first found, and again only if a better match turns up in
 * the first couple of seconds, never on every look, so the producer can
 * scroll away.
 *
 * Then kept clear of the card while the page settles: the page's own
 * scroll-to-top on a change of view, or the card growing to fit a longer
 * step, can leave the control under it. Checked once the page has stopped
 * scrolling, for the first few seconds of a step and again for a moment
 * after the card changes height, and never once the producer has scrolled
 * the wheel or swiped. It only ever moves the control out from under the
 * card, never anywhere else.
 */
function useOutline(stepKey: string | null, targets: readonly string[], pageBlock: ScrollLogicalPosition): { canFocus: boolean; jump: () => void } {
  const [outlined, setOutlined] = useState<Outlined | null>(null);
  const selectors = targets.join('\n');
  useEffect(() => {
    if (!stepKey || !selectors) return;
    const list = selectors.split('\n');
    let current: HTMLElement | null = null;
    let scrolledTo: HTMLElement | null = null;
    let looks = 0;
    let settleUntil = SETTLE_LOOKS;
    let cardHeight = dockHeight();
    let lastScroll = 0;
    let producerScrolled = false;
    const reduced = prefersReducedMotion();
    const look = () => {
      looks += 1;
      const found = resolveTarget(list);
      if (found !== current) {
        clearOutline(current);
        current = found;
        if (found) applyOutline(found);
        setOutlined({ key: stepKey, canFocus: !!found && focusableIn(found) !== null });
        settleUntil = Math.max(settleUntil, looks + RESETTLE_LOOKS);
      }
      if (found && found !== scrolledTo && (scrolledTo === null || looks <= 8)) {
        scrolledTo = found;
        // The live board scrolls inside itself: only as far as it takes to see the control.
        const block = found.closest('.run-show') ? 'nearest' : pageBlock;
        found.scrollIntoView({ block, behavior: reduced ? 'auto' : 'smooth' });
        return;
      }
      if (!found || producerScrolled) return;
      const height = dockHeight();
      if (height !== cardHeight) {
        cardHeight = height;
        settleUntil = Math.max(settleUntil, looks + RESETTLE_LOOKS);
      }
      // Only once the page is still, so a smooth scroll is not cut short.
      if (looks <= settleUntil && performance.now() - lastScroll > SCROLL_IDLE_MS) {
        scrollClearOfCard(found, reduced ? 'auto' : 'smooth');
      }
    };
    const onScroll = () => { lastScroll = performance.now(); };
    const onProducerScroll = () => { producerScrolled = true; };
    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    window.addEventListener('wheel', onProducerScroll, { passive: true });
    window.addEventListener('touchmove', onProducerScroll, { passive: true });
    // Not at once: the page's own scroll-to-top on a change of view runs
    // after this effect and would undo the scroll.
    const first = window.setTimeout(look, 60);
    const timer = window.setInterval(look, 300);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
      document.removeEventListener('scroll', onScroll, { capture: true });
      window.removeEventListener('wheel', onProducerScroll);
      window.removeEventListener('touchmove', onProducerScroll);
      clearOutline(current);
    };
  }, [stepKey, selectors, pageBlock]);

  return {
    canFocus: !!stepKey && outlined?.key === stepKey && outlined.canFocus,
    jump: () => {
      const target = resolveTarget(selectors.split('\n'));
      if (!target) return;
      // Into view and out from under the card before focus lands on it, so
      // focus never goes to a control the producer cannot see.
      target.scrollIntoView({ block: 'nearest', behavior: 'auto' });
      scrollClearOfCard(target, 'auto');
      (focusableIn(target) ?? target).focus({ preventScroll: true });
    },
  };
}

/** Looks (300ms apart) at the start of a step in which the control is kept clear of the card. */
const SETTLE_LOOKS = 10;
/** And again after the control or the card's height changes. */
const RESETTLE_LOOKS = 5;
/** How long the page has to be still before the control is moved. */
const SCROLL_IDLE_MS = 200;

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** The card's measured height, as useDockRoom last set it. */
function dockHeight(): string {
  return document.documentElement.style.getPropertyValue(DOCK_HEIGHT_PROPERTY);
}

/** Tell the stylesheet how tall the card is, and that there is one. */
function useDockRoom(ref: React.RefObject<HTMLElement | null>, active: boolean): void {
  useEffect(() => {
    const dock = ref.current;
    if (!active || !dock) return;
    const root = document.documentElement;
    const measure = () => {
      const rect = dock.getBoundingClientRect();
      // Hidden under a dialog: it is coming back, so the room stays.
      if (rect.height <= 0) return;
      root.style.setProperty(DOCK_HEIGHT_PROPERTY, `${Math.round(rect.height)}px`);
      // From the card's top to the bottom of the screen: the card, and the nav under it on a phone.
      root.style.setProperty(DOCK_CLEAR_PROPERTY, `${Math.max(0, Math.round(window.innerHeight - rect.top))}px`);
    };
    document.body.classList.add(GUIDE_ON_CLASS);
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(dock);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
      document.body.classList.remove(GUIDE_ON_CLASS);
      root.style.removeProperty(DOCK_HEIGHT_PROPERTY);
      root.style.removeProperty(DOCK_CLEAR_PROPERTY);
    };
  }, [ref, active]);
}

/** What the dock is showing: the card, the folded pill, the "Tour closed" note, or nothing. */
type Showing = 'card' | 'pill' | 'note' | 'none';
/** Where focus goes once the control the producer pressed is replaced. */
type Handoff = 'pill' | 'fold' | 'away';

function usable(element: Element | null): element is HTMLElement {
  return element instanceof HTMLElement
    && element.isConnected
    && element.getClientRects().length > 0
    && element.closest('[inert], .guide-dock') === null;
}

/** Where focus returns when the guide goes: where the producer last was, else the page's heading, else the board. */
function returnPoint(where: 'app' | 'runshow', last: HTMLElement | null): HTMLElement | null {
  const board = document.querySelector<HTMLElement>('.run-show');
  if (where === 'runshow') return last && usable(last) && board?.contains(last) ? last : board;
  if (usable(last) && !last.closest('.run-show')) return last;
  const heading = document.querySelector<HTMLElement>('.app-main h1');
  if (heading) {
    // A heading is not in the tab order: focusable from script only, so Tab carries on from it.
    if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
    return heading;
  }
  return document.querySelector<HTMLElement>('.app-main');
}

/**
 * Keep the keyboard's place when the card changes under it.
 *
 * Folding the card, opening it again and leaving the guide all replace the
 * button that was pressed, which would drop focus to the page's start. Focus
 * goes to what took its place: the pill, the fold button, the note's OK, or
 * back to where the producer last was outside the card. Only ever after a
 * press on the card itself, and only when focus has actually been lost, so
 * it is never taken from anywhere the producer put it.
 */
function useFocusHandoff(where: 'app' | 'runshow', showing: Showing) {
  const pillRef = useRef<HTMLButtonElement>(null);
  const foldRef = useRef<HTMLButtonElement>(null);
  const okRef = useRef<HTMLButtonElement>(null);
  const pending = useRef<Handoff | null>(null);
  const lastOutside = useRef<HTMLElement | null>(null);

  // Where the producer was before the card, and each time they leave it.
  const present = showing !== 'none';
  useEffect(() => {
    if (!present) return;
    const note = (element: EventTarget | null) => {
      if (element instanceof HTMLElement && element !== document.body && !element.closest('.guide-dock')) lastOutside.current = element;
    };
    note(document.activeElement);
    const onFocus = (event: FocusEvent) => note(event.target);
    document.addEventListener('focusin', onFocus);
    return () => document.removeEventListener('focusin', onFocus);
  }, [present]);

  useEffect(() => {
    const want = pending.current;
    if (!want) return;
    // Still on the card: leaving was asked about first (unsaved Settings), or has not happened yet.
    if (want === 'away' && showing === 'card') return;
    if (want === 'pill' && showing !== 'pill') return;
    if (want === 'fold' && showing !== 'card') return;
    pending.current = null;
    const active = document.activeElement;
    const lost = !active || active === document.body || !active.isConnected || active.closest('.guide-dock') !== null;
    if (!lost) return;
    const to = want === 'pill' ? pillRef.current
      : want === 'fold' ? foldRef.current
        : okRef.current ?? returnPoint(where, lastOutside.current);
    to?.focus();
  });

  return {
    pillRef,
    foldRef,
    okRef,
    /** Call from the card's own button before the change it makes. */
    handOff: (to: Handoff) => { pending.current = to; },
  };
}

/** What the card shows, whichever guide it is showing. */
interface Card {
  /** Changes with the step, so the outline starts over. */
  key: string;
  progress: string;
  title: string;
  body: string;
  notes: string[];
  lock?: LockedFeature;
  done: boolean;
  /** Empty when there is nothing to outline here: off the step's page, or the page is missing. */
  targets: readonly string[];
  /** "Go to this step" is offered. */
  offPage: boolean;
  /** The way out, beside the fold button at the top of the card, on every step. */
  exit: { label: string; leave: () => void };
  /** `leaving` is called first by a button that ends the guide, so focus has somewhere to go. */
  buttons: (bodyId: string, outline: { canFocus: boolean; jump: () => void }, leaving: () => void) => React.ReactNode;
}

function tourCard(guide: GuideApi, stepId: string): Card | null {
  const { context } = guide;
  const step = stepById(stepId);
  if (!step) return null;
  const { n, total } = stepNumber(step.id, context.runShowOpen);
  const progress = `Tour: step ${n} of ${total}`;
  const exit = { label: 'End tour', leave: guide.endTour };

  if (placeShow(step.place) === 'sample' && !context.sampleId) {
    return {
      key: `tour:${step.id}:gone`,
      progress,
      title: 'The sample show is gone',
      body: 'Add it again to carry on, or end the tour here.',
      notes: [],
      done: false,
      targets: [],
      offPage: false,
      exit,
      buttons: () => (
        <button type="button" className="btn btn--primary btn--sm" onClick={guide.addSample}>Add the sample show</button>
      ),
    };
  }

  const offPage = step.surface === 'app' && !atPlace(step.place, context);
  const last = step.id === LAST_STEP_ID;
  const hasPrevious = previousStepId(step.id) !== null;
  // Null on the last step inside the live board: closing the board is the way on.
  const hasNext = nextStepId(step.id, context.runShowOpen) !== null;
  return {
    key: `tour:${step.id}`,
    progress,
    title: step.title,
    body: stepBody(step, context),
    notes: [],
    lock: context.locked ? step.locked?.feature : undefined,
    done: false,
    targets: offPage ? [] : step.targets,
    offPage,
    exit,
    buttons: (bodyId, outline, leaving) => (
      <>
        {hasPrevious && <button type="button" className="btn btn--ghost btn--sm" onClick={guide.previous}>Previous step</button>}
        {last ? (
          <>
            <button type="button" className="btn btn--primary btn--sm" onClick={() => { leaving(); guide.finishTour(); }}>Finish tour</button>
            {context.sampleId && (
              <button type="button" className="btn btn--secondary btn--sm" onClick={() => { leaving(); guide.finishTour({ deleteSample: true }); }}>
                Delete the sample show
              </button>
            )}
          </>
        ) : (
          <button
            type="button"
            className="btn btn--primary btn--sm"
            // Not `disabled`: that would drop the keyboard's place in the board.
            aria-disabled={hasNext ? undefined : true}
            aria-describedby={hasNext ? undefined : bodyId}
            onClick={hasNext ? guide.next : undefined}
          >
            Next step
          </button>
        )}
        {outline.canFocus && <button type="button" className="btn btn--secondary btn--sm" onClick={outline.jump}>Jump to the control</button>}
        {offPage && <button type="button" className="btn btn--secondary btn--sm" onClick={guide.goToCurrent}>Go to this step</button>}
      </>
    ),
  };
}

function wizardCard(guide: GuideApi, id: Parameters<typeof wizardById>[0], stepId: string, online: boolean): Card | null {
  const { context } = guide;
  const wizard = wizardById(id);
  const index = wizard?.steps.findIndex((step) => step.id === stepId) ?? -1;
  if (!wizard || index < 0) return null;
  const step = wizard.steps[index];
  const place = step.action?.place;
  const needsShow = placeShow(place) === 'real' && !context.hasRealShow;
  // The New show form closes itself once the show is made; "back" would only reopen it.
  const offPage = !!place && !needsShow && !opensNewShow(place) && !atPlace(place, context);
  const notes: string[] = [];
  if (context.native && step.nativeText) notes.push(step.nativeText);
  if (needsShow) notes.push('This step needs a show of your own. Make one first.');
  if (step.online && !online) notes.push('You are offline. This step needs a connection.');
  const hasNext = index < wizard.steps.length - 1;
  return {
    key: `wizard:${wizard.id}:${step.id}`,
    progress: `${wizard.short}: step ${index + 1} of ${wizard.steps.length}`,
    title: step.title,
    body: step.text,
    notes,
    lock: context.locked ? step.locked : undefined,
    done: stepDone(wizard.id, step.id, guide.facts, guide.state.checked[wizard.id] ?? []) === true,
    targets: offPage || needsShow ? [] : step.action?.targets ?? [],
    offPage,
    exit: { label: 'Close guide', leave: guide.closeWizard },
    buttons: (_bodyId, outline, leaving) => (
      <>
        {hasNext && <button type="button" className="btn btn--primary btn--sm" onClick={guide.nextWizardStep}>Next step</button>}
        {outline.canFocus && <button type="button" className="btn btn--secondary btn--sm" onClick={outline.jump}>Jump to the control</button>}
        {offPage && <button type="button" className="btn btn--secondary btn--sm" onClick={guide.goToCurrent}>Go to this step</button>}
        <button type="button" className={`btn btn--sm ${hasNext ? 'btn--secondary' : 'btn--primary'}`} onClick={() => { leaving(); guide.backToHelp(); }}>Back to Help &amp; setup</button>
      </>
    ),
  };
}

export function GuideDock({ where }: { where: 'app' | 'runshow' }) {
  const guide = useGuide();
  const online = useOnline();
  const bodyId = useId();
  const dockRef = useRef<HTMLElement>(null);
  const { session, context, minimized } = guide;

  let card: Card | null = null;
  if (guide.enabled && session) {
    if (session.kind === 'tour') {
      const inBoard = stepById(session.stepId)?.surface === 'runshow';
      // One card at a time: the board's steps in the board, the rest on the page.
      if (where === 'runshow' ? inBoard : !inBoard && !context.runShowOpen) card = tourCard(guide, session.stepId);
    } else if (where === 'app' && !context.runShowOpen) {
      card = wizardCard(guide, session.id, session.stepId, online);
    }
  }
  const note = where === 'app' && !card && guide.closedNote;

  // On a phone the card takes the bottom of the screen, so the control goes
  // to the top of what is left; on a laptop there is room to centre it.
  const outline = useOutline(card?.key ?? null, card?.targets ?? [], context.desktop ? 'center' : 'start');
  useDockRoom(dockRef, where === 'app' && (card !== null || note));
  const showing: Showing = note ? 'note' : !card ? 'none' : minimized ? 'pill' : 'card';
  const { pillRef, foldRef, okRef, handOff } = useFocusHandoff(where, showing);

  const className = `guide-dock guide-dock--${where}`;

  if (note) {
    return (
      <section ref={dockRef} className={`${className} guide-dock--note`} role="region" aria-label="Guide">
        <p className="guide-dock__body" role="status">Tour closed. Pick it up again from More, then Help &amp; setup.</p>
        <div className="guide-dock__actions">
          <button
            ref={okRef}
            type="button"
            className="btn btn--secondary btn--sm"
            onClick={() => {
              handOff('away');
              guide.dismissClosedNote();
            }}
          >
            OK
          </button>
        </div>
      </section>
    );
  }
  if (!card) return null;

  if (minimized) {
    return (
      <section ref={dockRef} className={`${className} guide-dock--min`} role="region" aria-label="Guide">
        <button
          ref={pillRef}
          type="button"
          className="guide-dock__pill"
          aria-expanded={false}
          onClick={() => {
            handOff('fold');
            guide.setMinimized(false);
          }}
        >
          <span>{card.progress}</span>
          <span className="visually-hidden">. Show the guide card</span>
          <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M5 12.5 10 7.5l5 5" />
          </svg>
        </button>
      </section>
    );
  }

  return (
    <section ref={dockRef} className={className} role="region" aria-label="Guide">
      <div className="guide-dock__head">
        <p className="guide-dock__progress">{card.progress}</p>
        <button
          type="button"
          className="guide-dock__exit"
          onClick={() => {
            handOff('away');
            card.exit.leave();
          }}
        >
          {card.exit.label}
        </button>
        <button
          ref={foldRef}
          type="button"
          className="guide-dock__min"
          aria-expanded={true}
          aria-label="Hide the guide card"
          onClick={() => {
            handOff('pill');
            guide.setMinimized(true);
          }}
        >
          <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M5 7.5 10 12.5l5-5" />
          </svg>
        </button>
      </div>
      <div className="guide-dock__text" aria-live="polite" aria-atomic="true">
        <h2 className="guide-dock__title">{card.title}</h2>
        <p className="guide-dock__body" id={bodyId}>{card.body}</p>
        {card.notes.map((line) => <p key={line} className="guide-dock__note">{line}</p>)}
        {card.done && (
          <p className="guide-dock__done">
            <Icon name="check" size={15} />
            <span>Done</span>
          </p>
        )}
      </div>
      {card.lock && <ProducerLock feature={LOCKED_FEATURE_LABELS[card.lock]} compact />}
      <div className="guide-dock__actions">{card.buttons(bodyId, outline, () => handOff('away'))}</div>
    </section>
  );
}

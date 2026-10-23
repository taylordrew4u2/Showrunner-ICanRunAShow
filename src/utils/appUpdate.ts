/**
 * A new build, waiting for a good moment.
 *
 * The service worker used to take over and reload the page the instant it had
 * finished downloading a deploy — which, on venue wifi, was minutes after the
 * app was opened, often with the show running. The board came back at cue
 * one, silent, with the clock at zero. Now the new version waits, and the app
 * says it is there; reloading is the producer's call, and never mid-show.
 *
 * The call is made for one tab. The new worker takes over every open tab the
 * moment any one of them switches to it, and the registration this replaced
 * (vite-plugin-pwa's) reloaded each of them when that happened — so Reload on
 * the dashboard in one tab restarted the board running in the next. Now only
 * the tab that asked reloads; the others say a new version is ready and wait
 * for the producer, as they did before anyone pressed anything.
 *
 * A link someone was sent — to sign, to fill in, to watch — has no app around
 * it to say any of that in, so a performer who kept opening one got the build
 * they first opened it with. Those pages take the new version themselves, as
 * they open, and only before anything has been typed into them: a contract
 * half filled in is left alone until the next visit. So is a version that
 * arrives while the page is open, whatever is on it.
 */
type Listener = (ready: boolean) => void;

let apply: (() => void) | null = null;
const listeners = new Set<Listener>();

/** Called by the registration when a new version is installed and waiting. */
export function updateReady(applyUpdate: () => void): void {
  apply = applyUpdate;
  for (const listener of listeners) listener(true);
}

export function isUpdateReady(): boolean {
  return apply !== null;
}

/** Hear about a waiting version. Returns the unsubscribe. */
export function onUpdateReady(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Switch to the waiting version now: the page reloads. */
export function applyUpdate(): void {
  apply?.();
}

/**
 * Whether a tab reloads when a new worker takes it over.
 *
 * Only the tab that asked for the switch, and never one with Run Show open,
 * whatever the path that got it there. Every other tab keeps running the build
 * it has and offers the reload instead.
 */
export function shouldReloadOnControllerChange({ initiatedHere, runShowOpen }: {
  initiatedHere: boolean;
  runShowOpen: boolean;
}): boolean {
  return initiatedHere && !runShowOpen;
}

/**
 * Whether a shared-link page switches to a waiting version by itself.
 *
 * Only a version that was already waiting when the page opened. One that
 * finishes downloading while the page is in use waits for the next visit:
 * the live link is what the PA laptop plays the walk-ons from, nobody types
 * into it, and a reload mid-show would leave it silent until someone tapped
 * the screen again.
 *
 * Only before anything has been typed into it: a signer halfway through a
 * contract is not reloaded out of it, and gets the new version on their next
 * visit instead. And only once — the page it reloads into does not do it
 * again, so a worker that never manages to take over cannot keep reloading it.
 */
export function shouldAutoApplyOnLinkPage({ waitingAtLoad, dirty, alreadyReloaded }: {
  waitingAtLoad: boolean;
  dirty: boolean;
  alreadyReloaded: boolean;
}): boolean {
  return waitingAtLoad && !dirty && !alreadyReloaded;
}

const LINK_RELOADED_KEY = 'showrunner:linkUpdateReloaded';

interface Remembering {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * Whether the last load of this tab was a link page reloading for an update.
 * Forgotten as it is read, so the visit after this one may update again.
 */
export function takeLinkReloadMark(storage: Remembering | null): boolean {
  if (!storage) return false;
  try {
    if (storage.getItem(LINK_RELOADED_KEY) === null) return false;
    storage.removeItem(LINK_RELOADED_KEY);
    return true;
  } catch {
    // Can't tell, so assume it did. Wrong this way, the page stays on the old
    // build for one visit; wrong the other way, it could reload in a loop.
    return true;
  }
}

/** Note that a link page is about to reload for an update. False when it can't be noted. */
export function markLinkReload(storage: Remembering | null): boolean {
  if (!storage) return false;
  try {
    storage.setItem(LINK_RELOADED_KEY, '1');
    return true;
  } catch {
    return false;
  }
}

/** Workbox's message, which the generated worker answers by taking over. */
const SKIP_WAITING = { type: 'SKIP_WAITING' };

/** A new worker, installed and waiting to take over. */
export interface WaitingWorker {
  readonly state: string;
  postMessage(message: unknown): void;
  addEventListener(type: 'statechange', listener: () => void): void;
}

/** What following an update needs from the browser. The tests stand fakes in for it. */
export interface UpdateEnv {
  /** A link someone was sent (see sharedLinkRoute), rather than the app. */
  linkPage: boolean;
  /**
   * Whether a worker served this page. One that did is running the build that
   * worker had. One that did not came from the network, so it is already the
   * newest build there is, and no takeover will ever be announced to it.
   */
  controlled: boolean;
  /**
   * The worker waiting now. Asked when it is needed rather than remembered:
   * another tab may have switched to it since, or a newer one replaced it.
   */
  waitingWorker(): WaitingWorker | null;
  runShowOpen(): boolean;
  /** Where a link page notes that it reloaded. Null when the browser keeps nothing. */
  storage: Remembering | null;
  /** Offer the reload (see updateReady). */
  offer(apply: () => void): void;
  reload(): void;
}

export interface UpdateWatch {
  /**
   * A new version has installed and is waiting. `atLoad` when it was already
   * waiting as the page opened, rather than finishing during this visit.
   */
  waiting(worker: WaitingWorker, when?: { atLoad?: boolean }): void;
  /** A new worker has taken this page over. */
  controllerChanged(): void;
  /** Something was typed, ticked or chosen on the page. */
  started(): void;
}

/** The decisions above, followed for one page from the moment it loads. */
export function watchUpdates(env: UpdateEnv): UpdateWatch {
  // Reload was pressed in this tab.
  let pressed = false;
  // This link page asked for the switch by itself.
  let autoApplied = false;
  let dirty = false;
  let reloading = false;
  const reloadedForUpdate = env.linkPage && takeLinkReloadMark(env.storage);

  const reload = () => {
    if (reloading) return;
    reloading = true;
    env.reload();
  };

  const tookOver = () => {
    // A link page that has been typed into since it asked no longer counts as
    // having asked: the switch goes ahead, the reload does not.
    const initiatedHere = pressed || (autoApplied && !dirty);
    if (shouldReloadOnControllerChange({ initiatedHere, runShowOpen: env.runShowOpen() })) reload();
    // Running the old build under the new worker. It works, and goes on
    // working; it is just not the newest, which is what the prompt says.
    else env.offer(reload);
  };

  // `onActive` is for a page no worker served, which is never told about the
  // takeover and so has to watch the worker itself.
  const activate = (worker: WaitingWorker, onActive?: () => void) => {
    if (onActive) {
      worker.addEventListener('statechange', () => {
        if (worker.state === 'activated') onActive();
      });
    }
    worker.postMessage(SKIP_WAITING);
  };

  // What the prompt's Reload does while a new version is waiting.
  const switchNow = () => {
    pressed = true;
    const worker = env.waitingWorker();
    // Nothing waiting any more: it went to another tab's Reload, or was
    // replaced. Either way a reload is what was asked for, and it is all that
    // is needed.
    if (!worker) {
      reload();
      return;
    }
    activate(worker, env.controlled ? undefined : tookOver);
  };

  return {
    waiting(worker, { atLoad = false } = {}) {
      env.offer(switchNow);
      if (!env.linkPage || autoApplied) return;
      if (!shouldAutoApplyOnLinkPage({ waitingAtLoad: atLoad, dirty, alreadyReloaded: reloadedForUpdate })) return;
      // Noted before the reload it leads to, so the page it reloads into does
      // not do it again. Nowhere to note it means no way to stop a loop, so no
      // reload. A page no worker served is not reloaded at all — it is already
      // the newest build — so it has nothing to note.
      if (env.controlled && !markLinkReload(env.storage)) return;
      autoApplied = true;
      activate(worker);
    },
    controllerChanged() {
      if (env.controlled) tookOver();
    },
    started() {
      dirty = true;
    },
  };
}

/**
 * Register the service worker and follow its updates.
 *
 * In place of vite-plugin-pwa's registerSW, whose prompt mode reloads every
 * tab that saw the update as soon as any one of them applies it (see the top
 * of this file). The same worker, scope and timing as that registration, so
 * the iOS shell, which runs this worker too, follows the same rules.
 */
export function registerAppUpdates({ linkPage }: { linkPage: boolean }): void {
  // The plugin builds no worker for the dev server.
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  const container = navigator.serviceWorker;
  let registration: ServiceWorkerRegistration | undefined;
  let storage: Remembering | null = null;
  try {
    storage = window.sessionStorage;
  } catch {
    /* blocked storage: a link page never reloads by itself, see markLinkReload */
  }
  const watch = watchUpdates({
    linkPage,
    // Read first, before anything has had the chance to take the page over.
    controlled: container.controller !== null,
    waitingWorker: () => registration?.waiting ?? null,
    // As App asks it, for the same reason: the board is on screen.
    runShowOpen: () => document.querySelector('.run-show') !== null,
    storage,
    offer: updateReady,
    reload: () => window.location.reload(),
  });
  // From the start: another tab can switch before this one has registered.
  container.addEventListener('controllerchange', () => watch.controllerChanged());
  if (linkPage) {
    // Captured, so a field that stops its own events still counts.
    document.addEventListener('input', () => watch.started(), true);
    document.addEventListener('change', () => watch.started(), true);
    // What was waiting as the page opened, read off the registration as it
    // stands. Not from the register() below: that queues behind any update
    // the browser is installing, so a version that only finished during this
    // visit would come back looking as if it had been waiting all along.
    void container.getRegistration()
      .then((existing) => {
        if (existing?.waiting) watch.waiting(existing.waiting, { atLoad: true });
      })
      .catch(() => {
        /* nothing to ask: nothing waiting */
      });
  }
  // Where vite-plugin-pwa writes the worker: its default file name, at the base.
  const base = import.meta.env.BASE_URL;
  void import('workbox-window')
    .then(async ({ Workbox }) => {
      const wb = new Workbox(`${base}sw.js`, { scope: base });
      // A version left waiting by an earlier visit is reported as soon as the
      // registration is back, and before `registration` is set here — which
      // is why the worker travels with the event.
      wb.addEventListener('waiting', (event) => {
        if (event.sw) watch.waiting(event.sw);
      });
      registration = await wb.register({ immediate: true });
    })
    .catch(() => {
      // No worker this time — a private window, blocked storage, a failed
      // fetch. The app runs from the network, as it does on a first visit.
    });
}

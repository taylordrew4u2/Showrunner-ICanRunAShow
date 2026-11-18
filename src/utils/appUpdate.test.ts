import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  markLinkReload,
  shouldAutoApplyOnLinkPage,
  shouldReloadOnControllerChange,
  takeLinkReloadMark,
  watchUpdates,
  type UpdateEnv,
} from './appUpdate';

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => { map.set(key, value); },
    removeItem: (key: string) => { map.delete(key); },
  };
}

const brokenStorage = {
  getItem: (): string | null => { throw new Error('SecurityError'); },
  setItem: () => { throw new Error('SecurityError'); },
  removeItem: () => { throw new Error('SecurityError'); },
};

function fakeWorker() {
  const changes: Array<() => void> = [];
  const worker = {
    state: 'installed',
    messages: [] as unknown[],
    postMessage(message: unknown) { worker.messages.push(message); },
    addEventListener(_type: 'statechange', listener: () => void) { changes.push(listener); },
    become(state: string) {
      worker.state = state;
      for (const change of changes) change();
    },
  };
  return worker;
}

const SKIP_WAITING = { type: 'SKIP_WAITING' };

/** Already waiting as the page opened. */
const AT_LOAD = { atLoad: true };

/** One page: a tab of the app, or a link someone opened. */
function page(overrides: Partial<UpdateEnv> & { waiting?: ReturnType<typeof fakeWorker> | null } = {}) {
  let offered: (() => void) | null = null;
  let runShow = false;
  const { waiting = null, ...rest } = overrides;
  const env: UpdateEnv = {
    linkPage: false,
    controlled: true,
    waitingWorker: () => waiting,
    runShowOpen: () => runShow,
    storage: memoryStorage(),
    offer: (apply) => { offered = apply; },
    reload: vi.fn(),
    ...rest,
  };
  const watch = watchUpdates(env);
  return {
    env,
    watch,
    reload: env.reload as ReturnType<typeof vi.fn>,
    /** Whether the prompt is up. */
    offered: () => offered !== null,
    /** Press the prompt's Reload. */
    press: () => { offered?.(); },
    openRunShow: () => { runShow = true; },
    closeRunShow: () => { runShow = false; },
  };
}

describe('who reloads when a new worker takes a tab over', () => {
  it('reloads the tab that asked for it', () => {
    expect(shouldReloadOnControllerChange({ initiatedHere: true, runShowOpen: false })).toBe(true);
  });

  it('never reloads a tab that did not ask', () => {
    expect(shouldReloadOnControllerChange({ initiatedHere: false, runShowOpen: false })).toBe(false);
  });

  it('never reloads a tab with Run Show open, even one that asked', () => {
    expect(shouldReloadOnControllerChange({ initiatedHere: true, runShowOpen: true })).toBe(false);
    expect(shouldReloadOnControllerChange({ initiatedHere: false, runShowOpen: true })).toBe(false);
  });
});

describe('when a sent link takes a waiting version by itself', () => {
  it('takes one that was waiting as it opened, before anything has been typed', () => {
    expect(shouldAutoApplyOnLinkPage({ waitingAtLoad: true, dirty: false, alreadyReloaded: false })).toBe(true);
  });

  it('never one that arrives while the page is open', () => {
    expect(shouldAutoApplyOnLinkPage({ waitingAtLoad: false, dirty: false, alreadyReloaded: false })).toBe(false);
  });

  it('never once someone has started filling it in', () => {
    expect(shouldAutoApplyOnLinkPage({ waitingAtLoad: true, dirty: true, alreadyReloaded: false })).toBe(false);
  });

  it('never twice in a row', () => {
    expect(shouldAutoApplyOnLinkPage({ waitingAtLoad: true, dirty: false, alreadyReloaded: true })).toBe(false);
  });
});

describe('the note a link page leaves when it reloads for an update', () => {
  it('is read once, by the load that follows', () => {
    const storage = memoryStorage();
    expect(takeLinkReloadMark(storage)).toBe(false);
    expect(markLinkReload(storage)).toBe(true);
    expect(takeLinkReloadMark(storage)).toBe(true);
    expect(takeLinkReloadMark(storage)).toBe(false);
  });

  it('cannot be left where the browser keeps nothing', () => {
    expect(markLinkReload(null)).toBe(false);
    expect(markLinkReload(brokenStorage)).toBe(false);
  });

  it('is assumed when it cannot be read, so a page can never reload in a loop', () => {
    expect(takeLinkReloadMark(brokenStorage)).toBe(true);
  });
});

describe('a tab of the app when a new version is waiting', () => {
  it('offers the reload and takes nothing by itself', () => {
    const worker = fakeWorker();
    const tab = page({ waiting: worker });
    tab.watch.waiting(worker);
    expect(tab.offered()).toBe(true);
    expect(worker.messages).toEqual([]);
    expect(tab.reload).not.toHaveBeenCalled();
  });

  it('switches when Reload is pressed, and reloads once the new version has taken over', () => {
    const worker = fakeWorker();
    const tab = page({ waiting: worker });
    tab.watch.waiting(worker);
    tab.press();
    expect(worker.messages).toEqual([SKIP_WAITING]);
    // Not before: the reload would be answered by the worker being replaced.
    expect(tab.reload).not.toHaveBeenCalled();
    tab.watch.controllerChanged();
    expect(tab.reload).toHaveBeenCalledTimes(1);
  });

  it('does not reload a second tab when Reload is pressed in the first', () => {
    // The producer pressed Reload on the dashboard on the laptop, with the
    // board running in the next tab. Every tab is taken over at once; only the
    // one that asked reloads.
    const worker = fakeWorker();
    const dashboard = page({ waiting: worker });
    const board = page({ waiting: worker });
    dashboard.watch.waiting(worker);
    board.watch.waiting(worker);
    board.openRunShow();

    dashboard.press();
    dashboard.watch.controllerChanged();
    board.watch.controllerChanged();

    expect(dashboard.reload).toHaveBeenCalledTimes(1);
    expect(board.reload).not.toHaveBeenCalled();
    expect(board.offered()).toBe(true);
  });

  it('leaves another tab running and offers the reload there, which then only reloads', () => {
    const worker = fakeWorker();
    const other = page({ waiting: worker });
    other.watch.waiting(worker);
    other.watch.controllerChanged();
    expect(other.reload).not.toHaveBeenCalled();
    expect(other.offered()).toBe(true);

    // The new version is already in charge; there is nothing left to switch.
    const before = worker.messages.length;
    other.press();
    expect(worker.messages.length).toBe(before);
    expect(other.reload).toHaveBeenCalledTimes(1);
  });

  it('offers the reload in a tab taken over without ever having seen the version wait', () => {
    const tab = page();
    tab.watch.controllerChanged();
    expect(tab.reload).not.toHaveBeenCalled();
    expect(tab.offered()).toBe(true);
  });

  it('never reloads a tab with Run Show open, even if Reload was pressed there', () => {
    const worker = fakeWorker();
    const tab = page({ waiting: worker });
    tab.watch.waiting(worker);
    tab.press();
    tab.openRunShow();
    tab.watch.controllerChanged();
    expect(tab.reload).not.toHaveBeenCalled();
    expect(tab.offered()).toBe(true);
  });

  it('reloads when Reload is pressed after the waiting version has gone', () => {
    const worker = fakeWorker();
    const tab = page({ waiting: null });
    tab.watch.waiting(worker);
    tab.press();
    expect(tab.reload).toHaveBeenCalledTimes(1);
  });

  it('reloads a page no worker served once the new version is active, since it is never told of a takeover', () => {
    const worker = fakeWorker();
    const tab = page({ waiting: worker, controlled: false });
    tab.watch.waiting(worker);
    tab.press();
    expect(worker.messages).toEqual([SKIP_WAITING]);
    tab.watch.controllerChanged();
    expect(tab.reload).not.toHaveBeenCalled();
    worker.become('activating');
    expect(tab.reload).not.toHaveBeenCalled();
    worker.become('activated');
    expect(tab.reload).toHaveBeenCalledTimes(1);
  });

  it('reloads once, however many times it is told', () => {
    const worker = fakeWorker();
    const tab = page({ waiting: worker });
    tab.watch.waiting(worker);
    tab.press();
    tab.watch.controllerChanged();
    tab.watch.controllerChanged();
    expect(tab.reload).toHaveBeenCalledTimes(1);
  });
});

describe('the producer app applying an update at a safe idle moment', () => {
  it('defaults to the manual prompt without an app-provided safety check', () => {
    const worker = fakeWorker();
    const tab = page({ waiting: worker });
    tab.watch.waiting(worker);
    tab.watch.idle();
    expect(worker.messages).toEqual([]);
    expect(tab.offered()).toBe(true);
    expect(tab.reload).not.toHaveBeenCalled();
  });

  it('activates at safe idle and reloads its own tab only after takeover', () => {
    const worker = fakeWorker();
    const tab = page({ waiting: worker, canAutoApply: () => true });
    tab.watch.waiting(worker);
    tab.watch.idle();
    expect(worker.messages).toEqual([SKIP_WAITING]);
    expect(tab.reload).not.toHaveBeenCalled();
    tab.watch.controllerChanged();
    expect(tab.reload).toHaveBeenCalledTimes(1);
  });

  it('does not activate while edits or saves are unsafe, and can try when they settle', () => {
    let clean = false;
    const worker = fakeWorker();
    const tab = page({ waiting: worker, canAutoApply: () => clean });
    tab.watch.waiting(worker);
    tab.watch.idle();
    expect(worker.messages).toEqual([]);
    clean = true;
    tab.watch.idle();
    expect(worker.messages).toEqual([SKIP_WAITING]);
  });

  it('never activates while Run Show is open even if the app safety callback says yes', () => {
    const worker = fakeWorker();
    const tab = page({ waiting: worker, canAutoApply: () => true });
    tab.watch.waiting(worker);
    tab.openRunShow();
    tab.watch.idle();
    expect(worker.messages).toEqual([]);
    expect(tab.offered()).toBe(true);
  });

  it('rechecks safety after activation and waits for the same tab to become idle again', () => {
    let clean = true;
    const worker = fakeWorker();
    const tab = page({ waiting: worker, canAutoApply: () => clean });
    tab.watch.waiting(worker);
    tab.watch.idle();
    clean = false; // A form was started while the worker was taking over.
    tab.watch.controllerChanged();
    expect(tab.reload).not.toHaveBeenCalled();
    expect(tab.offered()).toBe(true);
    tab.watch.idle();
    expect(tab.reload).not.toHaveBeenCalled();
    clean = true;
    tab.watch.idle();
    expect(worker.messages).toEqual([SKIP_WAITING]);
    expect(tab.reload).toHaveBeenCalledTimes(1);
  });

  it('does not reload a board opened during activation, then waits until it closes', () => {
    const worker = fakeWorker();
    const tab = page({ waiting: worker, canAutoApply: () => true });
    tab.watch.waiting(worker);
    tab.watch.idle();
    tab.openRunShow();
    tab.watch.controllerChanged();
    tab.watch.idle();
    expect(tab.reload).not.toHaveBeenCalled();
    tab.closeRunShow();
    tab.watch.idle();
    expect(worker.messages).toEqual([SKIP_WAITING]);
    expect(tab.reload).toHaveBeenCalledTimes(1);
  });

  it('leaves every other tab alone when this tab automatically applies the version', () => {
    const worker = fakeWorker();
    const dashboard = page({ waiting: worker, canAutoApply: () => true });
    const other = page({ waiting: worker, canAutoApply: () => true });
    const board = page({ waiting: worker, canAutoApply: () => true });
    for (const tab of [dashboard, other, board]) tab.watch.waiting(worker);
    board.openRunShow();
    dashboard.watch.idle();
    worker.become('activated');
    for (const tab of [dashboard, other, board]) tab.watch.controllerChanged();
    other.watch.idle();
    board.watch.idle();
    expect(worker.messages).toEqual([SKIP_WAITING]);
    expect(dashboard.reload).toHaveBeenCalledTimes(1);
    expect(other.reload).not.toHaveBeenCalled();
    expect(board.reload).not.toHaveBeenCalled();
    expect(other.offered()).toBe(true);
    expect(board.offered()).toBe(true);
  });

  it('sends one activation and reloads once despite repeated idle and controller events', () => {
    const worker = fakeWorker();
    const tab = page({ waiting: worker, canAutoApply: () => true });
    tab.watch.waiting(worker);
    tab.watch.idle();
    tab.watch.idle();
    tab.watch.controllerChanged();
    tab.watch.controllerChanged();
    tab.watch.idle();
    expect(worker.messages).toEqual([SKIP_WAITING]);
    expect(tab.reload).toHaveBeenCalledTimes(1);
  });

  it('blocks another automatic attempt if a reload still serves the same bundle', () => {
    const storage = memoryStorage();
    const worker = fakeWorker();
    const first = page({ waiting: worker, storage, canAutoApply: () => true });
    first.watch.waiting(worker);
    first.watch.idle();
    first.watch.controllerChanged();
    expect(first.reload).toHaveBeenCalledTimes(1);

    const stuck = fakeWorker();
    const second = page({ waiting: stuck, storage, canAutoApply: () => true });
    second.watch.waiting(stuck);
    second.watch.idle();
    second.watch.controllerChanged();
    second.watch.idle();
    expect(stuck.messages).toEqual([]);
    expect(second.reload).not.toHaveBeenCalled();
    expect(second.offered()).toBe(true);
    // A producer's explicit choice remains available after the loop guard.
    second.press();
    expect(second.reload).toHaveBeenCalledTimes(1);
  });

  it('keeps the manual prompt when a reload cannot be durably remembered', () => {
    for (const storage of [null, brokenStorage]) {
      const worker = fakeWorker();
      const tab = page({ waiting: worker, storage, canAutoApply: () => true });
      tab.watch.waiting(worker);
      tab.watch.idle();
      expect(worker.messages).toEqual([]);
      expect(tab.reload).not.toHaveBeenCalled();
      expect(tab.offered()).toBe(true);
    }
  });

  it('treats a throwing safety callback as unsafe', () => {
    const worker = fakeWorker();
    const tab = page({ waiting: worker, canAutoApply: () => { throw new Error('not ready'); } });
    tab.watch.waiting(worker);
    expect(() => tab.watch.idle()).not.toThrow();
    expect(worker.messages).toEqual([]);
    expect(tab.offered()).toBe(true);
  });

  it('does not claim another tab’s takeover if sending the activation failed', () => {
    const worker = fakeWorker();
    worker.postMessage = vi.fn(() => { throw new Error('worker stopped'); });
    const tab = page({ waiting: worker, canAutoApply: () => true });
    tab.watch.waiting(worker);
    expect(() => tab.watch.idle()).not.toThrow();
    tab.watch.controllerChanged();
    tab.watch.idle();
    expect(worker.postMessage).toHaveBeenCalledTimes(1);
    expect(tab.reload).not.toHaveBeenCalled();
    expect(tab.offered()).toBe(true);
  });

  it('does not opt shared links into producer-app idle updates', () => {
    const worker = fakeWorker();
    const link = page({ linkPage: true, waiting: worker, canAutoApply: () => true });
    link.watch.waiting(worker);
    link.watch.idle();
    expect(worker.messages).toEqual([]);
    expect(link.reload).not.toHaveBeenCalled();
  });

  it('leaves a network-served page alone because it already has the newest bundle', () => {
    const worker = fakeWorker();
    const tab = page({ waiting: worker, controlled: false, canAutoApply: () => true });
    tab.watch.waiting(worker);
    tab.watch.idle();
    worker.become('activated');
    tab.watch.controllerChanged();
    expect(worker.messages).toEqual([]);
    expect(tab.reload).not.toHaveBeenCalled();
  });

  it('can use the waiting event before Workbox finishes registering', () => {
    const worker = fakeWorker();
    const tab = page({ waiting: null, canAutoApply: () => true });
    tab.watch.waiting(worker);
    tab.watch.idle();
    expect(worker.messages).toEqual([SKIP_WAITING]);
    tab.watch.controllerChanged();
    expect(tab.reload).toHaveBeenCalledTimes(1);
  });
});

describe('a sent link when a new version is waiting', () => {
  it('switches as it opens and reloads into the new version', () => {
    const worker = fakeWorker();
    const link = page({ linkPage: true, waiting: worker });
    link.watch.waiting(worker, AT_LOAD);
    expect(worker.messages).toEqual([SKIP_WAITING]);
    // The registration reports the same version again once it is back.
    link.watch.waiting(worker);
    expect(worker.messages).toEqual([SKIP_WAITING]);
    link.watch.controllerChanged();
    expect(link.reload).toHaveBeenCalledTimes(1);
  });

  it('leaves a version that arrives while it is open for the next visit', () => {
    // The live link on the PA laptop, armed for sound and playing the
    // walk-ons. Nothing is ever typed into it; a reload would silence it.
    const storage = memoryStorage();
    const worker = fakeWorker();
    const screen = page({ linkPage: true, waiting: worker, storage });
    screen.watch.waiting(worker);
    expect(worker.messages).toEqual([]);
    screen.watch.controllerChanged();
    expect(screen.reload).not.toHaveBeenCalled();

    // Opened again with it still waiting: now it switches, and reloads.
    const next = page({ linkPage: true, waiting: worker, storage });
    next.watch.waiting(worker, AT_LOAD);
    expect(worker.messages).toEqual([SKIP_WAITING]);
    next.watch.controllerChanged();
    expect(next.reload).toHaveBeenCalledTimes(1);
  });

  it('does not do it again on the page it reloads into', () => {
    const storage = memoryStorage();
    const worker = fakeWorker();
    const first = page({ linkPage: true, waiting: worker, storage });
    first.watch.waiting(worker, AT_LOAD);
    first.watch.controllerChanged();
    expect(first.reload).toHaveBeenCalledTimes(1);

    // Somehow there is still a version waiting after the reload.
    const stuck = fakeWorker();
    const second = page({ linkPage: true, waiting: stuck, storage });
    second.watch.waiting(stuck, AT_LOAD);
    expect(stuck.messages).toEqual([]);
    second.watch.controllerChanged();
    expect(second.reload).not.toHaveBeenCalled();

    // The visit after that may update again: the guard is against a loop, not
    // against every later deploy.
    const later = fakeWorker();
    const third = page({ linkPage: true, waiting: later, storage });
    third.watch.waiting(later, AT_LOAD);
    expect(later.messages).toEqual([SKIP_WAITING]);
  });

  it('switches only once in the same visit', () => {
    const first = fakeWorker();
    const link = page({ linkPage: true, waiting: first });
    link.watch.waiting(first, AT_LOAD);
    const second = fakeWorker();
    link.watch.waiting(second, AT_LOAD);
    expect(first.messages).toEqual([SKIP_WAITING]);
    expect(second.messages).toEqual([]);
  });

  it('leaves a contract that has been started alone until the next visit', () => {
    const worker = fakeWorker();
    const link = page({ linkPage: true, waiting: worker });
    link.watch.started();
    link.watch.waiting(worker, AT_LOAD);
    expect(worker.messages).toEqual([]);
    // Another tab of the same browser applying it does not reload this one.
    link.watch.controllerChanged();
    expect(link.reload).not.toHaveBeenCalled();
  });

  it('does not reload a page typed into between asking for the switch and getting it', () => {
    const worker = fakeWorker();
    const link = page({ linkPage: true, waiting: worker });
    link.watch.waiting(worker, AT_LOAD);
    expect(worker.messages).toEqual([SKIP_WAITING]);
    link.watch.started();
    link.watch.controllerChanged();
    expect(link.reload).not.toHaveBeenCalled();
  });

  it('does not switch where it cannot note the reload, rather than risk a loop', () => {
    for (const storage of [null, brokenStorage]) {
      const worker = fakeWorker();
      const link = page({ linkPage: true, waiting: worker, storage });
      link.watch.waiting(worker, AT_LOAD);
      expect(worker.messages).toEqual([]);
    }
  });

  it('switches without reloading a page no worker served, which is already the newest', () => {
    const worker = fakeWorker();
    const link = page({ linkPage: true, waiting: worker, controlled: false, storage: null });
    link.watch.waiting(worker, AT_LOAD);
    expect(worker.messages).toEqual([SKIP_WAITING]);
    worker.become('activated');
    link.watch.controllerChanged();
    expect(link.reload).not.toHaveBeenCalled();
  });

  it('is the only kind of page that switches by itself', () => {
    const worker = fakeWorker();
    const app = page({ linkPage: false, waiting: worker });
    app.watch.waiting(worker, AT_LOAD);
    expect(worker.messages).toEqual([]);
  });
});

// The real files. The rules above only hold while the app's registration is
// the only one: the plugin's own, put back, reloads every tab again.
describe('the registration', () => {
  const root = new URL('../../', import.meta.url);
  const viteConfig = readFileSync(new URL('vite.config.ts', root), 'utf8');
  const main = readFileSync(new URL('src/main.tsx', root), 'utf8');

  it('is the app’s own, not vite-plugin-pwa’s', () => {
    expect(viteConfig).toMatch(/injectRegister: false/);
    expect(main).not.toMatch(/virtual:pwa-register/);
    expect(main).toMatch(/registerAppUpdates\(/);
  });

  it('waits to be asked, and finds the worker where the plugin writes it', () => {
    expect(viteConfig).toMatch(/registerType: 'prompt'/);
    // registerAppUpdates registers `sw.js`, the plugin's default name.
    expect(viteConfig).not.toMatch(/\bfilename:/);
  });
});

/**
 * A new build, waiting for a good moment.
 *
 * The service worker used to take over and reload the page the instant it had
 * finished downloading a deploy — which, on venue wifi, was minutes after the
 * app was opened, often with the show running. The board came back at cue
 * one, silent, with the clock at zero. Now the new version waits, and the app
 * says it is there; reloading is the producer's call, and never mid-show.
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

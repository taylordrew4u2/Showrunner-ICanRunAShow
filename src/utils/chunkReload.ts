/**
 * A part of the app fetched on demand, and what to do when it has gone.
 *
 * Every deploy renames these parts (the names are hashes of what is in them),
 * and the host only has the newest build. A page opened before a deploy still
 * asks for the old names, gets nothing usable back, and the failed import used
 * to take the whole app down to "Something went wrong". The iOS app is the
 * usual victim: it has no service worker keeping the old build, and it sits in
 * the background for days.
 *
 * Reloading picks up the new build, whose names are the ones on the host, so
 * that is what happens — once. If the part still will not load after that,
 * reloading again would not help, so the failure goes to the caller to report.
 * Nor does it reload with no connection: in the iOS app that trades a sheet
 * that would not open for no page at all.
 */

const RELOADED_KEY = 'showrunner:chunkReloaded';

interface Remembering {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface ReloadEnv {
  /** Where the reload is noted. Null when the browser keeps nothing. */
  storage: Remembering | null;
  reload: () => void;
  online: () => boolean;
}

function browserEnv(): ReloadEnv {
  let storage: Remembering | null = null;
  try {
    storage = window.sessionStorage;
  } catch {
    /* blocked storage: no reload, see below */
  }
  return {
    storage,
    reload: () => window.location.reload(),
    online: () => navigator.onLine !== false,
  };
}

/** Load a part of the app; on failure, reload into the current build once. */
export function loadOrReload<T>(load: () => Promise<T>, env: ReloadEnv = browserEnv()): Promise<T> {
  return load().then(
    (part) => {
      try {
        env.storage?.removeItem(RELOADED_KEY);
      } catch {
        /* nothing to forget */
      }
      return part;
    },
    (error: unknown) => {
      if (!env.online() || !env.storage) throw error;
      try {
        if (env.storage.getItem(RELOADED_KEY)) throw error;
        env.storage.setItem(RELOADED_KEY, '1');
      } catch {
        // Already reloaded for this, or nowhere to note that it has been: a
        // part that never loads would otherwise reload the page every time it
        // was opened.
        throw error;
      }
      env.reload();
      // Never settles: the page is going, and until it has, the caller keeps
      // showing that it is loading rather than an error.
      return new Promise<T>(() => {});
    },
  );
}

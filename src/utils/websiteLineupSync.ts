import { onPageReturn } from './pageReturn';

type ReconcileResult = { status: string; retryable?: boolean };

const CHECK_INTERVAL_MS = 60_000;
const FIRST_RETRY_MS = 5_000;
const MIN_REQUEST_GAP_MS = 2_000;

/**
 * Keeps the selected public lineups reconciled while their owner is here.
 * This is independent of the editor's load/save lifecycle: a failed public
 * update must never reload a working copy or prevent a private save.
 */
export function watchWebsiteLineupSync(
  attempt: () => Promise<ReconcileResult>,
): () => void {
  let stopped = false;
  let inFlight = false;
  let pendingSignal = false;
  let lastFinished = -Infinity;
  let retryDelay = FIRST_RETRY_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const eligible = () => document.visibilityState === 'visible' && navigator.onLine !== false;

  function clearTimer() {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  }

  function schedule(delay: number) {
    clearTimer();
    if (stopped || !eligible()) return;
    timer = setTimeout(() => {
      timer = undefined;
      request();
    }, delay);
  }

  async function run() {
    inFlight = true;
    let retry = false;
    let reconciled = false;
    try {
      const result = await attempt();
      retry = result.status === 'failed' && result.retryable === true;
      reconciled = result.status === 'reconciled';
    } catch {
      // Reconciliation normally returns failures. Keep an unexpected transport
      // rejection in the same quiet retry path, never an unhandled rejection.
      retry = true;
    } finally {
      inFlight = false;
      // The transport coalesces recently completed work. A queued return or
      // reconnect must wait past that completion window, even if the request
      // itself took several seconds, or its fresh read would be discarded.
      lastFinished = Date.now();
      if (!stopped) {
        if (pendingSignal) {
          pendingSignal = false;
          request();
        } else if (retry) {
          schedule(retryDelay);
          retryDelay = Math.min(retryDelay * 2, CHECK_INTERVAL_MS);
        } else {
          retryDelay = FIRST_RETRY_MS;
          // Only an account with an active publication needs periodic repair.
          // An unconfigured account or permanent refusal waits for the next
          // return/reconnect instead of repeatedly reading private source rows.
          if (reconciled) schedule(CHECK_INTERVAL_MS);
        }
      }
    }
  }

  function request() {
    if (stopped || !eligible()) return;
    if (inFlight) {
      // A reconnect that arrives during a failed fetch still earns one fresh
      // read afterwards. Several browser events count as the same request.
      pendingSignal = true;
      return;
    }
    clearTimer();
    const wait = MIN_REQUEST_GAP_MS - (Date.now() - lastFinished);
    if (wait > 0) schedule(wait);
    else void run();
  }

  const stopReturn = onPageReturn(request);
  window.addEventListener('online', request);
  request();

  return () => {
    stopped = true;
    pendingSignal = false;
    clearTimer();
    stopReturn();
    window.removeEventListener('online', request);
  };
}

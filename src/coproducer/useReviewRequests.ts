/**
 * The co-producer's own requests, kept fresh while co-producer view is open.
 *
 * The list (outlines only, never payloads) is fetched when the view opens,
 * every 30 seconds while the page is on screen, whenever it comes back on
 * screen, and after every ask, send, withdraw and hand-over (`refresh`).
 * Each request's payload is fetched once, one at a time, and kept for the
 * page's life: payloads never change, and the screens need them to show what
 * is waiting where it applies. Those are the open requests, and the approved
 * shares and downloads not handed over yet, whose payload is what gets handed
 * over.
 *
 * The fetching lives in a plain tracker the hook drives, so it can be tested
 * without a page.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { sameValue } from './paths';
import type { CoproducerClient, CoproducerRequestDetail, CoproducerRequestView } from './types';

export interface ReviewRequests {
  /** Newest first, as the server lists them. */
  requests: CoproducerRequestView[];
  /** Payloads fetched so far, by request id, with each one's status as last listed. */
  details: ReadonlyMap<string, CoproducerRequestDetail>;
  /** Pending and stale: what is still waiting for the owner. */
  pendingCount: number;
  /** Look again now. Never rejects. */
  refresh: () => Promise<void>;
}

/** How often the list is fetched while the page is on screen. */
export const REQUESTS_POLL_MS = 30_000;

export interface RequestsSnapshot {
  requests: CoproducerRequestView[];
  details: ReadonlyMap<string, CoproducerRequestDetail>;
}

export interface RequestsTracker {
  /** List, then fetch the payloads still missing. Calls made while one runs share it and run once more after it. */
  refresh(): Promise<void>;
  /** Stop: nothing more is reported. */
  dispose(): void;
}

function isOpen(request: CoproducerRequestView): boolean {
  return request.status === 'pending' || request.status === 'stale';
}

/** Whose payload this page needs: what is waiting, and what is approved and still to be handed over. */
export function needsDetail(request: CoproducerRequestView): boolean {
  if (isOpen(request)) return true;
  return request.kind !== 'edit' && request.status === 'approved' && !request.usedAt;
}

export function countPending(requests: readonly CoproducerRequestView[]): number {
  return requests.filter(isOpen).length;
}

/**
 * Keeps one link's requests and their payloads, reporting each change to
 * `onChange`. A request that leaves the list (withdrawn, or past the week
 * decided ones are listed for) takes its payload with it; one still listed
 * keeps its payload and takes the list's newer status, decision and result.
 * A failed fetch keeps what was there and is tried again on the next refresh.
 */
export function createRequestsTracker(client: CoproducerClient, onChange: (snapshot: RequestsSnapshot) => void): RequestsTracker {
  let requests: CoproducerRequestView[] = [];
  let details = new Map<string, CoproducerRequestDetail>();
  let disposed = false;
  let running: Promise<void> | null = null;
  let again = false;

  const report = () => {
    if (!disposed) onChange({ requests, details });
  };

  async function pass(): Promise<void> {
    let listed: CoproducerRequestView[];
    try {
      listed = await client.listRequests();
    } catch {
      return;
    }
    if (disposed) return;
    // The same list as last time changes nothing: the screens keep what they have.
    if (!sameValue(listed, requests)) {
      const next = new Map<string, CoproducerRequestDetail>();
      for (const request of listed) {
        const known = details.get(request.id);
        if (known) next.set(request.id, { ...request, payload: known.payload });
      }
      requests = listed;
      details = next;
      report();
    }

    for (const request of listed) {
      if (disposed) return;
      if (!needsDetail(request) || details.has(request.id)) continue;
      let detail: CoproducerRequestDetail;
      try {
        detail = await client.getRequest(request.id);
      } catch {
        continue;
      }
      if (disposed) return;
      // Listed again while this was in flight without it: it has gone.
      const row = requests.find((r) => r.id === request.id);
      if (!row) continue;
      details = new Map(details).set(request.id, { ...row, payload: detail.payload });
      report();
    }
  }

  function refresh(): Promise<void> {
    if (disposed) return Promise.resolve();
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      try {
        do {
          again = false;
          await pass();
        } while (again && !disposed);
      } finally {
        running = null;
      }
    })();
    return running;
  }

  return {
    refresh,
    dispose() {
      disposed = true;
    },
  };
}

const NOTHING: RequestsSnapshot = { requests: [], details: new Map() };

/** The co-producer's requests, kept fresh. Inert (nothing listed) without a client. */
export function useReviewRequests(client: CoproducerClient | null): ReviewRequests {
  const [snapshot, setSnapshot] = useState<{ client: CoproducerClient | null; data: RequestsSnapshot }>({ client: null, data: NOTHING });
  const trackerRef = useRef<RequestsTracker | null>(null);

  useEffect(() => {
    if (!client) return;
    const tracker = createRequestsTracker(client, (data) => setSnapshot({ client, data }));
    trackerRef.current = tracker;
    void tracker.refresh();
    const look = () => {
      if (document.visibilityState === 'visible') void tracker.refresh();
    };
    const timer = window.setInterval(look, REQUESTS_POLL_MS);
    document.addEventListener('visibilitychange', look);
    return () => {
      tracker.dispose();
      if (trackerRef.current === tracker) trackerRef.current = null;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', look);
    };
  }, [client]);

  const refresh = useCallback(() => trackerRef.current?.refresh() ?? Promise.resolve(), []);

  // A snapshot from another client (the view was left and opened again) is
  // not this one's.
  const data = snapshot.client === client ? snapshot.data : NOTHING;
  return useMemo(
    () => ({ requests: data.requests, details: data.details, pendingCount: countPending(data.requests), refresh }),
    [data, refresh],
  );
}

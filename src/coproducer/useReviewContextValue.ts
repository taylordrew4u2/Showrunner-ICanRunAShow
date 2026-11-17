/**
 * What App provides as ReviewContext in co-producer view: asking for a share
 * or a download, where each control's own request stands, and handing over
 * an approved one from the tap that asks for it.
 *
 * Handing over has to happen inside that tap (iOS opens a share sheet or a
 * download only from a fresh gesture), so everything that needs waiting for
 * is prepared as soon as a request turns approved, and the control reads
 * "Getting it ready…" until it is. The tap then only runs what was prepared,
 * inside withApprovedDelivery: the one way the delivery gate opens.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ActionState, AskRequest, ProposalDialogState, ReviewContextValue } from './ReviewContext';
import type { ReviewTruth } from './capture';
import { reviewDiffContext } from './capture';
import { sendFailureFor } from './captureState';
import { prepareApproved, type Prepared } from './deliverApproved';
import { describePayload } from './diff';
import { withApprovedDelivery } from './gates';
import { actionKey } from './outline';
import type { ReviewSession } from './reviewMode';
import type { ReviewRequests } from './useReviewRequests';
import type { CoproducerRequestView, DownloadAction, RequestPayload, ShareAction } from './types';

const NONE: ActionState = { state: 'none' };
const SENDING: ActionState = { state: 'sending' };

const INACTIVE: ReviewContextValue = {
  active: false,
  label: '',
  expiresAt: '',
  ask: () => {},
  actionState: () => NONE,
  deliver: () => {},
  openPending: () => {},
  pendingCount: 0,
};

/** A request this page has prepared for handing over: ready, or found to point at nothing any more. */
type Readied = { ready: Prepared } | { gone: true };

/** The newest request for one action, by its canonical key. */
export function newestFor(requests: CoproducerRequestView[], key: string): CoproducerRequestView | null {
  let newest: CoproducerRequestView | null = null;
  for (const request of requests) {
    if (request.outline?.action?.key !== key) continue;
    if (!newest || request.createdAt > newest.createdAt) newest = request;
  }
  return newest;
}

/** Where a control's own request stands, given what has been prepared. */
export function stateOf(request: CoproducerRequestView | null, readied: Readied | undefined): ActionState {
  if (!request) return NONE;
  switch (request.status) {
    case 'pending':
    case 'stale':
    case 'rejected':
      return { state: request.status, requestId: request.id };
    case 'approved':
      if (request.usedAt) return { state: 'used', requestId: request.id };
      if (!readied) return { state: 'preparing', requestId: request.id };
      // Nothing left to hand over: back to the control's usual label.
      if ('gone' in readied) return NONE;
      return { state: 'approved', requestId: request.id };
    default:
      return NONE;
  }
}

/**
 * Send one ask for an action unless one for the same action is still out.
 *
 * Until the request comes back and the list is fetched again, the control
 * that asked still reads as if nothing had been asked. On venue wifi that is
 * a second or two, and a second tap in it made a second request: the owner
 * saw the same download twice, and each one counted against the link's limit
 * on open requests. So the action's key is held from the tap until `send` has
 * settled (which includes fetching the list again), and an ask for a held key
 * is refused. Returns whether it sent.
 */
export function sendOnce(inFlight: Set<string>, key: string, send: () => Promise<unknown>, onChange: () => void): boolean {
  if (inFlight.has(key)) return false;
  inFlight.add(key);
  onChange();
  const release = () => {
    inFlight.delete(key);
    onChange();
  };
  // Released either way: a failure shows its own dialog, and asking again is allowed.
  send().then(release, release);
  return true;
}

/** What a control says: 'sending' while its own ask is out, else where its newest request stands. */
export function controlState(
  requests: CoproducerRequestView[],
  readied: ReadonlyMap<string, Readied>,
  inFlight: ReadonlySet<string>,
  key: string,
): ActionState {
  if (inFlight.has(key)) return SENDING;
  const request = newestFor(requests, key);
  return stateOf(request, request ? readied.get(request.id) : undefined);
}

export function useReviewContextValue({ review, requests, truth, onDialog, openPending }: {
  review: ReviewSession | null;
  requests: ReviewRequests;
  /** The account as served, for describing a request and preparing a file from it. */
  truth: ReviewTruth | null;
  onDialog: (state: ProposalDialogState | null) => void;
  openPending: () => void;
}): ReviewContextValue {
  const [readied, setReadied] = useState<ReadonlyMap<string, Readied>>(new Map());
  const preparing = useRef(new Set<string>());
  // Asks that have left this page and not come back in the list (sendOnce).
  // The ref is what the next tap checks; the copy in state re-renders the controls.
  const asking = useRef(new Set<string>());
  const [inFlight, setInFlight] = useState<ReadonlySet<string>>(new Set());
  const client = review?.client ?? null;
  const { refresh } = requests;

  // Prepare each approved share or download not yet used, once, as soon as it
  // is seen approved.
  useEffect(() => {
    if (!client || !truth) return;
    for (const request of requests.requests) {
      if (request.kind === 'edit' || request.status !== 'approved' || request.usedAt) continue;
      if (readied.has(request.id) || preparing.current.has(request.id)) continue;
      preparing.current.add(request.id);
      void (async () => {
        let outcome: Readied;
        try {
          const detail = requests.details.get(request.id) ?? await client.getRequest(request.id);
          const ready = await prepareApproved(detail, { shows: truth.shows, settings: truth.settings });
          outcome = ready ? { ready } : { gone: true };
        } catch {
          // Tried again on the next look at the requests.
          preparing.current.delete(request.id);
          return;
        }
        preparing.current.delete(request.id);
        setReadied((previous) => new Map(previous).set(request.id, outcome));
      })();
    }
  }, [client, truth, requests.requests, requests.details, readied]);

  const ask = useCallback((request: AskRequest) => {
    if (!client) return;
    const payload = { kind: request.kind, action: request.action } as RequestPayload;
    sendOnce(asking.current, actionKey(request.action), () => client
      .createRequest({ kind: request.kind, payload, mediaIds: [] })
      .then(async () => {
        const listed = refresh();
        onDialog({ step: 'asked', groups: truth ? describePayload(payload, reviewDiffContext(truth)) : [] });
        // Held until the list has it, so the control goes from "Sending…"
        // straight to "Pending approval" with no tap-able moment between.
        await listed;
      })
      .catch((err: unknown) => {
        onDialog({ step: 'failed', failure: sendFailureFor(err, typeof navigator === 'undefined' || navigator.onLine !== false) });
      }), () => setInFlight(new Set(asking.current)));
  }, [client, truth, refresh, onDialog]);

  const actionState = useCallback(
    (action: ShareAction | DownloadAction) => controlState(requests.requests, readied, inFlight, actionKey(action)),
    [requests.requests, readied, inFlight],
  );

  const deliver = useCallback((requestId: string) => {
    const entry = readied.get(requestId);
    if (!client || !entry || 'gone' in entry) return;
    // Nothing awaited before this: the share sheet, the download or the
    // print window opens inside the tap that called it.
    const handed = withApprovedDelivery(() => entry.ready.deliver());
    void handed.then((outcome) => {
      if (outcome !== 'done') return;
      // One approval, handed over once here. A record for the owner, not a lock.
      void client.markUsed(requestId).catch(() => {}).finally(refresh);
    });
  }, [client, readied, refresh]);

  return useMemo(() => {
    if (!review) return INACTIVE;
    return {
      active: true,
      label: review.label,
      expiresAt: review.expiresAt,
      ask,
      actionState,
      deliver,
      openPending,
      pendingCount: requests.pendingCount,
    };
  }, [review, ask, actionState, deliver, openPending, requests.pendingCount]);
}

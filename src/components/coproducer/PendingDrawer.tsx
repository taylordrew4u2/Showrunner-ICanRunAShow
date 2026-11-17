import { useState } from 'react';
import { approvedLabel } from '../../coproducer/deliverApproved';
import { describePayload, headline, type DiffContext } from '../../coproducer/diff';
import { editLanded } from '../../coproducer/pendingOverlay';
import { useReview, type ActionState, type ReviewContextValue } from '../../coproducer/ReviewContext';
import type { CoproducerRequestDetail, CoproducerRequestView } from '../../coproducer/types';
import { resolveMediaUrl } from '../../utils/mediaStore';
import { timeAgo } from '../../utils/relativeTime';
import { ProfileDrawer } from '../sections/PerformerProfile';
import { useConfirm } from '../useConfirm';
import { ChangeList } from './ChangeList';
import { localConfirm } from './localConfirm';
import './coproducer.css';

type Section = { key: string; title: string; items: CoproducerRequestView[] };

function ago(iso: string | null): string {
  const at = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(at) ? '' : timeAgo(at);
}

/**
 * Where an approved share or download stands on this page. The control that
 * asked for it knows best (getting it ready, ready, gone) when this is the
 * newest request for that action; an older one goes by its own record.
 */
function handOverState(
  request: CoproducerRequestView,
  detail: CoproducerRequestDetail | undefined,
  actionState: ReviewContextValue['actionState'],
): ActionState {
  if (request.usedAt) return { state: 'used', requestId: request.id };
  if (detail && detail.payload.kind !== 'edit') {
    const state = actionState(detail.payload.action);
    if (state.state === 'none' || ('requestId' in state && state.requestId === request.id)) return state;
  }
  return { state: 'approved', requestId: request.id };
}

function Item({ request, detail, context, onWithdraw }: {
  request: CoproducerRequestView;
  detail: CoproducerRequestDetail | undefined;
  context: DiffContext;
  onWithdraw: (id: string) => Promise<void>;
}) {
  const review = useReview();
  const { confirm, confirmDialog } = useConfirm();
  const [open, setOpen] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const waiting = request.status === 'pending' || request.status === 'stale';
  const groups = open && detail ? describePayload(detail.payload, context) : null;

  async function withdraw() {
    const sure = await confirm(localConfirm({
      title: 'Withdraw this request?',
      message: "The owner won't see it any more.",
      confirmLabel: 'Withdraw',
    }));
    if (!sure) return;
    setWithdrawing(true);
    setProblem(null);
    try {
      await onWithdraw(request.id);
    } catch {
      setProblem("Couldn't withdraw it. Check your connection and try again.");
    } finally {
      setWithdrawing(false);
    }
  }

  let note: React.ReactNode = null;
  let handOver: React.ReactNode = null;
  if (request.status === 'stale') {
    note = "The owner's copy changed after you asked. They can still approve it, or you can withdraw it and ask again.";
  } else if (request.status === 'rejected') {
    note = "The owner didn't approve this.";
  } else if (request.status === 'approved' && request.kind === 'edit') {
    note = !detail || detail.payload.kind !== 'edit'
      ? 'Approved.'
      : context.state && editLanded(detail.payload, context.state)
        ? 'Approved and added.'
        : "Approved. It shows here once the owner's app has saved it.";
  } else if (request.status === 'approved') {
    const state = handOverState(request, detail, review.actionState);
    if (state.state === 'used') {
      note = `Done ${ago(request.usedAt)}`.trim();
    } else if (state.state === 'preparing') {
      handOver = <button type="button" className="btn btn--secondary btn--sm" disabled aria-busy="true">Getting it ready…</button>;
    } else if (state.state === 'none') {
      note = "This isn't there any more.";
    } else if (request.outline.action) {
      const label = approvedLabel(detail && detail.payload.kind !== 'edit' ? detail.payload.action : request.outline.action, request.result);
      handOver = (
        <button type="button" className="btn btn--primary btn--sm" onClick={() => review.deliver(request.id)}>
          {label}
        </button>
      );
    }
  }

  return (
    <li className="pending-drawer__item">
      <p className="pending-drawer__headline">You asked to {headline(request.outline, context)}</p>
      <p className="pending-drawer__when">{ago(request.createdAt)}</p>
      {note && <p className="pending-drawer__note">{note}</p>}
      {problem && <p className="pending-drawer__note" role="alert">{problem}</p>}
      {groups && <ChangeList groups={groups} resolveMedia={resolveMediaUrl} />}
      <div className="pending-drawer__actions">
        {handOver}
        {detail && (
          <button type="button" className="btn btn--ghost btn--sm" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            {open ? 'Hide details' : 'Show details'}
          </button>
        )}
        {waiting && (
          <button type="button" className="btn btn--secondary btn--sm" disabled={withdrawing} onClick={() => void withdraw()}>
            {withdrawing ? 'Withdrawing…' : 'Withdraw'}
          </button>
        )}
      </div>
      {confirmDialog}
    </li>
  );
}

/**
 * Everything the co-producer has asked for and what became of it: waiting,
 * needing another look, approved (and, for a share or download, the tap that
 * hands it over), and not approved. Each says what was asked in the reader's
 * own words for the account, with the full list of changes a tap away.
 */
export function PendingDrawer({ requests, details, context, onClose, onWithdraw }: {
  requests: CoproducerRequestView[];
  details: ReadonlyMap<string, CoproducerRequestDetail>;
  /** Truth as the state: names come from it, and approved edits are checked against it. */
  context: DiffContext;
  onClose: () => void;
  onWithdraw: (id: string) => Promise<void>;
}) {
  const sections: Section[] = [
    { key: 'pending', title: 'Waiting for the owner', items: requests.filter((r) => r.status === 'pending') },
    { key: 'stale', title: 'Needs another look', items: requests.filter((r) => r.status === 'stale') },
    { key: 'approved', title: 'Approved', items: requests.filter((r) => r.status === 'approved') },
    { key: 'rejected', title: 'Not approved', items: requests.filter((r) => r.status === 'rejected') },
  ].filter((section) => section.items.length > 0);

  return (
    <ProfileDrawer label="Pending approval" onClose={onClose}>
      <div className="pending-drawer__head">
        <h2 className="pending-drawer__title">Pending approval</h2>
        <button type="button" className="btn btn--ghost btn--sm" onClick={onClose}>Close</button>
      </div>
      {sections.length === 0 ? (
        <p className="pending-drawer__empty">Nothing waiting. Anything you change, share or download shows up here until the owner decides.</p>
      ) : (
        sections.map((section) => (
          <section key={section.key} className="pending-drawer__section" aria-labelledby={`pending-drawer-${section.key}`}>
            <h3 className="pending-drawer__section-title" id={`pending-drawer-${section.key}`}>{section.title}</h3>
            <ul className="pending-drawer__list">
              {section.items.map((request) => (
                <Item key={request.id} request={request} detail={details.get(request.id)} context={context} onWithdraw={onWithdraw} />
              ))}
            </ul>
          </section>
        ))
      )}
    </ProfileDrawer>
  );
}

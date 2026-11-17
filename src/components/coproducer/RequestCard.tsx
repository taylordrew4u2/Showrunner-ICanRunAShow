import { useMemo, useState } from 'react';
import type { Withdrawal } from '../../coproducer/applyRequest';
import { describePayload, visibleText } from '../../coproducer/diff';
import { shareBlocker, shareDuplicateWarning, shareWarning } from '../../coproducer/executeShare';
import { stagedChunk } from '../../coproducer/ownerClient';
import type { ShareAction } from '../../coproducer/types';
import { shareContextOf, type InboxItem, type OwnerDataApi, type OwnerRequests } from '../../coproducer/useOwnerRequests';
import { decryptWithKey } from '../../utils/encryption';
import { parseMediaRef, resolveMediaUrl } from '../../utils/mediaStore';
import { timeAgo } from '../../utils/relativeTime';
import type { SessionCredentials } from '../../utils/session-vault';
import { useConfirm } from '../useConfirm';
import { ChangeList } from './ChangeList';
import './owner.css';

/**
 * One co-producer request on the owner's Requests page: who asked, what for
 * (in words from the owner's own data, never theirs), everything approving
 * it would change, and Approve or Reject.
 */

const KIND_WORD = { edit: 'Change', share: 'Share', download: 'Download' } as const;

/** Shares whose approval makes a new link in the owner's account. */
function makesLink(action: ShareAction, data: OwnerDataApi): boolean {
  if (action.type === 'signing-link' || action.type === 'profile-link') return true;
  if (action.type !== 'viewer-link') return false;
  return !data.shows().find((show) => show.id === action.showId)?.viewToken;
}

function withdrawalText(w: Withdrawal): string {
  if (w.kind === 'signature') return `${visibleText(w.request.signerName)}'s signing link for “${visibleText(w.request.contractName)}”`;
  if (w.kind === 'profile') return `${visibleText(w.request.personName)}'s details link`;
  return `The viewer link for “${visibleText(w.showName)}”`;
}

/** A picture for a change: a file this request carries comes from staging, anything else from the account. */
function mediaResolver(mediaIds: readonly string[], session: SessionCredentials) {
  return async (ref: string): Promise<string | null> => {
    const parsed = parseMediaRef(ref);
    if (parsed && mediaIds.includes(parsed.id)) {
      try {
        const parts: string[] = [];
        for (let seq = 0; seq < parsed.total; seq++) {
          const chunk = await stagedChunk(session, parsed.id, seq);
          parts.push(decryptWithKey<string>(chunk.data, session.key));
        }
        return parts.join('');
      } catch {
        // Adopted already: it is the account's own file now.
      }
    }
    return resolveMediaUrl(ref);
  };
}

export function RequestCard({ item, data, requests }: { item: InboxItem; data: OwnerDataApi; requests: OwnerRequests }) {
  const { confirm, confirmDialog } = useConfirm();
  const [acting, setActing] = useState<'approve' | 'reject' | null>(null);
  const { row, who } = item;
  const headingId = `request-${row.id}`;
  const busy = requests.busy || acting !== null;
  const blocked = data.syncBlocked();
  const resolveMedia = useMemo(() => mediaResolver(row.mediaIds, data.session), [row.mediaIds, data.session]);

  const payload = item.detail === 'ready' ? item.payload : undefined;
  const plan = payload?.kind === 'edit' ? item.plan : undefined;
  const owner = { shows: data.shows(), settings: data.settings() };
  const shareAction = payload?.kind === 'share' ? payload.action : null;
  const blocker = shareAction ? shareBlocker(shareAction, shareContextOf(data)) : null;
  const unreadable = item.detail === 'unreadable' || !item.outline;

  const conflicts = plan?.ok ? plan.conflicts : [];
  const canApprove = !unreadable && !item.applied && !!payload && (payload.kind !== 'edit' || !!plan?.ok) && !blocker;
  const approveLabel = conflicts.length > 0
    ? 'Approve anyway'
    : shareAction && makesLink(shareAction, data) ? 'Approve and make the link' : 'Approve';

  async function approve() {
    if (!payload) return;
    if (conflicts.length > 0) {
      const go = await confirm({
        title: 'Approve anyway?',
        message: `You changed ${conflicts.length} of these after ${who} asked. Approving puts their version in place of yours for the ones listed under “Changed since they asked”.`,
        confirmLabel: 'Approve anyway',
        danger: false,
      });
      if (!go) return;
    }
    if (shareAction) {
      const ctx = shareContextOf(data);
      const duplicate = shareDuplicateWarning(shareAction, ctx);
      if (duplicate && !(await confirm(duplicate))) return;
      const warning = shareWarning(shareAction, who, ctx);
      if (warning && !(await confirm(warning))) return;
    }
    setActing('approve');
    try {
      await requests.approve(item, { anyway: conflicts.length > 0 });
    } finally {
      setActing(null);
    }
  }

  async function reject() {
    setActing('reject');
    try {
      await requests.reject(item);
    } finally {
      setActing(null);
    }
  }

  const touched = new Set<string>([
    ...(item.outline?.shows ?? []).map((show) => show.id),
    ...(plan?.ok ? plan.upsert : []),
  ]);
  const openable = owner.shows.filter((show) => touched.has(show.id));

  return (
    <article className="request-card" aria-labelledby={headingId}>
      <header className="request-card__header">
        <h3 className="request-card__title" id={headingId}>
          {unreadable ? `${who} asked for something` : `${who} asked to ${item.headline}`}
        </h3>
        <span className="request-card__meta">
          <span className={`request-card__kind request-card__kind--${row.kind}`}>{KIND_WORD[row.kind]}</span>
          <span>{timeAgo(Date.parse(row.createdAt))}</span>
          {row.status === 'stale' && <span className="request-card__stale">Changed since they asked</span>}
        </span>
      </header>

      {unreadable ? (
        <p className="request-card__problem" role="status">This request couldn't be read.</p>
      ) : item.detail === 'idle' ? (
        <button type="button" className="btn btn--ghost btn--sm" disabled={requests.busy} onClick={() => void requests.loadDetail(row.id)}>Show details</button>
      ) : item.detail === 'loading' ? (
        <p className="request-card__muted" role="status">Loading…</p>
      ) : payload?.kind === 'edit' ? (
        plan && !plan.ok ? (
          <p className="request-card__problem" role="status">{plan.reason}</p>
        ) : plan?.ok ? (
          <>
            <ChangeList groups={plan.changes} conflicts={plan.conflicts} who={who} complete resolveMedia={resolveMedia} />
            {plan.withdrawals.length > 0 && (
              <div className="request-card__withdrawals">
                <p className="request-card__muted">Approving this also withdraws:</p>
                <ul>{plan.withdrawals.map((w, i) => <li key={i}>{withdrawalText(w)}</li>)}</ul>
              </div>
            )}
            {plan.notes.map((note, i) => <p key={i} className="request-card__muted">{note}</p>)}
          </>
        ) : null
      ) : payload ? (
        <ChangeList groups={describePayload(payload, { state: owner, rolodexPlural: owner.settings.rolodexTermPlural, musicLibrary: owner.settings.musicLibrary })} complete resolveMedia={resolveMedia} />
      ) : null}

      {openable.length > 0 && (
        <div className="request-card__open">
          {openable.map((show) => (
            <button key={show.id} type="button" className="request-card__link" onClick={() => data.openShow(show.id)}>
              Open “{visibleText(show.name)}”
            </button>
          ))}
        </div>
      )}

      {item.notice && <p className="request-card__notice" role="status">{item.notice}</p>}
      {blocker && <p className="request-card__problem" role="status">{blocker}</p>}
      {item.error && !unreadable && <p className="request-card__error" role="alert">{item.error}</p>}
      {canApprove && blocked && <p className="request-card__muted">Your last change hasn't saved yet. Approve once the pill says Saved.</p>}

      <div className="request-card__actions">
        {item.applied ? (
          <button type="button" className="btn btn--primary btn--sm" disabled={busy} onClick={async () => {
            setActing('approve');
            try { await requests.finish(item); } finally { setActing(null); }
          }}>{acting === 'approve' ? 'Approving…' : 'Finish approving'}</button>
        ) : (
          <>
            {canApprove && (
              <button type="button" className="btn btn--primary btn--sm" disabled={busy || blocked} onClick={() => void approve()}>
                {acting === 'approve' ? 'Approving…' : approveLabel}
              </button>
            )}
            <button type="button" className="btn btn--secondary btn--sm" disabled={busy} onClick={() => void reject()}>
              {acting === 'reject' ? 'Rejecting…' : 'Reject'}
            </button>
          </>
        )}
      </div>
      {confirmDialog}
    </article>
  );
}

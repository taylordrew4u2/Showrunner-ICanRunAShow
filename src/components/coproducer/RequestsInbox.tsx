import { useEffect } from 'react';
import type { InboxItem, OwnerDataApi, OwnerRequests } from '../../coproducer/useOwnerRequests';
import { PageHeader } from '../PageHeader';
import { useConfirm } from '../useConfirm';
import { RequestCard } from './RequestCard';
import './owner.css';

/**
 * Requests: what co-producers have asked to change, share or download,
 * oldest first so they are dealt with in order, grouped by who asked.
 */

export const REQUESTS_EMPTY = 'Nothing waiting for you. When a co-producer asks to change, share or download something, it shows up here.';

const STATUS_WORD: Record<string, string> = {
  approved: 'Approved',
  rejected: 'Not approved',
  withdrawn: 'Withdrawn by them',
};

function byCoproducer(items: InboxItem[]): { linkId: string; who: string; items: InboxItem[] }[] {
  const groups = new Map<string, { linkId: string; who: string; items: InboxItem[] }>();
  for (const item of items) {
    const group = groups.get(item.row.linkId) ?? { linkId: item.row.linkId, who: item.who, items: [] };
    group.items.push(item);
    groups.set(item.row.linkId, group);
  }
  return [...groups.values()];
}

export function RequestsInbox({ data, requests, onBack }: { data: OwnerDataApi; requests: OwnerRequests; onBack: () => void }) {
  const { confirm, confirmDialog } = useConfirm();
  const { load } = requests;

  // Plans are made against what the account holds now, so opening the page
  // looks again.
  useEffect(() => {
    void load();
  }, [load]);

  const groups = byCoproducer(requests.items);

  return (
    <div className="page requests-page">
      <PageHeader title="Requests" subtitle="What your co-producers have asked to change, share or download." onBack={onBack} />
      <p className="requests-page__live" role="status" aria-live="polite">{requests.announcement}</p>
      {requests.error && <p className="settings__sweep-error" role="alert">{requests.error}</p>}
      {requests.loading && requests.items.length === 0 ? (
        <p className="request-card__muted" role="status">Loading…</p>
      ) : groups.length === 0 ? (
        <p className="requests-page__empty">{REQUESTS_EMPTY}</p>
      ) : (
        <section aria-labelledby="requests-waiting" className="requests-page__section">
          <h2 id="requests-waiting" className="requests-page__heading">Waiting for you</h2>
          {groups.map((group) => (
            <div key={group.linkId} className="requests-page__group">
              <div className="requests-page__group-head">
                <h3 className="requests-page__who">{group.who}</h3>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  disabled={requests.busy}
                  onClick={async () => {
                    const n = group.items.length;
                    const go = await confirm({
                      message: `Reject all ${n} of ${group.who}'s waiting requests?`,
                      confirmLabel: 'Reject all',
                      danger: true,
                    });
                    if (go) await requests.rejectAllFrom(group.linkId);
                  }}
                >Reject all from {group.who}</button>
              </div>
              {group.items.map((item) => <RequestCard key={item.row.id} item={item} data={data} requests={requests} />)}
            </div>
          ))}
        </section>
      )}
      {requests.recent.length > 0 && (
        <details className="requests-page__recent">
          <summary>Recently decided</summary>
          <ul>
            {requests.recent.map((item) => (
              <li key={item.row.id}>
                <span>{item.outline ? `${item.who} asked to ${item.headline}` : `${item.who} asked for something`}</span>
                <span className="request-card__muted"> · {STATUS_WORD[item.row.status] ?? item.row.status}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {confirmDialog}
    </div>
  );
}

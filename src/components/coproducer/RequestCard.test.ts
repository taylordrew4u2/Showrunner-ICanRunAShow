import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { planEdit } from '../../coproducer/applyRequest';
import { buildOutline } from '../../coproducer/outline';
import { buildPseudonymIndex, viewOfShow } from '../../coproducer/redaction';
import { fullSettings, fullShow } from '../../coproducer/testFixtures';
import type { EditPayload, OwnerRequestRow, RequestPayload } from '../../coproducer/types';
import type { InboxItem, OwnerDataApi, OwnerRequests } from '../../coproducer/useOwnerRequests';
import type { Show } from '../../types';
import { RequestCard } from './RequestCard';
import { REQUESTS_EMPTY, RequestsInbox } from './RequestsInbox';

const session = { username: 'producer', userId: 'u1', authHash: 'auth', key: 'a'.repeat(64), legacyKey: 'b'.repeat(64) };

function data(shows: Show[], blocked = false): OwnerDataApi {
  const settings = fullSettings();
  return {
    session,
    shows: () => shows,
    settings: () => settings,
    loaded: () => true,
    producerLocked: false,
    syncBlocked: () => blocked,
    commit: async () => ({ keptLinks: [] }),
    commitShare: () => {},
    withdrawHandout: async () => ({ withdrawn: 0, skipped: [] }),
    openShow: () => {},
  };
}

const requests: OwnerRequests = {
  open: 1, links: 1, items: [], recent: [], loading: false, error: null, busy: false, announcement: '',
  refreshCount: async () => {}, load: async () => {}, loadDetail: async () => {}, approve: async () => {}, finish: async () => {}, reject: async () => {}, rejectAllFrom: async () => {},
};

function row(kind: OwnerRequestRow['kind']): OwnerRequestRow {
  return { id: 'req1', linkId: 'link1', kind, status: 'pending', createdAt: new Date().toISOString(), decidedAt: null, usedAt: null, outline: '', mediaIds: [], bytes: 1 };
}

async function editItem(shows: Show[], current: Show[], venueName: string): Promise<InboxItem> {
  const index = await buildPseudonymIndex({ shows, settings: fullSettings() });
  const view = viewOfShow(shows[0], index);
  const payload: EditPayload = {
    kind: 'edit',
    shows: [{ target: 'show', op: 'update', showId: view.id, baseRevision: null, keys: ['venueName'], base: { venueName: view.venueName }, proposed: { venueName } }],
    settings: null,
  };
  const state = { shows: current, settings: fullSettings() };
  const plan = planEdit(payload, state, {
    index: await buildPseudonymIndex(state), mediaIds: [], now: 'now', trashId: (id) => `t-${id}`, context: { state },
  });
  return { row: row('edit'), who: 'Sam Rivera', outline: buildOutline(payload), headline: 'change “Friday Laughs”', detail: 'ready', payload, plan, shown: plan.ok ? plan.fingerprint : undefined };
}

function render(item: InboxItem, owner: OwnerDataApi) {
  return renderToStaticMarkup(createElement(RequestCard, { item, data: owner, requests }));
}

beforeEach(() => {
  vi.stubGlobal('location', { origin: 'https://icanrunashow.com', protocol: 'https:', hostname: 'icanrunashow.com' });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('a request card', () => {
  it('names who asked and what for, and shows what is there now beside what is proposed', async () => {
    const show = fullShow();
    const html = render(await editItem([show], [show], 'The Attic'), data([show]));
    expect(html).toContain('Sam Rivera asked to change “Friday Laughs”');
    expect(html).toContain('Change');
    expect(html).toContain('Pending approval');
    expect(html).toContain('The Attic');
    expect(html).toContain('The Basement');
    expect(html).toMatch(/<button[^>]*>Approve<\/button>/);
    expect(html).toMatch(/<button[^>]*>Reject<\/button>/);
    expect(html).toContain('Open “Friday Laughs”');
  });

  it('reads Approve anyway when the owner changed something since', async () => {
    const show = fullShow();
    const moved = { ...show, venueName: 'Owner moved it' };
    const html = render(await editItem([show], [moved], 'The Attic'), data([moved]));
    expect(html).toContain('Changed since they asked');
    expect(html).toMatch(/<button[^>]*>Approve anyway<\/button>/);
  });

  it('holds Approve while the owner’s own save is blocked', async () => {
    const show = fullShow();
    const html = render(await editItem([show], [show], 'The Attic'), data([show], true));
    expect(html).toContain('Your last change hasn&#x27;t saved yet. Approve once the pill says Saved.');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Approve<\/button>/);
  });

  it('an unreadable request offers only Reject', () => {
    const item: InboxItem = { row: row('edit'), who: 'Sam Rivera', outline: null, headline: '', detail: 'unreadable', error: "This request couldn't be read." };
    const html = render(item, data([fullShow()]));
    expect(html).toContain('This request couldn&#x27;t be read.');
    expect(html).not.toContain('>Approve');
    expect(html).toMatch(/<button[^>]*>Reject<\/button>/);
  });

  it('an approval that did not record offers only Finish approving', async () => {
    const show = fullShow();
    const item = { ...(await editItem([show], [show], 'The Attic')), applied: true, error: 'Your approval is in your account. Finish approving to let Sam Rivera know.' };
    const html = render(item, data([show]));
    expect(html).toMatch(/<button[^>]*>Finish approving<\/button>/);
    expect(html).not.toContain('>Reject<');
    expect(html).not.toMatch(/>Approve</);
  });

  it('a link share says the link is made on approval, and a gone target hides Approve', () => {
    const payload: RequestPayload = { kind: 'share', action: { type: 'profile-link', contactId: 'c1' } };
    const item: InboxItem = { row: row('share'), who: 'Sam Rivera', outline: buildOutline(payload), headline: 'ask Sam Lee for their details', detail: 'ready', payload };
    expect(render(item, data([fullShow()]))).toMatch(/<button[^>]*>Approve and make the link<\/button>/);
    const gone: RequestPayload = { kind: 'share', action: { type: 'profile-link', contactId: 'nobody' } };
    const html = render({ ...item, payload: gone, outline: buildOutline(gone) }, data([fullShow()]));
    expect(html).toContain('That person is no longer in your Rolodex.');
    expect(html).not.toContain('>Approve');
  });

  it('a request not loaded yet offers Show details', () => {
    const payload: RequestPayload = { kind: 'download', action: { type: 'flyer', showId: 'show1' } };
    const item: InboxItem = { row: row('download'), who: 'Sam Rivera', outline: buildOutline(payload), headline: 'download the flyer for “Friday Laughs”', detail: 'idle' };
    const html = render(item, data([fullShow()]));
    expect(html).toContain('Show details');
    expect(html).not.toContain('>Approve');
  });
});

describe('the Requests page', () => {
  it('says when nothing is waiting', () => {
    const html = renderToStaticMarkup(createElement(RequestsInbox, { data: data([]), requests, onBack: () => {} }));
    expect(html).toContain('Requests');
    expect(html).toContain('What your co-producers have asked to change, share or download.');
    expect(html).toContain(REQUESTS_EMPTY);
  });

  it('groups what is waiting by co-producer, with Reject all', async () => {
    const show = fullShow();
    const item = await editItem([show], [show], 'The Attic');
    const html = renderToStaticMarkup(createElement(RequestsInbox, { data: data([show]), requests: { ...requests, items: [item] }, onBack: () => {} }));
    expect(html).toContain('Waiting for you');
    expect(html).toContain('Reject all from Sam Rivera');
    expect(html).toContain('Sam Rivera asked to change “Friday Laughs”');
  });
});

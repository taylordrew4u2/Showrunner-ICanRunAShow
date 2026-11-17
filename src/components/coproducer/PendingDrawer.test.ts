import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { DiffContext } from '../../coproducer/diff';
import { ReviewProvider, type ActionState, type ReviewContextValue } from '../../coproducer/ReviewContext';
import { clone, fullSettings, fullShow } from '../../coproducer/testFixtures';
import type { CoproducerRequestDetail, CoproducerRequestView, EditPayload, RequestPayload } from '../../coproducer/types';
import { PendingDrawer } from './PendingDrawer';

const state = { shows: [fullShow()], settings: fullSettings() };
const context: DiffContext = { state };

const venue: EditPayload = {
  kind: 'edit',
  shows: [{ target: 'show', op: 'update', showId: 'show1', baseRevision: 'r', keys: ['venueName'], base: { venueName: 'The Basement' }, proposed: { venueName: 'The Attic' } }],
  settings: null,
};
const flyer: RequestPayload = { kind: 'download', action: { type: 'flyer', showId: 'show1' } };

function view(id: string, payload: RequestPayload, over: Partial<CoproducerRequestView> = {}): CoproducerRequestView {
  const outline = payload.kind === 'edit'
    ? { kind: 'edit' as const, shows: [{ id: 'show1', op: 'update' as const }] }
    : { kind: payload.kind, action: { type: payload.action.type, key: `download:flyer:show1`, showId: 'show1' } };
  return {
    id,
    kind: payload.kind,
    status: 'pending',
    createdAt: new Date(Date.now() - 5 * 60_000).toISOString(),
    decidedAt: null,
    usedAt: null,
    outline,
    result: null,
    ...over,
  };
}

function detail(request: CoproducerRequestView, payload: RequestPayload): CoproducerRequestDetail {
  return { ...request, payload };
}

function render(
  requests: CoproducerRequestView[],
  details: CoproducerRequestDetail[] = [],
  actionState: (requestId: string) => ActionState = () => ({ state: 'none' }),
  drawerContext: DiffContext = context,
): string {
  const value: ReviewContextValue = {
    active: true,
    label: 'Sam',
    expiresAt: '2026-12-01T00:00:00.000Z',
    ask: () => {},
    actionState: () => actionState(requests[0]?.id ?? ''),
    deliver: () => {},
    openPending: () => {},
    pendingCount: 0,
  };
  return renderToStaticMarkup(createElement(ReviewProvider, { value }, createElement(PendingDrawer, {
    requests,
    details: new Map(details.map((d) => [d.id, d])),
    context: drawerContext,
    onClose: () => {},
    onWithdraw: async () => {},
  })));
}

function textOf(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}

describe('the Pending approval drawer', () => {
  it('says so when nothing is waiting', () => {
    const text = textOf(render([]));
    expect(text).toContain('Pending approval');
    expect(text).toContain('Nothing waiting. Anything you change, share or download shows up here until the owner decides.');
  });

  it('puts each request under its section, only sections with something in them', () => {
    const html = render([
      view('a', venue),
      view('b', venue, { status: 'stale' }),
      view('c', venue, { status: 'approved', decidedAt: new Date().toISOString() }),
      view('d', venue, { status: 'rejected', decidedAt: new Date().toISOString() }),
    ]);
    const text = textOf(html);
    const order = ['Waiting for the owner', 'Needs another look', 'Approved', 'Not approved'].map((title) => text.indexOf(title));
    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((x, y) => x - y)).toEqual(order);
    expect(textOf(render([view('a', venue)]))).not.toContain('Needs another look');
  });

  it('says what each asks in the reader’s words, and when', () => {
    const text = textOf(render([view('a', venue)]));
    expect(text).toContain('You asked to change “Friday Laughs”');
    expect(text).toContain('5 min ago');
  });

  it('offers Withdraw while a request waits, and Show details once its payload is here', () => {
    const request = view('a', venue);
    const html = render([request], [detail(request, venue)]);
    expect(html).toContain('>Withdraw</button>');
    expect(html).toContain('>Show details</button>');
    expect(render([request])).not.toContain('Show details');
    expect(render([view('b', venue, { status: 'rejected' })])).not.toContain('>Withdraw</button>');
  });

  it('explains a request that needs another look, and one not approved', () => {
    expect(textOf(render([view('b', venue, { status: 'stale' })]))).toContain(
      "The owner's copy changed after you asked. They can still approve it, or you can withdraw it and ask again.",
    );
    expect(textOf(render([view('d', venue, { status: 'rejected' })]))).toContain("The owner didn't approve this.");
  });

  it('says whether an approved change is in the account yet', () => {
    const approved = view('c', venue, { status: 'approved' });
    expect(textOf(render([approved], [detail(approved, venue)]))).toContain("Approved. It shows here once the owner's app has saved it.");
    const landed = clone(state);
    landed.shows[0].venueName = 'The Attic';
    expect(textOf(render([approved], [detail(approved, venue)], undefined, { state: landed }))).toContain('Approved and added.');
    expect(textOf(render([approved]))).toContain('Approved.');
  });

  it('hands over an approved download from its own button, in each state', () => {
    const approved = view('f', flyer, { status: 'approved' });
    const withDetail = [detail(approved, flyer)];
    expect(render([approved], withDetail, (id) => ({ state: 'approved', requestId: id }))).toContain('>Approved — tap to download</button>');
    expect(render([approved], withDetail, (id) => ({ state: 'preparing', requestId: id }))).toContain('Getting it ready…');
    expect(textOf(render([approved], withDetail, () => ({ state: 'none' })))).toContain("This isn't there any more.");
    const used = view('f', flyer, { status: 'approved', usedAt: new Date().toISOString() });
    const usedText = textOf(render([used], [detail(used, flyer)]));
    expect(usedText).toContain('Done just now');
    expect(usedText).not.toContain('Approved — tap');
  });

  it('offers the hand-over by the outline when the payload has not arrived', () => {
    expect(render([view('f', flyer, { status: 'approved' })])).toContain('>Approved — tap to download</button>');
  });
});

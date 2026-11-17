import { describe, expect, it } from 'vitest';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PendingOverlayProvider, type PendingMark, type PendingOverlayValue } from '../../coproducer/PendingOverlay';
import { underPath } from '../../coproducer/paths';
import type { FieldChange } from '../../coproducer/types';
import { PendingChip, PendingInline, PendingNewShows, PendingRowMark } from './PendingMarks';

function mark(change: Partial<FieldChange> & { key: string }, groupKey = 'show:show1'): PendingMark {
  return {
    requestId: 'r1',
    status: 'pending',
    createdAt: '2026-11-01T10:00:00.000Z',
    groupKey,
    change: { path: [], label: 'Venue name', before: 'The Basement', after: 'The Attic', change: 'changed', ...change },
  };
}

function overlay(marks: PendingMark[], newShows: PendingOverlayValue['newShows'] = []): PendingOverlayValue {
  return {
    marks: (groupKey, prefix) => marks.filter((m) => m.groupKey === groupKey && (prefix === undefined || underPath(m.change.key, prefix))),
    newShows,
  };
}

function render(value: PendingOverlayValue, element: ReactElement): string {
  return renderToStaticMarkup(createElement(PendingOverlayProvider, { value }, element));
}

function textOf(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}

const venue = mark({ key: 'venueName' });
const email = mark({ key: 'performers/p1/email', path: ['Performers', 'Sam Lee'], label: 'Email', before: 'sam@example.com', after: 'sam@new.example' });
const removal = mark({ key: 'potentialComics/c1', path: ['Comics'], label: 'Removed', before: 'Sam Lee', after: null, change: 'removed' }, 'settings:potentialComics');

describe('pending marks on the screens', () => {
  it('renders nothing where nothing is waiting, and outside co-producer view', () => {
    const empty = overlay([]);
    expect(render(empty, createElement(PendingChip, { groupKey: 'show:show1' }))).toBe('');
    expect(render(empty, createElement(PendingInline, { groupKey: 'show:show1' }))).toBe('');
    expect(render(empty, createElement(PendingNewShows))).toBe('');
    expect(renderToStaticMarkup(createElement(PendingChip, { groupKey: 'show:show1' }))).toBe('');
    expect(renderToStaticMarkup(createElement(PendingRowMark, { groupKey: 'g', rowKey: 'r', children: 'Sam' }))).toBe('Sam');
  });

  it('chips a place with the red pill, counting when there is more than one', () => {
    const one = render(overlay([venue]), createElement(PendingChip, { groupKey: 'show:show1', prefix: 'venueName' }));
    expect(one).toContain('class="pending-pill"');
    expect(one).toContain('aria-label="Pending approval: 1 change"');
    expect(textOf(one)).toBe('Pending approval');
    const two = render(overlay([venue, email]), createElement(PendingChip, { groupKey: 'show:show1' }));
    expect(two).toContain('aria-label="Pending approval: 2 changes"');
    expect(textOf(two)).toBe('Pending approval · 2');
  });

  it('shows the marks under a field inline: now, and the proposed value in red', () => {
    const html = render(overlay([venue, email]), createElement(PendingInline, { groupKey: 'show:show1', prefix: 'venueName' }));
    expect(textOf(html)).toContain('Venue name Now The Basement Pending approval The Attic Pending approval');
    expect(html).toContain('class="coproducer-proposed"');
    expect(html).not.toContain('sam@new.example');
  });

  it('folds more than three marks to one line', () => {
    const many = ['a', 'b', 'c', 'd'].map((id) => mark({ key: `todos/${id}`, label: `To-do ${id}`, before: null, after: id, change: 'added' }));
    const html = render(overlay(many), createElement(PendingInline, { groupKey: 'show:show1', prefix: 'todos', title: 'To-dos' }));
    expect(html).toContain('<details class="pending-inline">');
    expect(textOf(html.split('</summary>')[0])).toBe('To-dos: 4 changes waiting for approval Pending approval');
    expect(html).toContain('To-do d');
  });

  it('strikes through a row whose removal is waiting', () => {
    const html = render(overlay([removal]), createElement(PendingRowMark, { groupKey: 'settings:potentialComics', rowKey: 'potentialComics/c1', children: 'Sam Lee' }));
    expect(html).toContain('<s class="pending-row__title">Sam Lee</s>');
    expect(textOf(html)).toBe('Sam Lee Pending approval: remove');
  });

  it('chips a row with other changes waiting, without striking it', () => {
    const html = render(overlay([email]), createElement(PendingRowMark, { groupKey: 'show:show1', rowKey: 'performers/p1', children: 'Sam Lee' }));
    expect(html).not.toMatch(/<s[ >]/);
    expect(textOf(html)).toBe('Sam Lee Pending approval');
    expect(render(overlay([email]), createElement(PendingRowMark, { groupKey: 'show:show1', rowKey: 'performers/p2', children: 'Jo' }))).toBe('Jo');
  });

  it('shows a ghost card for each show a request would add, with nothing to tap', () => {
    const html = render(overlay([], [{ requestId: 'r1', showId: 'new1', name: 'Sunday Set' }]), createElement(PendingNewShows));
    expect(html).toContain('class="show-card pending-ghost"');
    expect(textOf(html)).toBe('Sunday Set Pending approval');
    expect(html).not.toContain('<button');
    expect(html).not.toContain('href');
  });
});

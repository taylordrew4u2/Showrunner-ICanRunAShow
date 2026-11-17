import { describe, expect, it } from 'vitest';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReviewProvider, type ActionState, type ReviewContextValue } from '../../coproducer/ReviewContext';
import type { DownloadAction, ShareAction } from '../../coproducer/types';
import { AskButton } from './AskButton';
import { ContactLink } from './ContactLink';

function review(state: ActionState): ReviewContextValue {
  return {
    active: true,
    label: 'Sam',
    expiresAt: '2026-12-01T00:00:00.000Z',
    ask: () => {},
    actionState: () => state,
    deliver: () => {},
    openPending: () => {},
    pendingCount: 0,
  };
}

function inReview(state: ActionState, element: ReactElement): string {
  return renderToStaticMarkup(createElement(ReviewProvider, { value: review(state) }, element));
}

const flyer: DownloadAction = { type: 'flyer', showId: 'show1' };
const button = (action: DownloadAction | ShareAction, kind: 'share' | 'download' = 'download') =>
  createElement(AskButton, { kind, action, className: 'btn btn--secondary', children: 'Download' } as Parameters<typeof AskButton>[0]);

describe('a share or download control in co-producer view', () => {
  it('says what it usually says, and asks, when nothing is waiting, or after a refusal or a hand-over', () => {
    for (const state of [{ state: 'none' }, { state: 'rejected', requestId: 'r1' }, { state: 'used', requestId: 'r1' }] as ActionState[]) {
      const html = inReview(state, button(flyer));
      expect(html).toBe('<button type="button" class="btn btn--secondary ask-button">Download</button>');
    }
  });

  it('says Pending approval, in the red pill, and does nothing while the owner decides', () => {
    for (const state of ['pending', 'stale'] as const) {
      const html = inReview({ state, requestId: 'r1' }, button(flyer));
      expect(html).toContain('disabled=""');
      expect(html).toContain('<span class="pending-pill">Pending approval</span>');
      expect(html).not.toContain('Download');
    }
  });

  it('says it is getting the item ready', () => {
    const html = inReview({ state: 'preparing', requestId: 'r1' }, button(flyer));
    expect(html).toContain('disabled=""');
    expect(html).toContain('Getting it ready…');
  });

  it('says Sending… and takes no second tap while its ask is on the way', () => {
    const html = inReview({ state: 'sending' }, button(flyer));
    expect(html).toContain('disabled=""');
    expect(html).toContain('Sending…');
    expect(html).not.toContain('Download');
  });

  it('says what a tap will do once approved', () => {
    const cases: [DownloadAction | ShareAction, 'share' | 'download', string][] = [
      [flyer, 'download', 'Approved — tap to download'],
      [{ type: 'runsheet-pdf', showId: 'show1' }, 'download', 'Approved — tap to print or save'],
      [{ type: 'copy-text', source: 'announce-post', showId: 'show1', text: 'Tonight' }, 'share', 'Approved — tap to copy'],
      [{ type: 'email', source: 'lineup', showId: 'show1', href: 'mailto:a@example.com' }, 'share', 'Approved — tap to open email'],
      [{ type: 'viewer-link', showId: 'show1' }, 'share', 'Approved — tap to share'],
    ];
    for (const [action, kind, label] of cases) {
      const html = inReview({ state: 'approved', requestId: 'r1' }, button(action, kind));
      expect(html).toContain(`>${label}</button>`);
      expect(html).not.toContain('disabled');
    }
  });

  it('is the usual control outside co-producer view', () => {
    expect(renderToStaticMarkup(button(flyer))).toContain('>Download</button>');
  });
});

describe('an email link', () => {
  const link = createElement(ContactLink, { href: 'mailto:sam@example.com', source: 'person', className: 'perf-profile__inline-link', children: 'sam@example.com' });

  it('is a plain mailto: link in the owner’s app', () => {
    expect(renderToStaticMarkup(link)).toBe('<a class="perf-profile__inline-link" href="mailto:sam@example.com">sam@example.com</a>');
  });

  it('asks the owner first in co-producer view, with no link to follow', () => {
    const html = inReview({ state: 'none' }, link);
    expect(html).toContain('<button type="button" class="perf-profile__inline-link ask-button">sam@example.com</button>');
    expect(html).not.toContain('href');
    expect(inReview({ state: 'pending', requestId: 'r1' }, link)).toContain('Pending approval');
  });
});

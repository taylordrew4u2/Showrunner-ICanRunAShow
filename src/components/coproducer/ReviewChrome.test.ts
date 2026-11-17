import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CoproduceGate, type CoproduceGateState } from './CoproduceGate';
import { ReviewBanner } from './ReviewBanner';
import { UnsentBar } from './UnsentBar';

function textOf(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}

const noop = () => {};

describe('the co-producer link’s gate', () => {
  beforeEach(() => {
    vi.stubGlobal('location', { origin: 'https://showrunner-theta.vercel.app', protocol: 'https:', hostname: 'showrunner-theta.vercel.app' });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const gate = (state: CoproduceGateState) => renderToStaticMarkup(createElement(CoproduceGate, { state, onRetry: noop }));

  it('shows the skeleton while the account opens', () => {
    const html = gate('loading');
    expect(html).toContain('aria-label="Opening the shared account…"');
    expect(html).toContain('skeleton');
  });

  it('says why the link cannot open, with the way back to the app', () => {
    const cases: [CoproduceGateState, string, string][] = [
      ['missing', 'This link is incomplete', 'Open the full link you were sent. It ends with #t= and a long code.'],
      ['ended', 'This co-producer link has ended', 'The owner withdrew it or it expired. Ask them for a new link if you still need access.'],
      ['unreadable', "This link can't open the account any more", 'Ask the owner for a new link.'],
      ['wrong-place', 'This address only opens co-producer links', 'To use your own account, go to I Can Run A Show.'],
    ];
    for (const [state, title, text] of cases) {
      const html = gate(state);
      expect(textOf(html)).toContain(title);
      expect(textOf(html)).toContain(text);
      expect(html).toContain('href="https://icanrunashow.com/"');
      expect(textOf(html)).toContain('Go to I Can Run A Show');
      expect(html).not.toContain('Try again');
    }
  });

  it('offers to try again when offline, and nothing else', () => {
    const html = gate('offline');
    expect(textOf(html)).toContain("Couldn't open the shared account Check your connection and try again.");
    expect(html).toContain('>Try again</button>');
    expect(html).not.toContain('href');
  });
});

describe('the co-producer banner', () => {
  const banner = (pendingCount: number, offline = false) =>
    renderToStaticMarkup(createElement(ReviewBanner, { pendingCount, offline, onOpenPending: noop, onLeave: noop }));

  it('says this is co-producer view and what goes to the owner', () => {
    const text = textOf(banner(0));
    expect(text).toContain('Co-producer view');
    expect(text).toContain('Changes, shares and downloads go to the owner first.');
  });

  it('counts what is waiting on the Pending approval button', () => {
    expect(banner(3)).toContain('aria-label="Pending approval, 3 waiting"');
    expect(banner(3)).toContain('<span class="review-banner__badge" aria-hidden="true">3</span>');
    expect(banner(0)).not.toContain('review-banner__badge');
  });

  it('says when nothing can be sent', () => {
    expect(textOf(banner(0, true))).toContain("Offline — changes can't be sent for approval.");
    expect(banner(0)).not.toContain('Offline');
  });

  it('keeps Leave co-producer view in its menu', () => {
    const html = banner(0);
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('aria-expanded="false"');
  });
});

describe('the unsent bar', () => {
  const bar = (count: number, staging = false, heldBackAt: string | null = null) =>
    renderToStaticMarkup(createElement(UnsentBar, { count, staging, heldBackAt, onReview: noop, onDiscard: noop }));

  it('counts what has not been sent, and offers to review it or discard it', () => {
    expect(textOf(bar(1))).toContain('1 change not sent yet');
    expect(textOf(bar(4))).toContain('4 changes not sent yet');
    expect(bar(1)).toContain('role="region" aria-label="Changes not sent yet"');
    expect(bar(1)).toContain('>Review &amp; send</button>');
    expect(bar(1)).toContain('>Discard</button>');
  });

  it('says a file is still uploading', () => {
    expect(textOf(bar(1, true))).toContain('Uploading… your file has to finish before you can send.');
  });

  it('says the account shown is held back for the unsent changes', () => {
    expect(textOf(bar(1, false, '8:42 PM'))).toContain('Showing the account as of 8:42 PM. Send or discard your changes to see newer ones.');
  });
});

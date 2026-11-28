import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RolodexRow, shownProfileUrl } from './RolodexRow';
import type { PotentialComic, ProfileRequest } from '../types';

const origin = 'https://show.example';
const request = (over: Partial<ProfileRequest> = {}): ProfileRequest => ({
  id: 'r1',
  token: 'tok-0123456789abcdef',
  key: 'key-0123456789abcdef',
  contactId: 'c1',
  personName: 'Mona Sable',
  sentAt: '2026-09-10T00:00:00.000Z',
  ...over,
});

describe('a Rolodex row with a profile link still out asking', () => {
  it('can show the link again after a reload, rebuilt from what is filed', () => {
    // The producer switched to Messages before pasting and the app was
    // discarded. The token and key are on file; the address must come back.
    expect(shownProfileUrl(origin, 'waiting', request())).toBe(
      'https://show.example/details?t=tok-0123456789abcdef#k=key-0123456789abcdef',
    );
  });

  it('shows the link just made as it was made', () => {
    const fresh = 'https://show.example/details?t=fresh#k=fresh';
    expect(shownProfileUrl(origin, 'waiting', request(), fresh)).toBe(fresh);
  });

  it('has nothing to show once the link is answered', () => {
    // An answered link is used up; sending it again reaches a page that says so.
    const answered = request({
      submitted: { submittedAt: '2026-09-11T00:00:00.000Z', typedName: 'Mona Sable', fields: [] },
    });
    expect(shownProfileUrl(origin, 'answered', answered)).toBeUndefined();
    expect(shownProfileUrl(origin, 'waiting', answered)).toBeUndefined();
  });

  it('has nothing to show when no link was ever sent', () => {
    expect(shownProfileUrl(origin, null, undefined)).toBeUndefined();
    expect(shownProfileUrl(origin, 'waiting', undefined)).toBeUndefined();
  });
});

/**
 * The row as it is drawn. Rendered to markup, the way the other component
 * tests do it: the rules here are about what is in the page, not how it is
 * clicked.
 */
describe('a Rolodex row on the page', () => {
  const LONG = 'Bartholomew Featherstonehaugh-Montgomery III';
  const LONG_LINK = 'https://www.instagram.com/bartholomew.featherstonehaugh.montgomery.official';

  function render(comic: PotentialComic, over: Partial<Parameters<typeof RolodexRow>[0]> = {}): string {
    vi.stubGlobal('window', { location: { origin } });
    try {
      return renderToStaticMarkup(createElement(RolodexRow, {
        comic, onEdit: () => {}, linkStatus: null, onRequestDetails: () => {}, ...over,
      }));
    } finally {
      vi.unstubAllGlobals();
    }
  }
  const unescape = (html: string) => html.replace(/&#x27;/g, "'").replace(/&amp;/g, '&');

  it('keeps a long name in full where it can be read, though the row cuts it short', () => {
    const html = unescape(render({ id: 'c1', name: LONG }));
    // The button that opens the profile is named with the whole name.
    expect(html).toContain(`aria-label="Open ${LONG}'s full profile"`);
    // And the name itself carries it for a pointer.
    expect(html).toContain(`<span class="rolodex__name" title="${LONG}">`);
    expect(html).toContain(`>${LONG}<`);
  });

  it('shows a long profile link as its handle and keeps what was typed on the title', () => {
    const html = unescape(render({ id: 'c1', name: LONG, socialMedia: LONG_LINK, email: 'b@example.com', tapeMinutes: 5 }));
    expect(html).toContain(`<span class="rolodex__meta" title="${LONG_LINK} · 5-minute tape">@bartholomew.featherstonehaugh.montgomery.official · 5-minute tape</span>`);
  });

  it('gives every control in the row a name', () => {
    const waiting = request();
    for (const html of [
      render({ id: 'c1', name: 'Mona Sable' }),
      render({ id: 'c1', name: 'Mona Sable' }, { linkStatus: 'waiting', request: waiting, onWithdraw: () => {} }),
      render({ id: 'c1', name: 'Mona Sable' }, { linkStatus: 'waiting', request: waiting, linkUrl: 'https://show.example/details?t=fresh#k=fresh', onWithdraw: () => {} }),
    ]) {
      const controls = [...html.matchAll(/<(button|input)\b([^>]*)>(?:([\s\S]*?)<\/button>)?/g)];
      expect(controls.length).toBeGreaterThan(1);
      for (const [tag, kind, attrs, inner] of controls) {
        const label = attrs.match(/aria-label="([^"]+)"/)?.[1];
        const text = kind === 'button' ? (inner ?? '').replace(/<[^>]+>/g, '').trim() : '';
        expect(label || text, tag).toBeTruthy();
      }
    }
  });

  it('draws the monogram as decoration: the initials are never read out beside the name', () => {
    const html = render({ id: 'c1', name: 'Mona Sable' });
    expect(html).toMatch(/<span class="[^"]*rolodex__monogram[^"]*" data-tone="[1-4]" aria-hidden="true">MS<\/span>/);
  });

  it('says what is missing in words, and nothing when nothing is', () => {
    expect(render({ id: 'c1', name: 'Mona Sable' })).toContain('Needs email, social handle');
    expect(render({ id: 'c1', name: 'Mona Sable', email: 'mona@example.com', socialMedia: '@monasable' })).not.toContain('rolodex__gaps');
  });
});

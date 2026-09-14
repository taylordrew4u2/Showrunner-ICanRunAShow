import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  sharedLinkPage,
  sharedLinkPageName,
  sharedLinkPath,
  sharedLinkRoute,
} from './sharedLink';

// The real file, not a fixture. The bug was in what index.html says about
// itself, so a fixture that had drifted from it would prove nothing.
const indexHtml = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const page = sharedLinkPage(indexHtml, 'sign');

describe('the page a sent link opens', () => {
  it('does not claim to be the homepage, so a preview card cannot send a signer to the login screen', () => {
    expect(page).not.toContain('rel="canonical"');
    expect(page).not.toContain('property="og:url"');
    expect(page).not.toContain('https://icanrunashow.com/"');
  });

  it('still loads the same app as the homepage', () => {
    // Whatever the bundle is called this build, both pages must ask for it.
    const script = /<script[^>]*src="([^"]+)"/.exec(indexHtml)?.[1];
    expect(script).toBeTruthy();
    expect(page).toContain(script!);
    expect(page).toContain('<div id="root">');
  });

  it('asks not to be indexed, because a private link is not a page', () => {
    expect(page).toContain('content="noindex, nofollow"');
    expect(page).not.toContain('content="index, follow"');
  });

  it('says on the preview card that an agreement is what was sent', () => {
    // The card is built by a crawler that never runs the app, so this has to
    // be in the file. A comedian should see what it is before opening it.
    expect(page).toContain('<title>An agreement to sign — I Can Run A Show</title>');
    expect(page).toContain('content="An agreement to sign"');
    expect(page).toContain('a contract to read and sign');
    expect(page).toContain('No account, no app, no signing up');
    // None of the marketing copy aimed at producers, and not the promo
    // screenshot either — paperwork should not arrive looking like an advert.
    expect(page).not.toContain('Build your lineup');
    expect(page).not.toContain('og-image.png');
  });

  it('drops the product listing, which was a third claim to be the homepage', () => {
    // "url": "https://icanrunashow.com" inside a SoftwareApplication block,
    // complete with a price and a feature list. Not a description of a
    // contract, and one more thing pointing a card away from the link.
    expect(indexHtml).toContain('application/ld+json');
    expect(page).not.toContain('application/ld+json');
    expect(page).not.toContain('SoftwareApplication');
    expect(page).not.toContain('icanrunashow.com');
  });

  it('says what each other kind of link is, in its own words', () => {
    const profile = sharedLinkPage(indexHtml, 'profile');
    expect(profile).toContain('content="Your performer details"');
    expect(profile).toContain('asked you for your details');
    // Asking someone for their details is not sending them a contract.
    expect(profile).not.toContain('An agreement to sign');

    const view = sharedLinkPage(indexHtml, 'view');
    expect(view).toContain("content=\"Tonight's running order\"");
    expect(view).toContain('Follow the running order live');
  });

  it('serves each kind from the file the rewrites point at', () => {
    expect(sharedLinkPageName('sign')).toBe('link-sign.html');
    expect(sharedLinkPageName('profile')).toBe('link-profile.html');
    expect(sharedLinkPageName('view')).toBe('link-view.html');
  });

  it('leaves the homepage itself alone', () => {
    expect(indexHtml).toContain('rel="canonical"');
    expect(indexHtml).toContain('content="index, follow"');
  });
});

describe('where a sent link goes', () => {
  it('opens the page the link is addressed to', () => {
    expect(sharedLinkRoute('?t=tok123', '/sign')).toEqual({ kind: 'sign', token: 'tok123' });
    expect(sharedLinkRoute('?t=tok123', '/details')).toEqual({ kind: 'profile', token: 'tok123' });
    expect(sharedLinkRoute('?t=tok123', '/live')).toEqual({ kind: 'view', token: 'tok123' });
  });

  it('is addressed to a path, because a rewrite on / can never run', () => {
    // Vercel answers `/` from the filesystem before it consults the rewrites,
    // so the first version of this shipped a correct link-sign.html that
    // nothing was ever routed to. `/sign` is not a file, so the rewrite is
    // reached — the same reason the SPA catch-all works.
    expect(sharedLinkPath('sign', 'tok123')).toBe('/sign?t=tok123');
    expect(sharedLinkPath('profile', 'tok123')).toBe('/details?t=tok123');
    expect(sharedLinkPath('view', 'tok123')).toBe('/live?t=tok123');
    expect(sharedLinkPath('sign', 'a b&c')).toBe('/sign?t=a%20b%26c');
  });

  it('still opens links sent before the address changed', () => {
    // Contracts get opened months later. The old shape has to keep working
    // for as long as any of them are outstanding, which is indefinitely.
    expect(sharedLinkRoute('?sign=tok123', '/')).toEqual({ kind: 'sign', token: 'tok123' });
    expect(sharedLinkRoute('?profile=tok123', '/')).toEqual({ kind: 'profile', token: 'tok123' });
    expect(sharedLinkRoute('?view=tok123', '/')).toEqual({ kind: 'view', token: 'tok123' });
    // And with no pathname given at all, as the old callers passed it.
    expect(sharedLinkRoute('?sign=tok123')).toEqual({ kind: 'sign', token: 'tok123' });
  });

  it('still opens that page when the token was trimmed off on the way', () => {
    // Falling through to the app here is how a performer ended up at a login
    // for an account they will never have. The signing page can say the link
    // is broken; the login screen can only ask them to sign up.
    expect(sharedLinkRoute('', '/sign')).toEqual({ kind: 'sign', token: '' });
    expect(sharedLinkRoute('?t=', '/sign')).toEqual({ kind: 'sign', token: '' });
    expect(sharedLinkRoute('?sign=')).toEqual({ kind: 'sign', token: '' });
    expect(sharedLinkRoute('?sign')).toEqual({ kind: 'sign', token: '' });
  });

  it('opens a link that picked up a slash or a capital on the way', () => {
    expect(sharedLinkRoute('?t=tok123', '/sign/')).toEqual({ kind: 'sign', token: 'tok123' });
    expect(sharedLinkRoute('?t=tok123', '/Sign')).toEqual({ kind: 'sign', token: 'tok123' });
  });

  it('is not confused by whatever a messaging app added to the link', () => {
    expect(sharedLinkRoute('?t=tok123&fbclid=abc&utm_source=x', '/sign')).toEqual({
      kind: 'sign',
      token: 'tok123',
    });
    expect(sharedLinkRoute('?utm_source=x&t=tok123', '/sign')).toEqual({
      kind: 'sign',
      token: 'tok123',
    });
  });

  it('sends the producer to their own app, not to a link page', () => {
    expect(sharedLinkRoute('', '/')).toBeNull();
    expect(sharedLinkRoute('?tab=shows', '/')).toBeNull();
    // Not a substring match: a path or parameter that merely contains one of
    // the names belongs to somebody else.
    expect(sharedLinkRoute('?signup=1', '/')).toBeNull();
    expect(sharedLinkRoute('?preview=1', '/')).toBeNull();
    expect(sharedLinkRoute('', '/signup')).toBeNull();
    expect(sharedLinkRoute('', '/guides/signing')).toBeNull();
    // A token alone is not a link — it has to say which kind.
    expect(sharedLinkRoute('?t=tok123', '/')).toBeNull();
  });
});

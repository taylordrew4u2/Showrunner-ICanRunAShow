import { describe, expect, it } from 'vitest';
import { NAVIGATE_FALLBACK_DENYLIST } from './navigationFallback';

/**
 * Whether the service worker leaves a navigation to the host rather than
 * answering it with the app shell. Workbox tests the denylist against the
 * path and query string.
 */
function leftToHost(address: string): boolean {
  const url = new URL(address, 'https://icanrunashow.com');
  return NAVIGATE_FALLBACK_DENYLIST.some((pattern) => pattern.test(url.pathname + url.search));
}

describe('which navigations the installed app leaves to the host', () => {
  it('sends the short sales addresses on to the redirects and rewrites the host has for them', () => {
    // An installed producer who tapped /pricing in an email landed on their
    // shows: the worker answered it with the app, and the redirect to the
    // pricing section never ran.
    expect(leftToHost('/pricing')).toBe(true);
    expect(leftToHost('/pricing?ref=bio')).toBe(true);
    expect(leftToHost('/features')).toBe(true);
    expect(leftToHost('/tour')).toBe(true);
    expect(leftToHost('/guides')).toBe(true);
  });

  it('sends files it does not keep to the host', () => {
    expect(leftToHost('/robots.txt')).toBe(true);
    expect(leftToHost('/sitemap.xml')).toBe(true);
    expect(leftToHost('/llms.txt')).toBe(true);
    expect(leftToHost('/api/billing')).toBe(true);
  });

  it('still opens the app, offline included, for every address the app answers', () => {
    expect(leftToHost('/')).toBe(false);
    expect(leftToHost('/sign?t=abc123')).toBe(false);
    expect(leftToHost('/details?t=abc123')).toBe(false);
    expect(leftToHost('/live?t=abc123')).toBe(false);
    // The older form of a sent link, still in people's messages.
    expect(leftToHost('/?sign=abc123')).toBe(false);
    // A token is not a file name, whatever it happens to end in.
    expect(leftToHost('/sign?t=abc.txt')).toBe(false);
  });
});

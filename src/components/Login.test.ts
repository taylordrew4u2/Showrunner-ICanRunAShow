import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Login } from './Login';

describe('the username field on the sign-in screen', () => {
  it('is not capitalised or corrected by a phone keyboard', () => {
    // iOS capitalises the first letter of a text field by default, so the same
    // producer signs in as "Taylor" one day and "taylor" the next.
    const html = renderToStaticMarkup(createElement(Login, { onSignIn: () => undefined, onSignUp: () => undefined }));
    const username = html.match(/<input[^>]*autocomplete="username"[^>]*>/i)?.[0] ?? '';
    expect(username).toMatch(/autocapitalize="none"/i);
    expect(username).toMatch(/autocorrect="off"/i);
    expect(username).toMatch(/spellcheck="false"/i);
  });
});

describe('the links to the sales page', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const render = () => renderToStaticMarkup(createElement(Login, { onSignIn: () => undefined, onSignUp: () => undefined }));

  it('promise pricing in a browser', () => {
    vi.stubGlobal('window', {});
    const html = render();
    expect(html).toContain('See everything it does, and pricing →');
    expect(html).toContain('Features &amp; pricing');
  });

  it('do not promise pricing in the iOS app, where the sales page leaves it out', () => {
    // App Store guideline 3.1.1: nothing in the app points at a price.
    vi.stubGlobal('window', { Capacitor: { isNativePlatform: () => true } });
    const html = render();
    expect(html).not.toMatch(/pricing/i);
    expect(html).toContain('See everything it does →');
    expect(html).toMatch(/<a href="\/tour\/">Features<\/a>/);
  });
});

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { sharedLinkPage, sharedLinkRoute } from './sharedLink';

// The real file, not a fixture. The bug was in what index.html says about
// itself, so a fixture that had drifted from it would prove nothing.
const indexHtml = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const page = sharedLinkPage(indexHtml);

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

  it('previews as the thing the person was actually sent', () => {
    expect(page).toContain('<title>Your link — I Can Run A Show</title>');
    expect(page).toContain('Open your link');
    expect(page).toContain('No account needed');
    // None of the marketing copy aimed at producers.
    expect(page).not.toContain('Build your lineup');
  });

  it('leaves the homepage itself alone', () => {
    expect(indexHtml).toContain('rel="canonical"');
    expect(indexHtml).toContain('content="index, follow"');
  });
});

describe('where a sent link goes', () => {
  it('opens the page the link addresses', () => {
    expect(sharedLinkRoute('?sign=tok123')).toEqual({ kind: 'sign', token: 'tok123' });
    expect(sharedLinkRoute('?profile=tok123')).toEqual({ kind: 'profile', token: 'tok123' });
    expect(sharedLinkRoute('?view=tok123')).toEqual({ kind: 'view', token: 'tok123' });
  });

  it('still opens that page when the token was trimmed off on the way', () => {
    // Falling through to the app here is how a performer ended up at a login
    // for an account they will never have. The signing page can say the link
    // is broken; the login screen can only ask them to sign up.
    expect(sharedLinkRoute('?sign=')).toEqual({ kind: 'sign', token: '' });
    expect(sharedLinkRoute('?sign')).toEqual({ kind: 'sign', token: '' });
    expect(sharedLinkRoute('?profile=')).toEqual({ kind: 'profile', token: '' });
  });

  it('is not confused by whatever a messaging app added to the link', () => {
    expect(sharedLinkRoute('?sign=tok123&fbclid=abc&utm_source=x')).toEqual({
      kind: 'sign',
      token: 'tok123',
    });
    expect(sharedLinkRoute('?utm_source=x&sign=tok123')).toEqual({ kind: 'sign', token: 'tok123' });
  });

  it('sends the producer to their own app, not to a link page', () => {
    expect(sharedLinkRoute('')).toBeNull();
    expect(sharedLinkRoute('?tab=shows')).toBeNull();
    // Not a substring match: a parameter that merely contains one of the names
    // is somebody else's parameter.
    expect(sharedLinkRoute('?signup=1')).toBeNull();
    expect(sharedLinkRoute('?preview=1')).toBeNull();
  });
});

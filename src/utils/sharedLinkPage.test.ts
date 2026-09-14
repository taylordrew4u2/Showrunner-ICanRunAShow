import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { sharedLinkPage } from './sharedLinkPage';

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

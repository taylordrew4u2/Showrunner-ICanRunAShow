import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionCredentials } from '../../utils/session-vault';
import { canMakeLink, CoproducersCard, COPRODUCERS_TEXT } from './CoproducersCard';

const session: SessionCredentials = { username: 'producer', userId: 'u1', authHash: 'auth', key: 'a'.repeat(64), legacyKey: 'b'.repeat(64) };

function at(origin: string) {
  const url = new URL(origin);
  vi.stubGlobal('location', { origin: url.origin, protocol: url.protocol, hostname: url.hostname });
}

const render = () => renderToStaticMarkup(createElement(CoproducersCard, { session, onOpenRequests: () => {} }));

/** React escapes apostrophes and quotes in text; compare like with like. */
function escaped(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/'/g, '&#x27;').replace(/"/g, '&quot;');
}

describe('Settings → Co-producers', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('says what a link shares before anything can be made', () => {
    at('https://icanrunashow.com');
    const html = render();
    expect(html).toContain('Co-producers');
    expect(html).toContain(escaped(COPRODUCERS_TEXT.hint));
    expect(html).toContain(escaped(COPRODUCERS_TEXT.consent));
    expect(html).toContain('I understand what this shares');
    expect(html).toContain('placeholder="e.g. Sam Rivera"');
    expect(html).toContain('maxLength="60"');
    // Unticked by default, and Make link waits for a name and the tick.
    expect(html).not.toMatch(/type="checkbox"[^>]*checked/);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Make link<\/button>/);
  });

  it('Make link needs a name and the tick', () => {
    expect(canMakeLink('', true)).toBe(false);
    expect(canMakeLink('   ', true)).toBe(false);
    expect(canMakeLink('Sam Rivera', false)).toBe(false);
    expect(canMakeLink('Sam Rivera', true)).toBe(true);
    expect(canMakeLink('x'.repeat(61), true)).toBe(false);
  });

  it('shows no form where links can’t be made', () => {
    at('https://showrunner-git-branch.vercel.app');
    const html = render();
    expect(html).toContain(escaped(COPRODUCERS_TEXT.notConfigured));
    expect(html).not.toContain('Make link');
    expect(html).not.toContain('<input');
    expect(html).not.toContain(escaped(COPRODUCERS_TEXT.consent));
  });

  it('offers links in local development', () => {
    at('http://localhost:5173');
    expect(render()).toContain('Make link');
  });
});

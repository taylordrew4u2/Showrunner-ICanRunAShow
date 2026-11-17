import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  coproduceConfiguredAt,
  isLocalOrigin,
  mainOriginAt,
  mainOriginFor,
  parseOriginSetting,
  reviewOriginAt,
  reviewOriginFor,
  type OriginLocation,
} from './originRules';
import { coproduceConfigured, mainOrigin, onReviewOrigin, reviewOrigin } from './origins';

function at(origin: string): OriginLocation {
  const url = new URL(origin);
  return { origin: url.origin, protocol: url.protocol, hostname: url.hostname };
}

describe('the review origin rules', () => {
  it('puts the review origin on the coproduce subdomain of the main one', () => {
    expect(reviewOriginFor('https://icanrunashow.com')).toBe('https://coproduce.icanrunashow.com');
    expect(reviewOriginFor('https://icanrunashow.com/')).toBe('https://coproduce.icanrunashow.com');
    expect(reviewOriginFor('https://staging.example.com:8443')).toBe('https://coproduce.staging.example.com:8443');
    expect(mainOriginFor('https://coproduce.icanrunashow.com')).toBe('https://icanrunashow.com');
  });

  it('gives no review origin where there cannot be one', () => {
    for (const origin of ['http://icanrunashow.com', 'https://localhost', 'https://127.0.0.1', 'https://coproduce.icanrunashow.com', 'not a url']) {
      expect(reviewOriginFor(origin)).toBeNull();
    }
    for (const origin of ['https://icanrunashow.com', 'http://coproduce.icanrunashow.com', 'https://coproduce.com']) {
      expect(mainOriginFor(origin)).toBeNull();
    }
  });

  it('works production out from the page’s own address', () => {
    expect(reviewOriginAt(at('https://icanrunashow.com'))).toBe('https://coproduce.icanrunashow.com');
    expect(reviewOriginAt(at('https://coproduce.icanrunashow.com'))).toBe('https://coproduce.icanrunashow.com');
    expect(mainOriginAt(at('https://coproduce.icanrunashow.com'))).toBe('https://icanrunashow.com');
    expect(mainOriginAt(at('https://icanrunashow.com'))).toBe('https://icanrunashow.com');
    expect(coproduceConfiguredAt(at('https://icanrunashow.com'))).toBe(true);
  });

  it('fails closed on previews and other hosts with no coproduce sibling', () => {
    for (const origin of ['https://showrunner-git-branch-team.vercel.app', 'https://example.com', 'https://coproduce.example.com']) {
      expect(reviewOriginAt(at(origin))).toBe('');
      expect(coproduceConfiguredAt(at(origin))).toBe(false);
      expect(mainOriginAt(at(origin))).toBe(new URL(origin).origin);
    }
  });

  it('allows links on localhost and 127.0.0.1, where review mode runs on the page’s own origin', () => {
    for (const origin of ['http://localhost:5173', 'http://127.0.0.1:4173']) {
      expect(reviewOriginAt(at(origin))).toBe('');
      expect(coproduceConfiguredAt(at(origin))).toBe(true);
      expect(isLocalOrigin(origin)).toBe(true);
    }
    expect(isLocalOrigin('https://icanrunashow.com')).toBe(false);
  });

  it('lets an explicit override win', () => {
    const local = at('http://localhost:4173');
    expect(reviewOriginAt(local, 'http://127.0.0.1:4173')).toBe('http://127.0.0.1:4173');
    expect(mainOriginAt(at('http://127.0.0.1:4173'), 'http://localhost:4173')).toBe('http://localhost:4173');
  });

  it('accepts only https origins, or http on localhost with a port, as overrides', () => {
    expect(parseOriginSetting(undefined)).toBeNull();
    expect(parseOriginSetting('  ')).toBeNull();
    expect(parseOriginSetting('https://coproduce.icanrunashow.com')).toBe('https://coproduce.icanrunashow.com');
    expect(parseOriginSetting('https://coproduce.icanrunashow.com/')).toBe('https://coproduce.icanrunashow.com');
    expect(parseOriginSetting('http://127.0.0.1:4173')).toBe('http://127.0.0.1:4173');
    for (const bad of ['http://coproduce.icanrunashow.com', 'http://localhost', 'https://x.com/path', 'https://u:p@x.com', 'javascript:alert(1)', 'nope']) {
      expect(() => parseOriginSetting(bad)).toThrow();
    }
  });
});

describe('the app’s own view', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  function visit(origin: string) {
    vi.stubGlobal('location', at(origin));
  }

  it('on the main site', () => {
    visit('https://icanrunashow.com');
    expect(reviewOrigin()).toBe('https://coproduce.icanrunashow.com');
    expect(mainOrigin()).toBe('https://icanrunashow.com');
    expect(onReviewOrigin()).toBe(false);
    expect(coproduceConfigured()).toBe(true);
  });

  it('on the review origin', () => {
    visit('https://coproduce.icanrunashow.com');
    expect(onReviewOrigin()).toBe(true);
    expect(mainOrigin()).toBe('https://icanrunashow.com');
  });

  it('on a preview', () => {
    visit('https://showrunner-abc.vercel.app');
    expect(reviewOrigin()).toBe('');
    expect(onReviewOrigin()).toBe(false);
    expect(coproduceConfigured()).toBe(false);
  });

  it('with the end-to-end overrides', () => {
    vi.stubEnv('VITE_COPRODUCE_ORIGIN', 'http://127.0.0.1:4173');
    vi.stubEnv('VITE_MAIN_ORIGIN', 'http://localhost:4173');
    visit('http://localhost:4173');
    expect(reviewOrigin()).toBe('http://127.0.0.1:4173');
    expect(onReviewOrigin()).toBe(false);
    visit('http://127.0.0.1:4173');
    expect(onReviewOrigin()).toBe(true);
    expect(mainOrigin()).toBe('http://localhost:4173');
  });

  it('ignores a malformed override', () => {
    vi.stubEnv('VITE_COPRODUCE_ORIGIN', 'http://evil.example');
    visit('https://showrunner-abc.vercel.app');
    expect(reviewOrigin()).toBe('');
    expect(coproduceConfigured()).toBe(false);
  });
});

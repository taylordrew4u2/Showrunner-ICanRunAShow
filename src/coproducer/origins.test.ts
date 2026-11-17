import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  coproduceConfiguredAt,
  isLocalOrigin,
  mainOriginAt,
  mainOriginFor,
  parseOriginSetting,
  REVIEW_ORIGINS,
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
  it('pairs each main origin with the review origin listed for it', () => {
    expect(REVIEW_ORIGINS).toEqual({ 'https://icanrunashow.com': 'https://showrunner-theta.vercel.app' });
    expect(reviewOriginFor('https://icanrunashow.com')).toBe('https://showrunner-theta.vercel.app');
    expect(reviewOriginFor('https://icanrunashow.com/')).toBe('https://showrunner-theta.vercel.app');
    expect(reviewOriginFor('https://ICanRunAShow.com')).toBe('https://showrunner-theta.vercel.app');
    expect(mainOriginFor('https://showrunner-theta.vercel.app')).toBe('https://icanrunashow.com');
    expect(mainOriginFor('https://showrunner-theta.vercel.app/coproduce')).toBe('https://icanrunashow.com');
  });

  it('lists only bare https origins, each review origin on another site and listed once', () => {
    const mains = Object.keys(REVIEW_ORIGINS);
    const reviews = Object.values(REVIEW_ORIGINS);
    for (const origin of [...mains, ...reviews]) {
      expect(new URL(origin).origin, origin).toBe(origin);
      expect(origin.startsWith('https://'), origin).toBe(true);
    }
    expect(new Set(reviews).size).toBe(reviews.length);
    for (const review of reviews) expect(mains, review).not.toContain(review);
  });

  it('gives no review origin where none is listed', () => {
    for (const origin of [
      'http://icanrunashow.com',
      'https://www.icanrunashow.com',
      'https://coproduce.icanrunashow.com',
      'https://icanrunashow.com:8443',
      'https://staging.example.com',
      'https://localhost',
      'https://127.0.0.1',
      'https://showrunner-theta.vercel.app',
      'https://constructor',
      'not a url',
    ]) {
      expect(reviewOriginFor(origin), origin).toBeNull();
    }
    for (const origin of [
      'https://icanrunashow.com',
      'http://showrunner-theta.vercel.app',
      'https://x.showrunner-theta.vercel.app',
      'https://showrunner-theta.vercel.app.evil.test',
      'https://showrunner-other.vercel.app',
      'https://coproduce.icanrunashow.com',
      'not a url',
    ]) {
      expect(mainOriginFor(origin), origin).toBeNull();
    }
  });

  it('works production out from the page’s own address', () => {
    expect(reviewOriginAt(at('https://icanrunashow.com'))).toBe('https://showrunner-theta.vercel.app');
    expect(reviewOriginAt(at('https://showrunner-theta.vercel.app'))).toBe('https://showrunner-theta.vercel.app');
    expect(mainOriginAt(at('https://showrunner-theta.vercel.app'))).toBe('https://icanrunashow.com');
    expect(mainOriginAt(at('https://icanrunashow.com'))).toBe('https://icanrunashow.com');
    expect(coproduceConfiguredAt(at('https://icanrunashow.com'))).toBe(true);
  });

  it('fails closed on previews and every other host', () => {
    for (const origin of [
      'https://showrunner-git-branch-team.vercel.app',
      'https://example.com',
      'https://coproduce.example.com',
      'https://coproduce.icanrunashow.com',
      'http://icanrunashow.com',
      'http://showrunner-theta.vercel.app',
    ]) {
      expect(reviewOriginAt(at(origin)), origin).toBe('');
      expect(coproduceConfiguredAt(at(origin)), origin).toBe(false);
      expect(mainOriginAt(at(origin)), origin).toBe(new URL(origin).origin);
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
    expect(parseOriginSetting('https://review.example.test')).toBe('https://review.example.test');
    expect(parseOriginSetting('https://review.example.test/')).toBe('https://review.example.test');
    expect(parseOriginSetting('http://127.0.0.1:4173')).toBe('http://127.0.0.1:4173');
    for (const bad of ['http://review.example.test', 'http://localhost', 'https://x.com/path', 'https://u:p@x.com', 'javascript:alert(1)', 'nope']) {
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
    expect(reviewOrigin()).toBe('https://showrunner-theta.vercel.app');
    expect(mainOrigin()).toBe('https://icanrunashow.com');
    expect(onReviewOrigin()).toBe(false);
    expect(coproduceConfigured()).toBe(true);
  });

  it('on the review origin', () => {
    visit('https://showrunner-theta.vercel.app');
    expect(reviewOrigin()).toBe('https://showrunner-theta.vercel.app');
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

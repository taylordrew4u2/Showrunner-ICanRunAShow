import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The real file: it is what the host routes and caches by.
const config = JSON.parse(
  readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8'),
) as {
  rewrites: { source: string; destination: string }[];
  headers: { source: string; headers: { key: string; value: string }[] }[];
};

/**
 * A rewrite source as the regular expression it stands for. Sound for the
 * sources here, which are literal paths and regex groups with no `:name`
 * parameters; the assertion keeps it that way.
 */
function pattern(source: string): RegExp {
  expect(source).not.toMatch(/:\w/);
  return new RegExp(`^${source}$`);
}

/** Where the host sends a request that is not a file in the build. */
function rewrittenTo(path: string): string | null {
  return config.rewrites.find((rule) => pattern(rule.source).test(path))?.destination ?? null;
}

describe('the app shell fallback', () => {
  it('still answers the app routes with the app', () => {
    expect(rewrittenTo('/')).toBe('/index.html');
    expect(rewrittenTo('/shows/anything')).toBe('/index.html');
    expect(rewrittenTo('/sign')).toBe('/link-sign.html');
  });

  it('does not answer a build file that is gone with the app shell', () => {
    // A page opened before a deploy asks for the old build's files. Served
    // index.html instead, the import failed on a MIME type rather than a
    // missing file — and the /assets/ header then cached that HTML as
    // immutable for a year under the script's name.
    expect(rewrittenTo('/assets/AIImportFlow-BdVwvJfv.js')).toBeNull();
    expect(rewrittenTo('/assets/index-BN6X7RKC.css')).toBeNull();
  });
});

describe('what browsers are told they may keep', () => {
  it('marks only files whose names change with their contents as never changing', () => {
    // The icons keep their names through every redraw. Marked immutable for a
    // year, a browser that had fetched the old artwork installed the app with
    // it after the rebrand, and no reload fixed it.
    const immutable = config.headers
      .filter((rule) => rule.headers.some((h) => h.key === 'Cache-Control' && /immutable/.test(h.value)))
      .map((rule) => rule.source);
    expect(immutable).toEqual(['/assets/(.*)']);
  });
});

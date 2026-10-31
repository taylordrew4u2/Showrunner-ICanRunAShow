import { webcrypto } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installPolyfills } from './polyfills';

// iOS 15.0 to 15.3, which the App Store build installs on, have none of
// these. Node has them all, so each test takes one away first.

const atDescriptor = Object.getOwnPropertyDescriptor(Array.prototype, 'at')!;
const hasOwnDescriptor = Object.getOwnPropertyDescriptor(Object, 'hasOwn')!;

afterEach(() => {
  Object.defineProperty(Array.prototype, 'at', atDescriptor);
  Object.defineProperty(Object, 'hasOwn', hasOwnDescriptor);
  vi.unstubAllGlobals();
});

describe('Array.prototype.at where it is missing', () => {
  it('reads from either end, as the built-in does', () => {
    delete (Array.prototype as { at?: unknown }).at;
    installPolyfills();
    const drafts = ['first', 'middle', 'newest'];
    expect(drafts.at(-1)).toBe('newest');
    expect(drafts.at(0)).toBe('first');
    expect(drafts.at(1.9)).toBe('middle');
    expect(drafts.at(3)).toBeUndefined();
    expect(drafts.at(-4)).toBeUndefined();
    expect([].at(-1)).toBeUndefined();
  });

  it('adds nothing a for…in over an array would find', () => {
    delete (Array.prototype as { at?: unknown }).at;
    installPolyfills();
    const keys: string[] = [];
    for (const key in ['a']) keys.push(key);
    expect(keys).toEqual(['0']);
  });
});

describe('Object.hasOwn where it is missing', () => {
  it('tells own fields from inherited ones, as the built-in does', () => {
    delete (Object as { hasOwn?: unknown }).hasOwn;
    installPolyfills();
    const patch = Object.create({ inherited: 1 }) as Record<string, unknown>;
    patch.photo = undefined;
    expect(Object.hasOwn(patch, 'photo')).toBe(true);
    expect(Object.hasOwn(patch, 'inherited')).toBe(false);
    expect(Object.hasOwn({ hasOwnProperty: () => true }, 'missing')).toBe(false);
    expect(() => Object.hasOwn(null as unknown as object, 'x')).toThrow(TypeError);
  });
});

describe('crypto.randomUUID where it is missing', () => {
  it('makes version 4 UUIDs from the secure random source', () => {
    // App.tsx calls it while its module loads, so without it nothing renders.
    const fake = { getRandomValues: (a: Uint8Array) => webcrypto.getRandomValues(a) } as unknown as Crypto;
    vi.stubGlobal('crypto', fake);
    installPolyfills();
    const ids = Array.from({ length: 50 }, () => fake.randomUUID());
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('where the built-ins are there', () => {
  it('leaves every one of them alone', () => {
    const at = Array.prototype.at;
    const hasOwn = Object.hasOwn;
    const randomUUID = crypto.randomUUID;
    installPolyfills();
    expect(Array.prototype.at).toBe(at);
    expect(Object.hasOwn).toBe(hasOwn);
    expect(crypto.randomUUID).toBe(randomUUID);
  });
});

describe('the app on iOS 15.0 to 15.3', () => {
  const srcRoot = new URL('./', import.meta.url);

  it('loads the polyfills before any other module', () => {
    // Imports run in order, and App.tsx needs randomUUID as it loads.
    const main = readFileSync(new URL('main.tsx', srcRoot), 'utf8');
    expect(main.match(/^import .*$/m)?.[0]).toBe("import './polyfills'");
  });

  it('calls no newer built-in that the polyfills do not cover', () => {
    // Safari 15.4 or later, and nothing here adds them. Built from pieces so
    // this file does not find itself.
    const newer = new RegExp(
      ['structuredClone\\(', '\\.findLast(Index)?\\(', '\\.to(Sorted|Reversed|Spliced)\\(', 'Object\\.groupBy\\(',
        'Promise\\.withResolvers\\(', 'AbortSignal\\.(timeout|any)\\('].join('|'),
    );
    const sources = (dir: URL): URL[] => readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory()
        ? sources(new URL(`${entry.name}/`, dir))
        : /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [new URL(entry.name, dir)] : []);
    const offenders = sources(srcRoot)
      .filter((file) => newer.test(readFileSync(file, 'utf8')))
      .map((file) => file.pathname.slice(srcRoot.pathname.length));
    expect(offenders).toEqual([]);
  });
});

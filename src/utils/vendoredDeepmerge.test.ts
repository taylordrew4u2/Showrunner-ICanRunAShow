import { describe, expect, it } from 'vitest';
import deepmerge from 'deepmerge';

// deepmerge reaches the build through vite-plugin-pwa → workbox-build →
// @rollup/plugin-node-resolve, and is overridden to the patched copy in
// vendor/deepmerge (CVE-2026-93753, no fixed release upstream). These pin the
// patch, so a lockfile change that brings the registry copy back fails here.
const poisoned = () => JSON.parse('{"__proto__":{"polluted":"yes"}}') as Record<string, unknown>;

describe('the vendored deepmerge', () => {
  it('is the patched copy', async () => {
    const { version } = (await import('deepmerge/package.json', { with: { type: 'json' } })).default;
    expect(version).toBe('4.3.2-patched.1');
  });

  it.each([
    ['null', null],
    ['a number', 1],
    ['a string', 'x'],
    ['an object', {}],
  ])('never hands back a replaced prototype when the target is %s', (_, target) => {
    const merged = deepmerge(target as object, poisoned()) as Record<string, unknown>;
    expect(Object.getPrototypeOf(merged)).toBe(Object.prototype);
    expect(merged.polluted).toBeUndefined();
  });

  it('keeps a nested result clean when the nested target is not an object', () => {
    const merged = deepmerge({ a: 1 }, { a: poisoned() }) as { a: Record<string, unknown> };
    expect(Object.getPrototypeOf(merged.a)).toBe(Object.prototype);
    expect(merged.a.polluted).toBeUndefined();
  });

  it('still merges ordinary objects the way it always has', () => {
    expect(deepmerge({ a: { b: 1 }, list: [1] }, { a: { c: 2 }, list: [2] })).toEqual({
      a: { b: 1, c: 2 },
      list: [1, 2],
    });
  });
});

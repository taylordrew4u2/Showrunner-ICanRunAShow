import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const srcRoot = new URL('../', import.meta.url);

/** Every app source file under src/, tests aside: those never reach a phone. */
function appSources(dir: URL): URL[] {
  const files: URL[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) files.push(...appSources(new URL(`${entry.name}/`, dir)));
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) files.push(new URL(entry.name, dir));
  }
  return files;
}

// Built from pieces so this file does not find itself.
const LOOKBEHIND = new RegExp('\\(\\?<[=!]');

describe('regular expressions an older iPhone can parse', () => {
  // Safari only learned lookbehind in 16.4, and the iOS app supports iOS 15.
  // A regex literal it cannot parse is a syntax error for the whole script it
  // sits in, so one of these in the entry chunk leaves the app on its splash
  // screen for good — signing links included. Nothing can down-level one, so
  // the only fix is not to write one.
  it('uses no lookbehind anywhere in the app', () => {
    const offenders = appSources(srcRoot)
      .filter((file) => LOOKBEHIND.test(readFileSync(file, 'utf8')))
      .map((file) => file.pathname.slice(srcRoot.pathname.length));
    expect(offenders).toEqual([]);
  });
});

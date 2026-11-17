import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Co-producer view holds back everything that hands something over, at the
// few helpers that do it (gates.ts and the file helpers). A clipboard write
// or a share sheet called anywhere else would hand things out around them.
const ALLOWED = new Set([
  'coproducer/gates.ts',
  'utils/download.ts',
  'utils/headshotExport.ts',
  // The public pages a performer opens: never in co-producer view.
  'components/SigningPage.tsx',
  'components/ProfilePage.tsx',
]);

const srcRoot = new URL('../', import.meta.url);

function sources(dir: URL): URL[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? sources(new URL(`${entry.name}/`, dir))
      : /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [new URL(entry.name, dir)] : []);
}

describe('handing things over', () => {
  it('reaches the clipboard and the share sheet only through the gated helpers', () => {
    // Built from pieces so this file does not find itself.
    const direct = new RegExp(['navigator', '\\.clipboard'].join('') + '|' + ['navigator', '\\.share\\('].join(''));
    const offenders = sources(srcRoot)
      .map((file) => file.pathname.slice(srcRoot.pathname.length))
      .filter((file) => !ALLOWED.has(file))
      .filter((file) => direct.test(readFileSync(new URL(file, srcRoot), 'utf8')));
    expect(offenders).toEqual([]);
  });
});

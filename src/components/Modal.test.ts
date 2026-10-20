import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('..', import.meta.url));

/** Every .tsx file under src, as [path, source]. */
function sources(dir = SRC): [string, string][] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry): [string, string][] => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return entry.name.endsWith('.tsx') ? [[path, readFileSync(path, 'utf8')]] : [];
  });
}

/** A <Modal> opening tag from JSX source, whose inline handlers contain `=>`
 *  (which is not the end of the tag). */
const MODAL_TAG = /<Modal\b(?:=>|[^>])*>/g;

describe('naming every dialog for a screen reader', () => {
  it('gives every Modal a name, by its heading or a label', () => {
    // An unnamed role="dialog" is read out as just "dialog": nothing says
    // whether it is a new show, a confirmation or a list of templates.
    const tags = sources().flatMap(([path, text]) =>
      (text.match(MODAL_TAG) ?? []).map((tag) => ({ path, tag })),
    );
    expect(tags.length).toBeGreaterThan(5);
    const unnamed = tags.filter(({ tag }) => !/\b(?:labelledBy|label)=/.test(tag));
    expect(unnamed).toEqual([]);
  });
});

import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { markOpenDialogs, MODAL_OPEN_CLASS } from './modalOpen';

afterEach(() => vi.unstubAllGlobals());

/** A page whose dialogs come and go, and the observer watching it. */
function page() {
  let dialogs = 0;
  const classes = new Set<string>();
  const observed: { target: unknown; options: MutationObserverInit }[] = [];
  let changed: (() => void) | null = null;
  vi.stubGlobal('MutationObserver', class {
    constructor(callback: () => void) { changed = callback; }
    observe(target: unknown, options: MutationObserverInit) { observed.push({ target, options }); }
  });
  const body = { classList: { toggle: (name: string, on: boolean) => { if (on) classes.add(name); else classes.delete(name); } } };
  const doc = {
    body,
    querySelector: (selector: string) => (selector === '[aria-modal="true"]' && dialogs > 0 ? {} : null),
  } as unknown as Document;
  return {
    doc,
    body,
    classes,
    observed,
    open() { dialogs++; changed?.(); },
    close() { dialogs--; changed?.(); },
  };
}

describe('marking the page while a dialog is open', () => {
  it('leaves it to CSS where :has() works', () => {
    vi.stubGlobal('CSS', { supports: (test: string) => test === 'selector(:has(*))' });
    const p = page();
    markOpenDialogs(p.doc);
    expect(p.observed).toEqual([]);
    p.open();
    expect(p.classes.size).toBe(0);
  });

  it('puts a class on the body for as long as a modal dialog is open, where :has() does not work', () => {
    // iOS before 15.4, which the App Store build installs on, and Firefox
    // before 121. Without this the status rail sat over Run Show.
    vi.stubGlobal('CSS', { supports: () => false });
    const p = page();
    markOpenDialogs(p.doc);
    expect(p.observed).toHaveLength(1);
    expect(p.observed[0].target).toBe(p.body);
    expect(p.observed[0].options).toMatchObject({ childList: true, subtree: true, attributeFilter: ['aria-modal'] });
    expect(p.classes.has(MODAL_OPEN_CLASS)).toBe(false);
    p.open();
    expect(p.classes.has(MODAL_OPEN_CLASS)).toBe(true);
    // A confirmation over Run Show: one closing leaves the other open.
    p.open();
    p.close();
    expect(p.classes.has(MODAL_OPEN_CLASS)).toBe(true);
    p.close();
    expect(p.classes.has(MODAL_OPEN_CLASS)).toBe(false);
  });

  it('watches too where the browser cannot be asked about selectors', () => {
    vi.stubGlobal('CSS', undefined);
    const p = page();
    markOpenDialogs(p.doc);
    expect(p.observed).toHaveLength(1);
  });

  it('starts watching as the app starts', () => {
    const main = readFileSync(new URL('../main.tsx', import.meta.url), 'utf8');
    expect(main).toMatch(/^markOpenDialogs\(\)$/m);
  });
});

describe('the status rail under a dialog', () => {
  const css = readFileSync(new URL('../App.css', import.meta.url), 'utf8');

  it('hides on the class as well as on :has()', () => {
    expect(css).toMatch(/body:has\(\[aria-modal='true'\]\) \.status-rail \{\s*display: none;/);
    expect(css).toMatch(new RegExp(`\\nbody\\.${MODAL_OPEN_CLASS} \\.status-rail \\{\\s*display: none;`));
  });

  it('keeps the class in a rule of its own', () => {
    // A selector list with :has() in it is dropped whole by an engine that
    // cannot read :has(), the class with it.
    const hasRule = css.match(/^[^{}\n]*:has\(\[aria-modal[^{]*\{/m)?.[0] ?? '';
    expect(hasRule).not.toContain(MODAL_OPEN_CLASS);
  });
});

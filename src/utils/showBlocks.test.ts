import { describe, it, expect } from 'vitest';
import { DEFAULT_SECTIONS, SELECTABLE_SECTIONS, hiddenFromSelected } from './showBlocks';

describe('DEFAULT_SECTIONS', () => {
  it('gives a new show something to work on', () => {
    // The regression this guards: defaulting to nothing meant a new show
    // opened on "Basic Info" alone, with no way to add a cue or a performer.
    expect(DEFAULT_SECTIONS.length).toBeGreaterThan(0);
  });

  it('includes the lineup and the run-of-show, which are what the app is for', () => {
    expect(DEFAULT_SECTIONS).toContain('performers');
    expect(DEFAULT_SECTIONS).toContain('schedule');
  });

  it('only names sections that can actually be turned on', () => {
    for (const key of DEFAULT_SECTIONS) expect(SELECTABLE_SECTIONS).toContain(key);
  });

  it('leaves the specialist sections off', () => {
    expect(DEFAULT_SECTIONS).not.toContain('vendors');
    expect(DEFAULT_SECTIONS).not.toContain('scenes');
  });
});

describe('SELECTABLE_SECTIONS', () => {
  it('offers scenes, so a sketch or variety show can pick it at creation', () => {
    expect(SELECTABLE_SECTIONS).toContain('scenes');
  });

  it('does not offer Basic Info, which every show always has', () => {
    expect(SELECTABLE_SECTIONS).not.toContain('basic');
  });
});

describe('hiddenFromSelected', () => {
  it('hides everything that was not chosen', () => {
    expect(hiddenFromSelected(['performers'])).not.toContain('performers');
    expect(hiddenFromSelected(['performers'])).toContain('schedule');
  });

  it('hides nothing when everything is chosen', () => {
    expect(hiddenFromSelected(SELECTABLE_SECTIONS)).toEqual([]);
  });

  it('hides every selectable section when nothing is chosen', () => {
    expect(hiddenFromSelected([])).toEqual(SELECTABLE_SECTIONS);
  });

  it('ignores a key that is not selectable rather than echoing it back', () => {
    expect(hiddenFromSelected(['basic' as never])).toEqual(SELECTABLE_SECTIONS);
  });
});

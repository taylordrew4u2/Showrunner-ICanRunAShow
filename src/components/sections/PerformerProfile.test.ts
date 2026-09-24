import { describe, expect, it } from 'vitest';
import { isFrontDialog } from './PerformerProfile';

// No DOM in this environment: an element is only what `closest` says its
// nearest dialog is.
function inside(dialog: Element | null): Element {
  return { closest: () => dialog } as unknown as Element;
}

const drawer = {} as Element;
const confirmation = {} as Element;

describe('the keyboard while a profile drawer is open', () => {
  it('answers to the drawer when focus is inside it', () => {
    expect(isFrontDialog(drawer, inside(drawer))).toBe(true);
  });

  it('answers to the drawer when focus fell to the page behind it', () => {
    // Nothing focused, or a control under the backdrop: the drawer is still
    // the thing on top, so Escape should close it and Tab should come inside.
    expect(isFrontDialog(drawer, null)).toBe(true);
    expect(isFrontDialog(drawer, inside(null))).toBe(true);
  });

  it('leaves Escape to a confirmation opened over the drawer', () => {
    // "Remove this performer?" sits over the profile. One Escape must dismiss
    // the question, not the question and the profile it was asked about.
    expect(isFrontDialog(drawer, inside(confirmation))).toBe(false);
  });
});

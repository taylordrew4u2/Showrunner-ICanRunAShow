import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./AIImportFlow.tsx', import.meta.url), 'utf8');

/** The [selected, unselected] wording of a ternary on `i.selected` in the tag. */
function wording(tag: string, attribute: string): [string, string] {
  const found = tag.match(new RegExp(`${attribute}=\\{i\\.selected \\? '([^']*)' : '([^']*)'\\}`));
  expect(found, `${attribute} on the review check`).not.toBeNull();
  return [found![1], found![2]];
}

describe('the include checkbox on an imported cue', () => {
  // The review rows only appear after a file is read, so the source is checked
  // directly. The tooltip said "Excluded from add" on every cue that was going
  // to be added, which reads as an instruction to untick the ones to keep.
  it('has a tooltip that says what pressing it does, as its label does', () => {
    const tag = source.match(/<button\s+className="review-edit__check"(?:=>|[^>])*>/)?.[0] ?? '';
    const [labelOn, labelOff] = wording(tag, 'aria-label');
    const [titleOn, titleOff] = wording(tag, 'title');
    // An action, not a state: "Exclude", never "Excluded".
    expect(labelOn).toMatch(/^Exclude\b/);
    expect(labelOff).toMatch(/^Include\b/);
    expect(titleOn).toMatch(/^Exclude\b/);
    expect(titleOff).toMatch(/^Include\b/);
  });
});

describe('the paste box', () => {
  // The example run sheet was the box's text, not its placeholder. A paste
  // goes in at the caret, so the demo cues were read with the producer's own
  // and added to their show, every one ticked, invented names as performers.
  it('starts empty, with the example shown as a placeholder', () => {
    expect(source).toMatch(/const \[pasted, setPasted\] = useState\(''\);/);
    const tag = source.match(/<textarea\s+className="import-paste"(?:=>|[^>])*>/)?.[0] ?? '';
    expect(tag).toContain('value={pasted}');
    expect(tag).toContain('placeholder={PASTE_EXAMPLE}');
  });
});

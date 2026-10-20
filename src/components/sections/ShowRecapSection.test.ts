import { describe, expect, it } from 'vitest';
import { storedNote } from './ShowRecapSection';

describe('storing a recap note while it is being typed', () => {
  it('keeps the note as typed, trailing space and blank lines included', () => {
    // Every keystroke is saved, and the saved value is written back into the
    // field. Trimmed on the way in, backspacing "Great show" to "Great " put
    // "Great" back in the box, and the next word landed as "Greatgig".
    expect(storedNote('Great ')).toBe('Great ');
    expect(storedNote('Line1\n\n')).toBe('Line1\n\n');
  });

  it('stores nothing for a note that is only whitespace', () => {
    expect(storedNote('')).toBeUndefined();
    expect(storedNote('  \n ')).toBeUndefined();
  });
});

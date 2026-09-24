import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./Onboarding.tsx', import.meta.url), 'utf8');

describe('naming the fields on first-run onboarding for a screen reader', () => {
  it('names the custom show type and brand name boxes, not just by their placeholder', () => {
    // Both sit on later steps, so the source is checked directly. A placeholder
    // vanishes as soon as something is typed, and "e.g. Late Night Laughs" was
    // never a name for the field anyway.
    // The inline handlers contain `=>`, which is not the end of the tag.
    const named = source.match(/<(?:input|select|textarea)\b(?:=>|[^>])*>/g) ?? [];
    expect(named.length).toBe(2);
    for (const tag of named) expect(tag).toMatch(/aria-label=/);
  });
});

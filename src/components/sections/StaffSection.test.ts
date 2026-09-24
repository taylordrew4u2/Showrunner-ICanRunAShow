import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaffSection } from './StaffSection';

const source = readFileSync(new URL('./StaffSection.tsx', import.meta.url), 'utf8');

/** Every form control's opening tag, from markup or from JSX source (whose
 *  inline handlers contain `=>`, which is not the end of the tag). */
function fields(text: string): string[] {
  return text.match(/<(?:input|select|textarea)\b(?:=>|[^>])*>/g) ?? [];
}

describe('naming the fields on the staff form for a screen reader', () => {
  it('names the role picker, which has no placeholder to fall back on', () => {
    const html = renderToStaticMarkup(createElement(StaffSection, { staff: [], onChange: () => undefined }));
    const select = html.match(/<select[^>]*>/)?.[0] ?? '';
    expect(select).toMatch(/aria-label="Role"/);
  });

  it('names every field on the add form, not just by its placeholder', () => {
    // A placeholder vanishes as soon as something is typed, and not every
    // reader treats it as the field's name to begin with.
    const html = renderToStaticMarkup(createElement(StaffSection, { staff: [], onChange: () => undefined }));
    const named = fields(html);
    expect(named.length).toBeGreaterThan(0);
    for (const tag of named) expect(tag).toMatch(/aria-label="/);
  });

  it('names every field on the edit row too, including the custom role box', () => {
    // These only appear after a click, so the source is checked directly.
    const named = fields(source);
    expect(named.length).toBeGreaterThanOrEqual(7);
    for (const tag of named) expect(tag).toMatch(/aria-label=/);
  });
});

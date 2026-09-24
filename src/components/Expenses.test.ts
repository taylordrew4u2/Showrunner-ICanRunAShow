import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AppSettings } from '../types';
import { Expenses } from './Expenses';

const source = readFileSync(new URL('./Expenses.tsx', import.meta.url), 'utf8');

/** Every form control's opening tag, from markup or from JSX source (whose
 *  inline handlers contain `=>`, which is not the end of the tag). */
function fields(text: string): string[] {
  return text.match(/<(?:input|select|textarea)\b(?:=>|[^>])*>/g) ?? [];
}

describe('naming the fields on the expenses page for a screen reader', () => {
  it('names every field on the add form, not just by its placeholder', () => {
    const settings = { expenses: [] } as unknown as AppSettings;
    const html = renderToStaticMarkup(
      createElement(Expenses, { settings, onBack: () => undefined, onUpdateSettings: () => undefined }),
    );
    const named = fields(html);
    expect(named.length).toBeGreaterThan(0);
    for (const tag of named) expect(tag).toMatch(/aria-label="/);
  });

  it('names every field on the edit row, so Item and Notes are told apart once typed in', () => {
    // A placeholder vanishes as soon as something is typed, and the edit row
    // only appears after a click, so the source is checked directly.
    const named = fields(source);
    expect(named.length).toBeGreaterThanOrEqual(10);
    for (const tag of named) expect(tag).toMatch(/aria-label=/);
  });
});

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ShowForm, storedShowTime } from './ShowForm';
import { clockLabel } from '../utils/elapsed';

describe('the time typed on the New Show form', () => {
  it('is saved as the clock time the show page and timeline read', () => {
    expect(storedShowTime('Doors 8:30 Show 9')).toBe(clockLabel(21 * 60));
    expect(storedShowTime('8pm')).toBe(clockLabel(20 * 60));
  });

  it('is kept as typed, minus stray spaces, when no clock time can be read from it', () => {
    expect(storedShowTime('  after the football  ')).toBe('after the football');
    expect(storedShowTime('')).toBe('');
  });
});

describe('the New Show dialog', () => {
  it('is named by the form heading', () => {
    // The dialog App opens the form in points at this heading. With no id
    // to point at, a screen reader announced it as an unnamed "dialog".
    const html = renderToStaticMarkup(
      createElement(ShowForm, { onSave: () => undefined, onCancel: () => undefined }),
    );
    const heading = /<h2\b[^>]*\bid="([^"]+)"[^>]*>New Show<\/h2>/.exec(html);
    expect(heading).not.toBeNull();
    const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
    const modal = /<Modal\b(?:=>|[^>])*>\s*<ShowForm\b/.exec(app);
    expect(modal?.[0]).toContain(`labelledBy="${heading?.[1]}"`);
  });
});

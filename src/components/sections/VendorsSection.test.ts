import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { VendorsSection } from './VendorsSection';

describe('the vendor list for a screen reader', () => {
  it('says which vendor the delete button deletes, rather than reading out "times"', () => {
    // The button's only content is a ×. Without a name of its own, every card
    // ends in the same unlabelled "times" button.
    const html = renderToStaticMarkup(createElement(VendorsSection, {
      vendors: [{ id: 'v1', name: 'Bright Lights Co', category: 'Lighting' }],
      onChange: () => undefined,
    }));
    const remove = html.match(/<button[^>]*section-list-item__delete[^>]*>/)?.[0] ?? '';
    expect(remove).toMatch(/aria-label="Delete vendor Bright Lights Co"/);
  });
});

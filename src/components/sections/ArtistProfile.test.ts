import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ArtistProfile } from './ArtistProfile';

function render(): string {
  return renderToStaticMarkup(createElement(ArtistProfile, {
    artist: { id: 'a1', name: 'June Park' },
    onBack: () => undefined,
    onChange: () => undefined,
    onDelete: () => undefined,
  }));
}

describe('an artist profile for someone without a mouse', () => {
  it('lets the keyboard reach the walk-on upload', () => {
    // With no walk-on yet, the dropzone is the only way to attach one: there
    // is no Replace button until there is something to replace. A div that
    // only answers clicks is skipped by Tab altogether.
    const zone = render().match(/<div[^>]*perf-profile__dropzone[^>]*>/)?.[0] ?? '';
    expect(zone).toMatch(/role="button"/);
    expect(zone).toMatch(/tabindex="0"/);
    expect(zone).toMatch(/aria-label="Upload walk-on audio file"/);
  });

  it('names the video link field, not just by its placeholder', () => {
    const html = render();
    const input = html.match(/<input[^>]*perf-profile__video-link[^>]*>/)?.[0] ?? '';
    const id = input.match(/\bid="([^"]+)"/)?.[1];
    expect(id).toBeTruthy();
    expect(html).toContain(`for="${id}"`);
  });
});

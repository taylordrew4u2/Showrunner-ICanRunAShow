import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Performer } from '../types';
import { HeadshotExport } from './HeadshotExport';
import { LineupActions } from './LineupActions';

const performer = (name: string, photo?: string): Performer => ({ id: name, name, photo });
const guest = (name: string, photo?: string): Performer => ({ ...performer(name, photo), surpriseGuest: true });

describe('the download-all-headshots button', () => {
  it('counts only the performers who have a photo', () => {
    const html = renderToStaticMarkup(createElement(HeadshotExport, {
      performers: [performer('Jane Doe', 'media:a#1'), performer('No Photo'), performer('Dev Okonjo', 'data:image/png;base64,AA==')],
      showName: 'Late Set',
    }));
    expect(html).toContain('Download 2 headshots');
    expect(html).toMatch(/<button[^>]*type="button"/);
    expect(html).not.toContain('disabled');
    // The stroked download mark, not a pictograph.
    expect(html).toContain('<svg');
  });

  it('says headshot, not headshots, for one', () => {
    const html = renderToStaticMarkup(createElement(HeadshotExport, { performers: [performer('Jane Doe', 'media:a#1')] }));
    expect(html).toContain('Download 1 headshot<');
  });

  it('keeps an empty status region ready, so a screen reader hears the work start', () => {
    const html = renderToStaticMarkup(createElement(HeadshotExport, { performers: [performer('Jane Doe', 'media:a#1')] }));
    expect(html).toContain('<span class="visually-hidden" role="status"></span>');
  });

  it('is not there at all when nobody on the bill has a photo', () => {
    expect(renderToStaticMarkup(createElement(HeadshotExport, { performers: [] }))).toBe('');
    expect(renderToStaticMarkup(createElement(HeadshotExport, { performers: [performer('No Photo'), performer('Blank', ' ')] }))).toBe('');
  });
});

describe('the lineup tools', () => {
  it('offer the headshots beside the other lineup tools, and say how the files are named', () => {
    const html = renderToStaticMarkup(createElement(LineupActions, {
      performers: [performer('Jane Doe', 'media:a#1')],
      showName: 'Late Set',
      onAnnounce: () => undefined,
    }));
    expect(html).toContain('Post copy');
    expect(html).toContain('Download 1 headshot');
    expect(html).toContain('Headshots come named after each performer.');
  });

  it('still show the headshots when there is nobody to email and nothing to post', () => {
    const html = renderToStaticMarkup(createElement(LineupActions, { performers: [performer('Jane Doe', 'media:a#1')] }));
    expect(html).toContain('Download 1 headshot');
  });

  it('leave the headshots out, and say nothing about them, when there are none', () => {
    const html = renderToStaticMarkup(createElement(LineupActions, {
      performers: [performer('Jane Doe')],
      onAnnounce: () => undefined,
    }));
    expect(html).toContain('Post copy');
    expect(html).not.toContain('headshot');
    expect(renderToStaticMarkup(createElement(LineupActions, { performers: [performer('Jane Doe')] }))).toBe('');
  });
});

/**
 * The headshots go to whoever makes the flyer and whoever posts the socials,
 * so a surprise guest's face, named after them, is the spoiler the flag
 * exists to prevent. Left out unless the producer asks for them by name.
 */
describe('surprise guests and the headshots', () => {
  const bill = [performer('Jane Doe', 'media:a#1'), guest('Secret Star', 'media:b#1'), performer('Dev Okonjo', 'media:c#1')];

  it('leaves a surprise guest out of the download, and out of its count', () => {
    const html = renderToStaticMarkup(createElement(HeadshotExport, { performers: bill, showName: 'Late Set' }));
    expect(html).toContain('Download 2 headshots<');
    expect(html).not.toMatch(/Download 3/);
  });

  it('includes them only from the download that says so', () => {
    const html = renderToStaticMarkup(createElement(HeadshotExport, { performers: bill, includesGuests: true }));
    expect(html).toContain('Download 3 headshots with surprise guests');
  });

  it('offers no with-guests download when no guest has a photo', () => {
    const html = renderToStaticMarkup(createElement(HeadshotExport, {
      performers: [performer('Jane Doe', 'media:a#1'), guest('Secret Star')],
      includesGuests: true,
    }));
    expect(html).toBe('');
  });

  it('give the lineup tools both downloads, and say the guests are left out of the first', () => {
    const html = renderToStaticMarkup(createElement(LineupActions, { performers: bill, showName: 'Late Set' }));
    expect(html).toContain('Download 2 headshots<');
    expect(html).toContain('Download 3 headshots with surprise guests');
    expect(html).toContain('Surprise guests are left out of the headshots unless you choose to include them.');
  });

  it('still offer a guest\'s photo when nobody billed has one', () => {
    const html = renderToStaticMarkup(createElement(LineupActions, { performers: [performer('Jane Doe'), guest('Secret Star', 'media:b#1')] }));
    expect(html).not.toContain('Download 1 headshot<');
    expect(html).toContain('Download 1 headshot with surprise guests');
    expect(html).toContain('Headshots come named after each performer.');
  });

  it('say nothing about guests when none of them has a photo', () => {
    const html = renderToStaticMarkup(createElement(LineupActions, { performers: [performer('Jane Doe', 'media:a#1'), guest('Secret Star')] }));
    expect(html).toContain('Download 1 headshot<');
    expect(html).not.toContain('surprise guests');
    expect(html).not.toContain('Surprise guests');
  });
});

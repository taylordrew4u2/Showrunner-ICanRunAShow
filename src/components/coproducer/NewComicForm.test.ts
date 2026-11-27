import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NewComicForm, readNewComic, type NewComicValues } from './NewComicForm';

const EMPTY: NewComicValues = { name: '', tape: '', minutes: null, social: '' };
const FULL: NewComicValues = { name: '  Jo Park ', tape: 'youtu.be/jo-tape', minutes: 10, social: 'https://instagram.com/jopark' };

function render(initial?: Parameters<typeof NewComicForm>[0]['initial']): string {
  return renderToStaticMarkup(createElement(NewComicForm, { who: 'Performer', onAdd: () => {}, initial }));
}
function textOf(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}
/** The opening tag of the control a label points at. */
function controlFor(html: string, label: string): string {
  const id = html.match(new RegExp(`<label[^>]*for="([^"]+)"[^>]*>${label}</label>`))![1];
  return html.match(new RegExp(`<input[^>]*id="${id}"[^>]*>`))![0];
}

describe('what a co-producer types about someone new', () => {
  it('is read as it will be sent: trimmed, the link with its https://, the handle as the app reads it', () => {
    expect(readNewComic(FULL)).toEqual({ entry: { name: 'Jo Park', videoLink: 'https://youtu.be/jo-tape', tapeMinutes: 10, socialMedia: '@jopark' } });
    expect(readNewComic({ ...FULL, minutes: 5, social: 'jopark' })).toEqual({ entry: { name: 'Jo Park', videoLink: 'https://youtu.be/jo-tape', tapeMinutes: 5, socialMedia: '@jopark' } });
  });

  it('names each piece that is missing, in the order the form asks', () => {
    expect(readNewComic(EMPTY)).toEqual({ missing: ['name', 'tape', 'length', 'social'] });
    expect(readNewComic({ ...FULL, name: '  ' })).toEqual({ missing: ['name'] });
    expect(readNewComic({ ...FULL, tape: '' })).toEqual({ missing: ['tape'] });
    expect(readNewComic({ ...FULL, tape: 'my best set' })).toEqual({ missing: ['tape'] });
    expect(readNewComic({ ...FULL, tape: 'javascript:alert(1)' })).toEqual({ missing: ['tape'] });
    expect(readNewComic({ ...FULL, minutes: null })).toEqual({ missing: ['length'] });
    expect(readNewComic({ ...FULL, social: '' })).toEqual({ missing: ['social'] });
    expect(readNewComic({ ...FULL, social: 'ask me later' })).toEqual({ missing: ['social'] });
    // Not a handle and not a profile: a full stop, a site's front page, a post.
    for (const social of ['.', '-', 'https://', 'instagram.com/', 'https://instagram.com/p/abc']) {
      expect(readNewComic({ ...FULL, social }), social).toEqual({ missing: ['social'] });
    }
  });
});

describe('the add form in co-producer view', () => {
  it('asks for a name, a tape link, its length and social media, and nothing else', () => {
    const html = render();
    const labels = [...html.matchAll(/<label[^>]*for="[^"]+"[^>]*>(.*?)<\/label>/g)].map((m) => m[1]);
    expect(labels).toEqual(['Performer name', 'Tape link', 'Social media']);
    expect(html).toMatch(/<fieldset[^>]*><legend[^>]*>Tape length<\/legend>/);
    const radios = [...html.matchAll(/<input[^>]*type="radio"[^>]*>/g)].map((m) => m[0]);
    expect(radios.map((radio) => radio.match(/value="(\d+)"/)![1])).toEqual(['5', '10']);
    expect(new Set(radios.map((radio) => radio.match(/name="([^"]+)"/)![1])).size).toBe(1);
    // Three text boxes and the two radios: no email, phone, notes or upload.
    expect(html.match(/<input/g)).toHaveLength(5);
    expect(html).not.toMatch(/<textarea|type="file"|type="email"/);
    expect(textOf(html)).toContain('Someone new needs a name, a tape and their social media. The owner sees these before approving.');
    expect(html).toMatch(/<button type="submit"[^>]*>Add<\/button>/);
  });

  it('says nothing is wrong before Add is pressed', () => {
    const html = render();
    expect(html).not.toContain('aria-invalid');
    expect(html).toMatch(/<p class="new-comic__summary" role="alert"><\/p>/);
  });

  it('after a refused Add, names what is missing by the button and beside each field', () => {
    const html = render({ values: { ...EMPTY, name: 'Jo Park' }, refused: ['tape', 'length', 'social'] });
    expect(html).toMatch(/<p class="new-comic__summary" role="alert">Not added yet\. Add a tape link, the tape’s length \(5 or 10 minutes\) and their social media first\.<\/p>/);
    const tape = controlFor(html, 'Tape link');
    expect(tape).toContain('aria-invalid="true"');
    const tapeError = html.match(/<p class="new-comic__error" id="([^"]+)">Add a link to their tape\. It starts with http:\/\/ or https:\/\/\.<\/p>/)![1];
    expect(tape.match(/aria-describedby="([^"]+)"/)![1].split(' ')).toContain(tapeError);
    const social = controlFor(html, 'Social media');
    expect(social).toContain('aria-invalid="true"');
    const socialError = html.match(/<p class="new-comic__error" id="([^"]+)">Add their handle or a link to their profile\.<\/p>/)![1];
    expect(social).toContain(`aria-describedby="${socialError}"`);
    const lengthError = html.match(/<p class="new-comic__error" id="([^"]+)">Choose 5 or 10 minutes\.<\/p>/)![1];
    expect(html).toMatch(new RegExp(`<fieldset[^>]*aria-describedby="${lengthError}"`));
    // The name was given: it is not marked.
    expect(controlFor(html, 'Performer name')).not.toContain('aria-invalid');
    expect(html).not.toContain('Add their name.');
  });

  it('clears a field’s mark once it is put right, and keeps the rest', () => {
    const html = render({ values: { ...EMPTY, name: 'Jo Park', tape: 'https://youtu.be/jo', minutes: 5 }, refused: ['tape', 'length', 'social'] });
    expect(controlFor(html, 'Tape link')).not.toContain('aria-invalid');
    expect(html).not.toContain('Choose 5 or 10 minutes.');
    expect(textOf(html)).toContain('Not added yet. Add their social media first.');
  });
});

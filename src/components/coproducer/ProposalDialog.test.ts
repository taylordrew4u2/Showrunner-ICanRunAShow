import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ProposalDialogState, SendFailure } from '../../coproducer/ReviewContext';
import type { ChangeGroup } from '../../coproducer/types';
import { ProposalDialog } from './ProposalDialog';

const groups: ChangeGroup[] = [{
  key: 'show:show1',
  title: 'Friday Laughs',
  changes: [{ key: 'venueName', path: [], label: 'Venue name', before: 'The Basement', after: 'The Attic', change: 'changed' }],
}];
const noop = () => {};

function render(state: ProposalDialogState): string {
  return renderToStaticMarkup(createElement(ProposalDialog, { state, onClose: noop, onSeePending: noop, resolveMedia: async () => null }));
}

function textOf(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}

function titleOf(html: string): string {
  return textOf(html.match(/<h2 class="proposal-dialog__title"[^>]*>(.*?)<\/h2>/)![1]);
}

function buttonsOf(html: string): string[] {
  const actions = html.split('class="proposal-dialog__actions"')[1] ?? '';
  return [...actions.matchAll(/<button[^>]*>(.*?)<\/button>/g)].map((m) => textOf(m[1]));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the proposal dialog', () => {
  it('reviews an edit before it goes: now, and what is asked for in red', () => {
    const html = render({ step: 'review', groups, send: noop, keepEditing: noop, discard: noop });
    expect(titleOf(html)).toBe('Send these for approval?');
    expect(textOf(html)).toContain("Nothing changes until the owner approves. Here's what's there now and what you're asking for:");
    expect(textOf(html)).toContain('Venue name Now The Basement Pending approval The Attic');
    expect(html).toContain('class="coproducer-proposed"');
    expect(buttonsOf(html)).toEqual(['Keep editing', 'Discard my changes', 'Send for approval']);
    expect(html).toContain('aria-labelledby="proposal-dialog-title"');
  });

  it('holds Send for approval while offline, and says why', () => {
    vi.stubGlobal('navigator', { onLine: false });
    const html = render({ step: 'review', groups, send: noop, keepEditing: noop, discard: noop });
    expect(textOf(html)).toContain("You're offline");
    expect(html).toMatch(/<button type="button" class="btn btn--primary" disabled="">Send for approval<\/button>/);
    const draft = render({ step: 'restore-draft', groups, savedAt: new Date().toISOString(), send: noop, discard: noop });
    expect(draft).toMatch(/disabled="">Send for approval/);
  });

  it('shows the list while sending, with nothing to press', () => {
    const html = render({ step: 'sending', groups });
    expect(titleOf(html)).toBe('Sending…');
    expect(textOf(html)).toContain('The Attic');
    expect(buttonsOf(html)).toEqual([]);
  });

  it('says it was sent, with the same list', () => {
    const html = render({ step: 'sent', groups });
    expect(titleOf(html)).toBe('Sent for approval');
    expect(textOf(html)).toContain('The owner decides whether this goes in. Until then everything stays as it is, and here\'s what you asked for:');
    expect(textOf(html)).toContain('The Attic');
    expect(buttonsOf(html)).toEqual(['See everything pending', 'OK']);
  });

  it('says a share or download was asked for', () => {
    const html = render({ step: 'asked', groups });
    expect(titleOf(html)).toBe('Asked for approval');
    expect(textOf(html)).toContain("You'll be able to do this here once the owner approves it.");
    expect(buttonsOf(html)).toEqual(['See everything pending', 'OK']);
  });

  it('offers changes left unsent last time', () => {
    const savedAt = new Date(Date.now() - 10 * 60_000).toISOString();
    const html = render({ step: 'restore-draft', groups, savedAt, send: noop, discard: noop });
    expect(titleOf(html)).toBe("Changes you didn't send");
    expect(textOf(html)).toContain("You have changes from 10 min ago that weren't sent. Here they are:");
    expect(textOf(html)).toContain('The Attic');
    expect(buttonsOf(html)).toEqual(['Discard', 'Send for approval']);
  });

  const failures: [SendFailure, string, string[]][] = [
    ['offline', "Your change hasn't reached the owner yet. Check your connection and try again.", ['Try again', 'Discard my change']],
    ['server', "Your change hasn't reached the owner yet. Check your connection and try again.", ['Try again', 'Discard my change']],
    ['too_big', "That's too much to send for approval at once. Send part of it: discard, then make a smaller change.", ['Discard my change']],
    ['too_many_open', 'You have 200 requests waiting. Wait for the owner to go through some, or withdraw a few.', ['Discard my change', 'See everything pending']],
    ['storage_full_link', "You've used the space this link has for files and waiting requests. Withdraw some requests, or wait for the owner to go through them.", ['Discard my change', 'See everything pending']],
    ['storage_full_account', "The owner's account has no more room for co-producers' files and requests. They need to go through what's waiting first.", ['Discard my change']],
    ['too_many_files', 'You have 20 files waiting to be sent. Send or discard your change first.', ['OK']],
    ['unsupported_media', "That kind of file can't be sent for approval. Use a photo (JPEG, PNG, WebP or GIF), an audio file or a PDF.", ['OK']],
    ['unknown_media', 'A file in this change has expired. Discard it and add the file again.', ['Discard my change']],
    ['invalid', "Something in this change can't be sent. Discard it and try again.", ['Discard my change']],
  ];
  for (const [failure, text, buttons] of failures) {
    it(`says why it didn't send: ${failure}`, () => {
      const html = render({ step: 'failed', failure, retry: noop, discard: noop });
      expect(titleOf(html)).toBe("That didn't send");
      expect(textOf(html)).toContain(text);
      expect(buttonsOf(html)).toEqual(buttons);
    });
  }

  it('closes with OK when a failed share or download has nothing to discard or retry', () => {
    expect(buttonsOf(render({ step: 'failed', failure: 'offline' }))).toEqual(['OK']);
    expect(buttonsOf(render({ step: 'failed', failure: 'offline', retry: noop }))).toEqual(['Try again', 'OK']);
    expect(buttonsOf(render({ step: 'failed', failure: 'too_many_open' }))).toEqual(['OK', 'See everything pending']);
  });
});

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { confirmInReview, NOT_SENT_YET, reviewConfirm } from './useConfirm';
import { localConfirm } from './coproducer/localConfirm';

// In co-producer view a confirm asks the owner: nothing it says may promise
// something irreversible or immediate, because nothing happens until the
// owner approves.
describe('reviewConfirm', () => {
  it('drops what is not so of a request, says what is, and is never destructive', () => {
    const asked = reviewConfirm({
      title: 'Withdraw Sam’s link?',
      message: 'Sam’s link stops working straight away. This can’t be undone. Their answers stay on file.',
      confirmLabel: 'Withdraw',
    });
    expect(asked.message).toBe('Their answers stay on file. Nothing changes until the owner approves.');
    expect(asked.title).toBe('Withdraw Sam’s link?');
    expect(asked.confirmLabel).toBe('Ask the owner');
    expect(asked.danger).toBe(false);
  });

  it('removes every phrasing of it', () => {
    for (const message of [
      'Delete this show? It cannot be undone.',
      "Delete this show? It can't be undone.",
      'Delete this show? It can’t be undone.',
      'Remove it? The link stops working.',
      'Remove it? It goes straight away.',
    ]) {
      expect(reviewConfirm({ message }).message).toMatch(/^(Delete this show\?|Remove it\?) Nothing changes until the owner approves\.$/);
    }
  });

  it('asks a generic question when there is no title, and lets the caller’s own review words win', () => {
    expect(reviewConfirm({ message: 'Delete?' }).title).toBe('Ask the owner?');
    const own = reviewConfirm({
      message: 'Withdraw it?',
      title: 'Withdraw?',
      confirmLabel: 'Withdraw',
      review: { title: 'Ask the owner to withdraw Sam’s link?', message: 'Custom.', confirmLabel: 'Ask to withdraw' },
    });
    expect(own).toMatchObject({ title: 'Ask the owner to withdraw Sam’s link?', message: 'Custom.', confirmLabel: 'Ask to withdraw', danger: false });
  });
});

// Which words a confirm gets in co-producer view. Only a confirm that asks the
// owner is worded as a request; an edit to the unsent copy says that nothing
// has gone yet; a question that changes nothing keeps its own words.
describe('confirmInReview', () => {
  it('keeps an edit’s own buttons, drops what is not so of an unsent change, and says nothing has been sent', () => {
    const edit = confirmInReview({
      title: 'Delete “Friday Laughs”?',
      message: 'Delete this show? It cannot be undone.',
      confirmLabel: 'Delete',
    });
    expect(edit).toMatchObject({ title: 'Delete “Friday Laughs”?', confirmLabel: 'Delete', danger: false });
    expect(edit.message).toBe(`Delete this show? ${NOT_SENT_YET}`);
    expect(edit.message).not.toContain('owner approves');
    // A bare question keeps the hook's own button label rather than becoming a request.
    expect(confirmInReview({ message: 'Delete?' })).toEqual({ message: `Delete? ${NOT_SENT_YET}`, danger: false });
  });

  it('words a confirm as a request to the owner only when the caller says it is one', () => {
    expect(confirmInReview({ message: 'Send again?', confirmLabel: 'Send anyway', asksOwner: true })).toMatchObject({
      title: 'Ask the owner?',
      confirmLabel: 'Ask the owner',
      message: 'Send again? Nothing changes until the owner approves.',
      danger: false,
    });
    expect(confirmInReview({ message: 'Withdraw it?', review: { confirmLabel: 'Ask to withdraw' } }).confirmLabel).toBe('Ask to withdraw');
  });

  it('leaves a question that changes nothing in the account exactly as asked', () => {
    const leave = localConfirm({
      title: 'Leave without saving?',
      message: 'The changes on this page have not been saved. Leave now and they are gone.',
      confirmLabel: 'Leave',
      cancelLabel: 'Stay',
      danger: false,
    });
    expect(confirmInReview(leave)).toBe(leave);
    const which = confirmInReview(localConfirm({ title: 'Same person, or someone else?', message: 'Which?', confirmLabel: 'Different act', cancelLabel: 'Same person' }));
    expect(which).toMatchObject({ title: 'Same person, or someone else?', confirmLabel: 'Different act', cancelLabel: 'Same person', message: 'Which?', danger: false });
  });

  // These pass localConfirm at the call, or co-producer view relabels them:
  // "Ask the owner" on Settings' leave guard threw the form's edits away.
  it('is told by every confirm that changes nothing in the account', () => {
    const cases: [string, string][] = [
      ['./Settings.tsx', 'Leave without saving?'],
      ['./sections/PerformerProfile.tsx', 'Same person, or someone else?'],
      ['./RunShow.tsx', 'Restart from the top?'],
      ['./RunShow.tsx', 'Leave Run Show?'],
    ];
    for (const [file, title] of cases) {
      const text = readFileSync(new URL(file, import.meta.url), 'utf8');
      const at = text.indexOf(`title: '${title}'`);
      expect(at, `${file}: ${title}`).toBeGreaterThan(0);
      expect(text.slice(Math.max(0, at - 200), at), `${file}: ${title}`).toMatch(/(?:confirm|ask)\(localConfirm\(\{\s*$/);
    }
  });
});

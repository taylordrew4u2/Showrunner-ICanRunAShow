import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describePayload, diffShow } from '../../coproducer/diff';
import { fullSettings, fullShow } from '../../coproducer/testFixtures';
import type { ChangeGroup, Conflict, FieldChange } from '../../coproducer/types';
import { ChangeList, type ChangeListProps } from './ChangeList';

function render(props: ChangeListProps): string {
  return renderToStaticMarkup(createElement(ChangeList, props));
}

/** What a reader sees: the markup's text, entities decoded. */
function textOf(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function change(over: Partial<FieldChange> = {}): FieldChange {
  return { key: 'venueName', path: [], label: 'Venue name', before: 'The Basement', after: 'The Attic', change: 'changed', ...over };
}

function group(changes: FieldChange[], over: Partial<ChangeGroup> = {}): ChangeGroup {
  return { key: 'show:show1', title: 'Friday Laughs', changes, ...over };
}

/** The markup of each change row, in order. */
function rows(html: string): string[] {
  return html.split('class="change-list__change"').slice(1);
}

describe('the list of changes', () => {
  it('shows what is there now and, in red, what is asked for, for every change', () => {
    const html = render({
      groups: [group([change(), change({ key: 'location', label: 'Location', before: '1 Main St', after: '2 High St' })])],
    });
    for (const row of rows(html)) {
      expect(row).toContain('<dt>Now</dt>');
      expect(row).toContain('<dt>Pending approval</dt>');
      expect(row).toMatch(/<dd class="coproducer-proposed">[^<]*(The Attic|2 High St)/);
      expect(row).toContain('<span class="pending-pill">Pending approval</span>');
    }
    const text = textOf(html);
    expect(text).toContain('Friday Laughs');
    expect(text).toContain('Venue name Now The Basement Pending approval The Attic Pending approval');
  });

  it('says Nothing for an empty side, and Removed for a removal', () => {
    const html = render({
      groups: [group([
        change({ key: 'host', label: 'Host', before: null, after: 'Cal', change: 'added' }),
        change({ key: 'performers/p1', path: ['Performers'], label: 'Removed', before: 'Sam Lee', after: null, change: 'removed' }),
      ])],
    });
    const [added, removed] = rows(html);
    expect(added).toContain('<span class="change-list__nothing">Nothing</span>');
    expect(removed).toMatch(/<dd class="coproducer-proposed">Removed<span class="pending-pill">/);
    expect(textOf(removed)).toContain('Performers');
  });

  it('names where a change lives, outermost first', () => {
    const html = render({ groups: [group([change({ path: ['Performers', 'Sam Lee'], label: 'Email' })])] });
    expect(textOf(html)).toContain('Performers › Sam Lee Email');
  });

  it('shows the group’s note beside its title', () => {
    expect(textOf(render({ groups: [group([change()], { note: 'New show' })] }))).toContain('Friday Laughs New show');
  });

  it('puts values on the page as text, never as markup', () => {
    const html = render({ groups: [group([change({ after: '<img src=x onerror=alert(1)>' })], { title: '<b>x</b>' })] });
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<b>');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('shows a long value as a window around the first difference, and the whole of both behind Show all', () => {
    const start = 'A'.repeat(400);
    const before = `${start} the old ending ${'Z'.repeat(400)}`;
    const after = `${start} the new ending ${'Z'.repeat(400)}`;
    const html = render({ groups: [group([change({ key: 'notes', label: 'Notes', before, after })])] });
    const [windowed, all] = html.split('<details class="change-list__all">');
    expect(windowed).toContain('…');
    expect(windowed).toContain('the old ending');
    expect(windowed).toContain('the new ending');
    expect(windowed).not.toContain(before);
    expect(all).toContain('<summary>Show all</summary>');
    expect(all).toContain(before);
    expect(all).toContain(after);
  });

  it('counts a value of more than six lines as long, and keeps its lines', () => {
    const before = ['one', 'two', 'three', 'four', 'five', 'six', 'seven'].join('\n');
    const html = render({ groups: [group([change({ before, after: `${before}\neight` })])] });
    expect(html).toContain('Show all');
    expect(html).toContain('six\nseven');
  });

  it('shows short values whole, with nothing to expand', () => {
    expect(render({ groups: [group([change()])] })).not.toContain('Show all');
  });

  it('shows a share or download as what would be handed over, in place of Now', () => {
    const groups = describePayload(
      { kind: 'share', action: { type: 'email', source: 'lineup', showId: 'show1', href: 'mailto:a@example.com,b@example.com?subject=Tonight&body=Doors%20at%207' } },
      { state: { shows: [fullShow()], settings: fullSettings() } },
    );
    const html = render({ groups });
    expect(html).toContain('<dt>What</dt>');
    expect(html).not.toContain('<dt>Now</dt>');
    const text = textOf(html);
    for (const line of groups[0].handOver!.details) {
      expect(text).toContain(line.label);
      expect(text).toContain(line.value);
    }
    expect(text).toContain('Subject Tonight');
    expect(text).toContain('Body Doors at 7');
    expect(html).toMatch(/<dd class="coproducer-proposed">Open an email to 2 people<span class="pending-pill">Pending approval<\/span>/);
  });

  it('folds a long share detail behind Show all, whole', () => {
    const text = 'Word '.repeat(200);
    const groups = describePayload(
      { kind: 'share', action: { type: 'copy-text', source: 'season-pitch', text } },
      { state: { shows: [fullShow()], settings: fullSettings() } },
    );
    const html = render({ groups });
    expect(html).toContain('<summary>Show all</summary>');
    expect(html).toContain(text.trim());
  });

  it('shows what the owner changed since, with three values and theirs in red', () => {
    const conflicts: Conflict[] = [{ groupKey: 'show:show1', key: 'venueName', path: [], label: 'Venue name', asked: 'The Basement', now: 'The Loft', proposed: 'The Attic' }];
    const html = render({ groups: [group([change()])], conflicts, who: 'Sam' });
    const block = html.split('class="change-list__conflicts"')[1].split('class="change-list__group"')[0];
    expect(textOf(block)).toContain('Changed since they asked');
    expect(textOf(block)).toContain("You've changed these since Sam asked.");
    expect(block).toContain('<dt>When they asked</dt><dd>The Basement</dd>');
    expect(block).toContain('<dt>Now</dt><dd>The Loft</dd>');
    expect(block).toMatch(/<dt>Their version<\/dt><dd class="coproducer-proposed">The Attic<span class="pending-pill">Pending approval/);
  });

  it('folds a group past thirty changes, except on the owner’s complete card', () => {
    const many = Array.from({ length: 34 }, (_, i) => change({ key: `todos/t${i}`, label: `To-do ${i}`, before: null, after: `Do ${i}`, change: 'added' }));
    const folded = render({ groups: [group(many)] });
    expect(folded).toContain('<summary>Show 4 more</summary>');
    expect(folded).toContain('Do 33');
    const complete = render({ groups: [group(many)], complete: true });
    expect(complete).not.toContain('more</summary>');
    expect(rows(complete)).toHaveLength(34);
  });

  it('takes the column names it is given', () => {
    const html = render({ groups: [group([change()])], nowLabel: 'Yours', proposedLabel: 'Theirs' });
    expect(html).toContain('<dt>Yours</dt>');
    expect(html).toContain('<dt>Theirs</dt>');
    expect(html).toContain('<span class="pending-pill">Pending approval</span>');
  });

  it('renders the diff engine’s own groups', () => {
    const before = fullShow();
    const after = fullShow({ venueName: 'The Attic', flyer: 'media:99999999-aaaa-bbbb-cccc-000000000001#1' });
    const html = render({ groups: [diffShow(before, after)!] });
    const text = textOf(html);
    expect(text).toContain('Venue name Now The Basement Pending approval The Attic');
    expect(text).toContain('Flyer Now Photo on file Pending approval Replaced photo');
    // No previews without a resolver.
    expect(html).not.toContain('<img');
  });
});

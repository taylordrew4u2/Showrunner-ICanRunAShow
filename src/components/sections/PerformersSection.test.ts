import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LineupTabs, SurpriseGuestsIntro, lineupTabIds, tabAfterKey } from './LineupTabs';
import { PerformersSection } from './PerformersSection';
import type { Performer } from '../../types';

const ada: Performer = { id: 'ada', name: 'Ada Cole' };
const jo: Performer = { id: 'jo', name: 'Jo Park' };
const miles: Performer = { id: 'miles', name: 'Miles Trent', surpriseGuest: true };

/** Every tab's opening tag, in order. */
function tabs(html: string): string[] {
  return html.match(/<button[^>]*role="tab"[^>]*>/g) ?? [];
}

/** The text of every tab, tags stripped. */
function tabText(html: string): string[] {
  return (html.match(/<button[^>]*role="tab"[^>]*>.*?<\/button>/g) ?? []).map((tab) =>
    tab.replace(/<[^>]+>/g, ''),
  );
}

function section(props: Partial<Parameters<typeof PerformersSection>[0]> = {}): string {
  return renderToStaticMarkup(
    createElement(PerformersSection, {
      performers: [ada, miles, jo],
      onChange: () => undefined,
      onTargetChange: () => undefined,
      ...props,
    }),
  );
}

describe('the switch between performers and surprise guests', () => {
  const html = renderToStaticMarkup(
    createElement(LineupTabs, {
      active: 'performers',
      counts: { performers: 2, guests: 1 },
      idBase: 'lineup',
      onChange: () => undefined,
    }),
  );

  it('is one tablist holding the two tabs, side by side, each with its count', () => {
    expect(html).toMatch(/^<div[^>]*role="tablist"[^>]*aria-label="Lineup"/);
    expect(tabs(html)).toHaveLength(2);
    expect(tabText(html)).toEqual(['Performers 2', 'Surprise guests 1']);
  });

  it('says which tab is selected, and leaves only that one in the Tab order', () => {
    const [performers, guests] = tabs(html);
    expect(performers).toMatch(/aria-selected="true"/);
    expect(performers).toMatch(/tabindex="0"/);
    expect(guests).toMatch(/aria-selected="false"/);
    expect(guests).toMatch(/tabindex="-1"/);
  });

  it('ties each tab to the panel it shows', () => {
    const [performers, guests] = tabs(html);
    expect(performers).toContain(`id="${lineupTabIds('lineup', 'performers').tab}"`);
    expect(performers).toContain(`aria-controls="${lineupTabIds('lineup', 'performers').panel}"`);
    expect(guests).toContain(`aria-controls="${lineupTabIds('lineup', 'guests').panel}"`);
  });
});

describe('moving between the tabs from the keyboard', () => {
  it('goes to the other tab on either arrow, wrapping at the ends', () => {
    expect(tabAfterKey('performers', 'ArrowRight')).toBe('guests');
    expect(tabAfterKey('guests', 'ArrowRight')).toBe('performers');
    expect(tabAfterKey('performers', 'ArrowLeft')).toBe('guests');
    expect(tabAfterKey('guests', 'ArrowLeft')).toBe('performers');
  });

  it('goes to the first and last tab on Home and End', () => {
    expect(tabAfterKey('guests', 'Home')).toBe('performers');
    expect(tabAfterKey('performers', 'End')).toBe('guests');
  });

  it('leaves every other key to the page', () => {
    expect(tabAfterKey('performers', 'Enter')).toBeNull();
    expect(tabAfterKey('performers', 'Tab')).toBeNull();
    expect(tabAfterKey('performers', 'ArrowDown')).toBeNull();
  });
});

describe('the Surprise guests tab, before and after anyone is booked on it', () => {
  it('says what the tab is for while it is empty', () => {
    expect(renderToStaticMarkup(createElement(SurpriseGuestsIntro, { count: 0 }))).toContain(
      'No surprise guests. Book someone here to keep them off the posted lineup until they hit the stage.',
    );
  });

  it('says what happens to the people on it once there are some', () => {
    expect(renderToStaticMarkup(createElement(SurpriseGuestsIntro, { count: 2 }))).toContain(
      'Kept off the post copy and the viewer link',
    );
  });
});

describe('the Performers section with a surprise guest booked', () => {
  it('opens on the performers, counting each tab from the one lineup', () => {
    const html = section();
    expect(tabText(html)).toEqual(['Performers 2', 'Surprise guests 1']);
    expect(tabs(html)[0]).toMatch(/aria-selected="true"/);
  });

  it('lists only the posted bill on the performers tab, numbered among themselves', () => {
    const html = section();
    const list = html.match(/<ul class="section-list">.*?<\/ul>/)?.[0] ?? '';
    expect(list).toContain('Ada Cole');
    expect(list).toContain('Jo Park');
    expect(list).not.toContain('Miles Trent');
    expect(list.match(/section-list-item__order">(\d+)</g)).toEqual([
      'section-list-item__order">1<',
      'section-list-item__order">2<',
    ]);
  });

  it('shows one panel, labelled by its tab, and leaves the other empty and hidden', () => {
    const html = section();
    const panels = html.match(/<div[^>]*role="tabpanel"[^>]*>/g) ?? [];
    expect(panels).toHaveLength(2);
    const [shown, other] = panels;
    expect(shown).not.toMatch(/hidden/);
    expect(other).toMatch(/hidden/);
    const performersTab = tabs(html)[0].match(/id="([^"]+)"/)?.[1];
    expect(shown).toContain(`aria-labelledby="${performersTab}"`);
    expect(html.match(/class="section-list"/g)).toHaveLength(1);
  });

  it('opens on the guests tab when the profile asked for is a guest’s, with the switch on', () => {
    const html = section({ openProfile: { id: 'miles', seq: 1 } });
    expect(tabs(html)[1]).toMatch(/aria-selected="true"/);
    const list = html.match(/<ul class="section-list">.*?<\/ul>/)?.[0] ?? '';
    expect(list).toContain('Miles Trent');
    expect(list).not.toContain('Ada Cole');
    // The profile drawer opens over it, with the switch to move them back.
    const toggle = html.match(/<input[^>]*class="perf-profile__surprise-check"[^>]*>/)?.[0] ?? '';
    expect(toggle).toMatch(/type="checkbox"/);
    expect(toggle).toMatch(/checked=""/);
    expect(html).toContain('perf-profile__surprise-title">Surprise guest<');
    expect(html).toContain('This show only.');
  });

  it('has the switch off for someone on the posted bill', () => {
    const html = section({ openProfile: { id: 'ada', seq: 1 } });
    const toggle = html.match(/<input[^>]*class="perf-profile__surprise-check"[^>]*>/)?.[0] ?? '';
    expect(toggle).not.toBe('');
    expect(toggle).not.toMatch(/checked/);
  });

  it('chases a guest’s missing details on their tab without calling them the bill or asking for a tag', () => {
    // miles has no email and no handle; the drawer is open over the guests tab.
    const guests = section({ openProfile: { id: 'miles', seq: 1 } });
    const head = guests.match(/<span class="lineup-gaps__head">.*?<\/span>/)?.[0].replace(/<[^>]+>/g, '');
    expect(head).toBe('1 surprise guest is missing details');
    expect(guests).not.toContain('tag them');

    const bill = section();
    expect(bill.match(/<span class="lineup-gaps__head">.*?<\/span>/)?.[0].replace(/<[^>]+>/g, ''))
      .toBe('2 on this bill are missing details');
    expect(bill).toContain('Add a social handle to tag them.');
  });

  it('counts only the posted bill toward the performers wanted', () => {
    // An empty performers tab opens on the add form, where the target lives.
    const html = section({ performers: [miles], performerTarget: 1 });
    expect(html).toContain('0 of 1 booked · 1 spot left');
  });
});

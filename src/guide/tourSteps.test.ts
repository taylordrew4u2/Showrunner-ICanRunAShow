import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GUIDE_VIEWS, type GuidePlace } from './places';
import { LOCKED_FEATURE_LABELS, TOUR_STEPS } from './tourSteps';
import { WIZARDS } from './wizards';

const srcRoot = new URL('../', import.meta.url);
const guideRoot = new URL('./', import.meta.url);

/** Every app source file under src/, tests aside. */
function sources(dir: URL): URL[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? sources(new URL(`${entry.name}/`, dir))
      : /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [new URL(entry.name, dir)] : []);
}

const read = (file: URL) => readFileSync(file, 'utf8');
// The steps themselves name the ids, so they cannot vouch for them.
const DATA_FILES = ['guide/tourSteps.ts', 'guide/wizards.ts'];
const appText = sources(srcRoot)
  .filter((file) => !DATA_FILES.some((name) => file.pathname.endsWith(name)))
  .map(read)
  .join('\n');
const appTsx = read(new URL('App.tsx', srcRoot));

const bodies = (step: (typeof TOUR_STEPS)[number]): string[] => [
  ...(typeof step.body === 'string' ? [step.body] : [step.body.phone, step.body.desktop]),
  ...(step.locked ? [step.locked.body] : []),
];

const allTargets = [
  ...TOUR_STEPS.flatMap((step) => step.targets),
  ...WIZARDS.flatMap((wizard) => wizard.steps.flatMap((step) => step.action?.targets ?? [])),
];
const allPlaces: GuidePlace[] = [
  ...TOUR_STEPS.flatMap((step) => (step.place ? [step.place] : [])),
  ...WIZARDS.flatMap((wizard) => wizard.steps.flatMap((step) => (step.action?.place ? [step.action.place] : []))),
];
const allText = [
  ...TOUR_STEPS.flatMap((step) => [step.title, ...bodies(step)]),
  ...WIZARDS.flatMap((wizard) => [
    wizard.title,
    wizard.description,
    ...wizard.steps.flatMap((step) => [step.title, step.text, step.nativeText ?? '', step.action?.label ?? '']),
  ]),
];

describe('the tour’s steps', () => {
  it('have ids that are never reused, since the id is what a stopped tour is stored by', () => {
    const ids = TOUR_STEPS.map((step) => step.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const wizard of WIZARDS) {
      const stepIds = wizard.steps.map((step) => step.id);
      expect(new Set(stepIds).size, wizard.id).toBe(stepIds.length);
    }
    expect(new Set(WIZARDS.map((wizard) => wizard.id)).size).toBe(WIZARDS.length);
  });

  it('each have a title and a body short enough to read in a card on a phone', () => {
    for (const step of TOUR_STEPS) {
      expect(step.title.trim(), step.id).not.toBe('');
      for (const body of bodies(step)) {
        expect(body.trim(), step.id).not.toBe('');
        expect(body.length, step.id).toBeLessThanOrEqual(320);
      }
    }
  });

  it('are on a page unless they are inside the live board', () => {
    for (const step of TOUR_STEPS) {
      if (step.surface === 'app') expect(step.place, step.id).toBeDefined();
      else expect(step.place, step.id).toBeUndefined();
    }
  });

  // ProducerLock says what the plan costs, and only where it may (not in the
  // iOS app). The guide's own words never do.
  it('never state a price or tell anyone to upgrade', () => {
    for (const text of allText) expect(text).not.toMatch(/\$\s?\d|per month|\/mo\b|upgrade/i);
  });

  it('name the locked features by the words the app’s own locks use', () => {
    for (const label of Object.values(LOCKED_FEATURE_LABELS)) {
      expect(appText, label).toContain(`feature="${label}"`);
    }
  });
});

describe('what the steps point at', () => {
  it('is a control that exists: every data-tour id is written on a real element', () => {
    const ids = new Set<string>();
    for (const target of allTargets) {
      const match = /^\[data-tour="([a-z-]+)"\]$/.exec(target);
      if (match) ids.add(match[1]);
      else expect(target, target).toMatch(/^#show-section-header-[a-z]+$/);
    }
    expect(ids.size).toBeGreaterThan(20);
    for (const id of ids) {
      // The nav tabs and the rows on More are written from their lists.
      const nav = /^nav-(.+)$/.exec(id);
      const more = /^more-(.+)$/.exec(id);
      if (nav && nav[1] !== 'toggle') {
        expect(appTsx, id).toContain("data-tour={`nav-${item.id}`}");
        expect(appTsx, id).toMatch(new RegExp(`\\bid: '${nav[1]}'`));
      } else if (more) {
        expect(appText, id).toContain("data-tour={`more-${item.key}`}");
        expect(appTsx, id).toMatch(new RegExp(`\\bkey: '${more[1]}'`));
      } else {
        const written = appText.includes(`data-tour="${id}"`)
          || appText.includes(`tourId="${id}"`)
          || new RegExp(`data-tour=\\{[^}]*'${id}'`).test(appText);
        expect(written, id).toBe(true);
      }
    }
  });

  it('is a section a show really has', () => {
    const types = read(new URL('types/index.ts', srcRoot));
    const union = /export type SectionKey =([^;]+);/.exec(types)?.[1] ?? '';
    const keys = [...union.matchAll(/"([a-z]+)"/g)].map((match) => match[1]);
    expect(keys).toContain('performers');
    for (const target of allTargets) {
      const match = /^#show-section-header-([a-z]+)$/.exec(target);
      if (match) expect(keys, target).toContain(match[1]);
    }
    for (const place of allPlaces) {
      if (place.view === 'detail' && place.section) expect(keys, place.section).toContain(place.section);
    }
  });

  it('is on a page the app can be taken to', () => {
    const viewType = /type View = ([^;]+);/.exec(appTsx)?.[1] ?? '';
    for (const place of allPlaces) {
      expect(GUIDE_VIEWS, place.view).toContain(place.view);
      expect(viewType, place.view).toContain(`'${place.view}'`);
    }
  });
});

describe('the guide’s own screens', () => {
  const guideFiles = sources(guideRoot);

  // A region the page stays usable around: nothing is trapped or covered.
  it('never make the card a dialog', () => {
    const dock = read(new URL('GuideDock.tsx', guideRoot));
    expect(dock).not.toMatch(/aria-modal/);
    expect(dock).not.toMatch(/role="dialog"/);
    expect(dock).toMatch(/role="region"/);
    expect(dock).not.toMatch(/addEventListener\('key/);
  });

  // The end-to-end helpers find the app's own buttons by these exact names.
  it('have no button called by a name the rest of the app already uses', () => {
    const reserved = ['New Show', 'Try a sample show', 'Run Show', 'Next', 'Continue', 'Skip', 'Get started', 'Done', 'Finish', 'Close', 'Back'];
    const named = new RegExp(`>\\s*(?:${reserved.join('|')})\\s*</button>`, 'i');
    const labelled = new RegExp(`label: '(?:${reserved.join('|')})'`, 'i');
    for (const file of guideFiles) {
      const text = read(file);
      expect(named.test(text), file.pathname).toBe(false);
      expect(labelled.test(text), file.pathname).toBe(false);
    }
  });

  // Co-producer view holds back everything that hands something over. The
  // guide never needs to: it has no copy, share, download or print of its own.
  it('never ask a blocking question', () => {
    for (const file of guideFiles) expect(read(file), file.pathname).not.toMatch(/window\.(?:confirm|alert|prompt)\(/);
  });
});

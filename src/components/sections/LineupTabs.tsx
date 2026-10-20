import { useRef } from 'react';

/** The two halves of a lineup: the bill as posted, and the people kept off it. */
export type LineupTab = 'performers' | 'guests';

const TABS: { key: LineupTab; label: string }[] = [
  { key: 'performers', label: 'Performers' },
  { key: 'guests', label: 'Surprise guests' },
];

/**
 * Where a key press on the tab strip moves the selection, or null for a key
 * the strip leaves alone. The arrows wrap, as a tablist's do — with two tabs
 * either arrow is simply "the other one" — and Home and End go to the ends.
 *
 * Exported for the tests. Fast refresh only minds exports it has to
 * re-render, and this has no UI of its own.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function tabAfterKey(current: LineupTab, key: string): LineupTab | null {
  const index = TABS.findIndex((tab) => tab.key === current);
  if (key === 'ArrowRight') return TABS[(index + 1) % TABS.length].key;
  if (key === 'ArrowLeft') return TABS[(index - 1 + TABS.length) % TABS.length].key;
  if (key === 'Home') return TABS[0].key;
  if (key === 'End') return TABS[TABS.length - 1].key;
  return null;
}

/** The ids that tie each tab to its panel, from one per-page base. */
// eslint-disable-next-line react-refresh/only-export-components
export function lineupTabIds(idBase: string, tab: LineupTab): { tab: string; panel: string } {
  return { tab: `${idBase}-tab-${tab}`, panel: `${idBase}-panel-${tab}` };
}

/**
 * The line at the top of the Surprise guests tab.
 *
 * The performers tab needs none: an empty lineup opens on the add form, and
 * the field says what it is for. An empty guests tab has to say what it is
 * for, because nothing else on screen does — and a full one says what the
 * app does with the people on it, so nobody wonders where they went.
 */
export function SurpriseGuestsIntro({ count }: { count: number }) {
  if (count === 0) {
    return (
      <p className="lineup-tabs__empty">
        No surprise guests. Book someone here to keep them off the posted lineup until they hit
        the stage.
      </p>
    );
  }
  return (
    <p className="lineup-tabs__note">
      Kept off the post copy and the viewer link until they're on stage. Run Show and your own
      exports still list them.
    </p>
  );
}

/**
 * Performers and Surprise guests, side by side, each with its count.
 *
 * A real tablist rather than two buttons that happen to look like tabs: the
 * selected one is the only stop in the Tab order, the arrow keys move between
 * them, and each names the panel it shows — so a screen reader hears "tab, 2
 * of 2, selected" rather than two unrelated buttons above a list.
 */
export function LineupTabs({ active, counts, idBase, onChange }: {
  active: LineupTab;
  counts: Record<LineupTab, number>;
  /** Unique on the page — see lineupTabIds. */
  idBase: string;
  onChange: (tab: LineupTab) => void;
}) {
  const buttons = useRef<Partial<Record<LineupTab, HTMLButtonElement | null>>>({});

  return (
    <div className="lineup-tabs" role="tablist" aria-label="Lineup">
      {TABS.map(({ key, label }) => {
        const selected = key === active;
        const ids = lineupTabIds(idBase, key);
        return (
          <button
            key={key}
            ref={(el) => {
              buttons.current[key] = el;
            }}
            type="button"
            role="tab"
            id={ids.tab}
            aria-selected={selected}
            aria-controls={ids.panel}
            tabIndex={selected ? 0 : -1}
            className={`lineup-tabs__tab${selected ? ' lineup-tabs__tab--active' : ''}`}
            onClick={() => onChange(key)}
            onKeyDown={(e) => {
              const next = tabAfterKey(key, e.key);
              if (!next) return;
              e.preventDefault();
              onChange(next);
              buttons.current[next]?.focus();
            }}
          >
            <span className="lineup-tabs__label">{label}</span>{' '}
            <span className="lineup-tabs__count">{counts[key]}</span>
          </button>
        );
      })}
    </div>
  );
}

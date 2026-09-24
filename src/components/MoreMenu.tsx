import { useEffect, useRef, useState } from 'react';
import './MoreMenu.css';

export interface MoreMenuItem {
  label: string;
  onSelect: () => void;
  /** Renders the item in the danger colour, for destructive actions. */
  danger?: boolean;
}

interface MoreMenuProps {
  /** Accessible name for the trigger, e.g. "More show actions". */
  label: string;
  items: MoreMenuItem[];
}

/**
 * Which item a key moves focus to from `index`, or null for a key the menu
 * does not handle. Arrows step an item and wrap at the ends; Home and End go
 * to the first and last. This is what a screen reader promises when the
 * trigger says it opens a menu, so a reader user's Down Arrow has to work.
 *
 * Exported so a test can pin the rule.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function menuItemReachedByKey(key: string, index: number, count: number): number | null {
  switch (key) {
    case 'ArrowDown': return (index + 1) % count;
    case 'ArrowUp': return (index - 1 + count) % count;
    case 'Home': return 0;
    case 'End': return count - 1;
    default: return null;
  }
}

/**
 * The standard overflow menu: one "⋯" button that reveals a screen's secondary
 * actions. Secondary actions used to be scattered across the global navigation,
 * which meant the nav changed shape depending on what you were looking at. Here
 * they sit with the thing they act on.
 */
export function MoreMenu({ label, items }: MoreMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // Which item takes focus when the menu opens. Up Arrow on the trigger opens
  // onto the last item, as a menu button does; everything else onto the first.
  const openAtRef = useRef<'first' | 'last'>('first');

  function menuItems(): HTMLElement[] {
    return [...(listRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
  }

  // The items unmount when the menu closes, and a focused node that unmounts
  // drops focus to the top of the page — where a confirm dialog opened by the
  // chosen item would then record the page itself as the place to return to.
  // So focus goes back to the trigger before anything else happens.
  function closeToTrigger() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  useEffect(() => {
    if (!open) return;

    const opened = menuItems();
    (openAtRef.current === 'last' ? opened[opened.length - 1] : opened[0])?.focus();

    function onPointerDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      setOpen(false);
      // Only reclaim focus if it was in the menu; an Escape pressed elsewhere
      // on the page should not yank the keyboard over here.
      if (rootRef.current?.contains(document.activeElement)) triggerRef.current?.focus();
    }

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  if (items.length === 0) return null;

  return (
    <div className="more-menu" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="more-menu__trigger"
        onClick={() => {
          openAtRef.current = 'first';
          setOpen((v) => !v);
        }}
        onKeyDown={(e) => {
          if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
          e.preventDefault();
          openAtRef.current = e.key === 'ArrowUp' ? 'last' : 'first';
          setOpen(true);
        }}
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <svg viewBox="0 0 20 20" fill="currentColor" width="18" height="18" aria-hidden="true">
          <circle cx="4" cy="10" r="1.6" />
          <circle cx="10" cy="10" r="1.6" />
          <circle cx="16" cy="10" r="1.6" />
        </svg>
      </button>

      {open && (
        <div
          className="more-menu__list"
          role="menu"
          ref={listRef}
          onKeyDown={(e) => {
            if (e.key === 'Tab') {
              // Tab leaves the menu. Focus lands on the trigger first so the
              // browser's own Tab carries on from there, not from an item
              // that is about to unmount.
              closeToTrigger();
              return;
            }
            const all = menuItems();
            const next = menuItemReachedByKey(e.key, all.indexOf(document.activeElement as HTMLElement), all.length);
            if (next === null) return;
            e.preventDefault();
            all[next]?.focus();
          }}
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className={`more-menu__item${item.danger ? ' more-menu__item--danger' : ''}`}
              onClick={() => {
                closeToTrigger();
                item.onSelect();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

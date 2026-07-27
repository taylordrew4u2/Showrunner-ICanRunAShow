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
 * The standard overflow menu: one "⋯" button that reveals a screen's secondary
 * actions. Secondary actions used to be scattered across the global navigation,
 * which meant the nav changed shape depending on what you were looking at. Here
 * they sit with the thing they act on.
 */
export function MoreMenu({ label, items }: MoreMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
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
        type="button"
        className="more-menu__trigger"
        onClick={() => setOpen((v) => !v)}
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
        <div className="more-menu__list" role="menu">
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className={`more-menu__item${item.danger ? ' more-menu__item--danger' : ''}`}
              onClick={() => {
                setOpen(false);
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

import { useEffect, useRef, useState } from 'react';
import './coproducer.css';

/**
 * Where the sync pill sits in the owner's app: says this is co-producer view,
 * opens what is waiting for the owner, and offers the way out. Nothing here
 * saves, so there is no save state to report: changes, shares and downloads
 * all go to the owner first.
 */
export function ReviewBanner({ pendingCount, offline, onOpenPending, onLeave }: {
  pendingCount: number;
  offline: boolean;
  onOpenPending: () => void;
  onLeave: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Close on a tap outside or Escape, like the sync pill's panel.
  useEffect(() => {
    if (!menuOpen) return;
    function onPointerDown(e: MouseEvent | TouchEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setMenuOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setMenuOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen]);

  const waiting = pendingCount > 0 ? `${pendingCount} waiting` : 'nothing waiting';
  return (
    <div className="review-banner" ref={rootRef}>
      <span className="review-banner__mode">Co-producer view</span>
      <span className="review-banner__hint">Changes, shares and downloads go to the owner first.</span>
      <button
        type="button"
        className="review-banner__pending"
        onClick={onOpenPending}
        aria-label={`Pending approval, ${waiting}`}
      >
        Pending approval
        {pendingCount > 0 && <span className="review-banner__badge" aria-hidden="true">{pendingCount}</span>}
      </button>
      <button
        type="button"
        className="review-banner__menu-button"
        onClick={() => setMenuOpen((open) => !open)}
        aria-expanded={menuOpen}
        aria-haspopup="menu"
        aria-label="Co-producer view menu"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="5" cy="12" r="2" />
          <circle cx="12" cy="12" r="2" />
          <circle cx="19" cy="12" r="2" />
        </svg>
      </button>
      {menuOpen && (
        <div className="review-banner__menu" role="menu" aria-label="Co-producer view">
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMenuOpen(false);
              onLeave();
            }}
          >
            Leave co-producer view
          </button>
        </div>
      )}
      {offline && (
        <span className="review-banner__offline" role="status">
          Offline — changes can't be sent for approval.
        </span>
      )}
    </div>
  );
}

# Shared UI primitives

React 19 + TypeScript + Vite 8. Custom components and vanilla CSS; no Tailwind or component library. Native button/input/select elements use shared `.btn`, form and badge classes defined in App.css (full raw source in theme.md).

## Icon
Typed inline SVG icon primitive; name, size, className, style and SVG attributes.

### `src/components/Icon.tsx`

```tsx
import type { CSSProperties } from 'react';

export type IconName =
  | 'calendar'
  | 'schedule'
  | 'clock'
  | 'users'
  | 'play'
  | 'pause'
  | 'stop'
  | 'settings'
  | 'search'
  | 'plus'
  | 'back'
  | 'more'
  | 'drag'
  | 'check'
  | 'edit'
  | 'x'
  | 'lock'
  | 'unlock'
  | 'music'
  | 'upload'
  | 'camera'
  | 'sparkle'
  | 'file'
  | 'image'
  | 'skip'
  | 'back-skip'
  | 'mic'
  | 'headphones'
  | 'wrench'
  | 'bolt'
  | 'tv'
  | 'filter'
  | 'chevron-right'
  | 'live'
  | 'shield'
  | 'download'
  | 'alert'
  | 'cloud'
  | 'dollar'
  | 'mail';

interface IconProps {
  name: IconName;
  size?: number;
  className?: string;
  style?: CSSProperties;
  'aria-hidden'?: boolean;
}

export function Icon({ name, size = 20, className, style, ...rest }: IconProps) {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    className,
    style,
    'aria-hidden': rest['aria-hidden'] ?? true,
  };

  switch (name) {
    case 'calendar':
      return (
        <svg {...common}>
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <path d="M16 2v4M8 2v4M3 10h18" />
        </svg>
      );
    case 'schedule':
    case 'clock':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
      );
    case 'users':
      return (
        <svg {...common}>
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      );
    case 'play':
      return (
        <svg {...common}>
          <polygon points="5 3 19 12 5 21 5 3" fill="currentColor" />
        </svg>
      );
    case 'pause':
      return (
        <svg {...common}>
          <rect x="6" y="4" width="4" height="16" fill="currentColor" />
          <rect x="14" y="4" width="4" height="16" fill="currentColor" />
        </svg>
      );
    case 'stop':
      return (
        <svg {...common}>
          <rect x="6" y="6" width="12" height="12" rx="1" fill="currentColor" />
        </svg>
      );
    case 'settings':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      );
    case 'search':
      return (
        <svg {...common}>
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
      );
    case 'plus':
      return (
        <svg {...common}>
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      );
    case 'back':
      return (
        <svg {...common}>
          <polyline points="15 18 9 12 15 6" />
        </svg>
      );
    case 'more':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="1" />
          <circle cx="19" cy="12" r="1" />
          <circle cx="5" cy="12" r="1" />
        </svg>
      );
    case 'drag':
      return (
        <svg {...common}>
          <circle cx="9" cy="6" r="1.2" fill="currentColor" />
          <circle cx="9" cy="12" r="1.2" fill="currentColor" />
          <circle cx="9" cy="18" r="1.2" fill="currentColor" />
          <circle cx="15" cy="6" r="1.2" fill="currentColor" />
          <circle cx="15" cy="12" r="1.2" fill="currentColor" />
          <circle cx="15" cy="18" r="1.2" fill="currentColor" />
        </svg>
      );
    case 'check':
      return (
        <svg {...common}>
          <polyline points="20 6 9 17 4 12" />
        </svg>
      );
    case 'edit':
      return (
        <svg {...common}>
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
        </svg>
      );
    case 'x':
      return (
        <svg {...common}>
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      );
    case 'lock':
      return (
        <svg {...common}>
          <rect x="3" y="11" width="18" height="11" rx="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
      );
    case 'unlock':
      return (
        <svg {...common}>
          <rect x="3" y="11" width="18" height="11" rx="2" />
          <path d="M7 11V7a5 5 0 0 1 9.9-1" />
        </svg>
      );
    case 'music':
      return (
        <svg {...common}>
          <path d="M9 18V5l12-2v13" />
          <circle cx="6" cy="18" r="3" />
          <circle cx="18" cy="16" r="3" />
        </svg>
      );
    case 'upload':
      return (
        <svg {...common}>
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" y1="3" x2="12" y2="15" />
        </svg>
      );
    case 'camera':
      return (
        <svg {...common}>
          <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
          <circle cx="12" cy="13" r="4" />
        </svg>
      );
    case 'sparkle':
      return (
        <svg {...common}>
          <path d="M12 3l1.6 4.6L18 9l-4.4 1.4L12 15l-1.6-4.6L6 9l4.4-1.4L12 3z" fill="currentColor" />
          <path d="M19 14l.7 2 2 .7-2 .7L19 19l-.7-1.6-2-.7 2-.7L19 14z" fill="currentColor" />
        </svg>
      );
    case 'file':
      return (
        <svg {...common}>
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
        </svg>
      );
    case 'image':
      return (
        <svg {...common}>
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <polyline points="21 15 16 10 5 21" />
        </svg>
      );
    case 'skip':
      return (
        <svg {...common}>
          <polygon points="5 4 15 12 5 20 5 4" fill="currentColor" />
          <line x1="19" y1="5" x2="19" y2="19" />
        </svg>
      );
    case 'back-skip':
      return (
        <svg {...common}>
          <polygon points="19 20 9 12 19 4 19 20" fill="currentColor" />
          <line x1="5" y1="19" x2="5" y2="5" />
        </svg>
      );
    case 'mic':
      return (
        <svg {...common}>
          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
          <line x1="12" y1="19" x2="12" y2="23" />
          <line x1="8" y1="23" x2="16" y2="23" />
        </svg>
      );
    case 'headphones':
      return (
        <svg {...common}>
          <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
          <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" />
        </svg>
      );
    case 'wrench':
      return (
        <svg {...common}>
          <path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18v3h3l6.3-6.3a4 4 0 0 0 5.4-5.4l-2.7 2.7-2.4-2.4 2.7-2.7z" />
        </svg>
      );
    case 'bolt':
      return (
        <svg {...common}>
          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" fill="currentColor" />
        </svg>
      );
    case 'tv':
      return (
        <svg {...common}>
          <rect x="2" y="7" width="20" height="15" rx="2" />
          <polyline points="17 2 12 7 7 2" />
        </svg>
      );
    case 'filter':
      return (
        <svg {...common}>
          <polygon points="22 3 2 3 10 12.5 10 19 14 21 14 12.5 22 3" />
        </svg>
      );
    case 'chevron-right':
      return (
        <svg {...common}>
          <polyline points="9 18 15 12 9 6" />
        </svg>
      );
    case 'live':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="4" fill="currentColor" />
          <path d="M5 5a10 10 0 0 0 0 14M19 5a10 10 0 0 1 0 14M8 8a6 6 0 0 0 0 8M16 8a6 6 0 0 1 0 8" />
        </svg>
      );
    case 'shield':
      return (
        <svg {...common}>
          <path d="M12 3l7 3v6c0 4.5-3 7.7-7 9-4-1.3-7-4.5-7-9V6z" />
          <polyline points="9 12 11 14 15 10" />
        </svg>
      );
    case 'download':
      return (
        <svg {...common}>
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
      );
    case 'alert':
      return (
        <svg {...common}>
          <path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
      );
    case 'cloud':
      return (
        <svg {...common}>
          <path d="M17.5 19a4.5 4.5 0 0 0 .5-8.97A6 6 0 0 0 6.1 11.2 3.5 3.5 0 0 0 6.5 19z" />
          <polyline points="9 14 11 16 15 12" />
        </svg>
      );
    case 'mail':
      return (
        <svg {...common}>
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="m3 7 9 6 9-6" />
        </svg>
      );
    case 'dollar':
      return (
        <svg {...common}>
          <path d="M12 2v20" />
          <path d="M17 6.5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
        </svg>
      );
    default:
      return null;
  }
}

```

## BrandMark
Shared actual stage-and-cue logo image; no props.

### `src/components/BrandMark.tsx`

```tsx
/** The same stage-and-cue mark used by the installed app and favicon. */
export function BrandMark() {
  return <img className="brand-mark" src="/brand/mark.svg" width="40" height="40" alt="" aria-hidden="true" />;
}

```

## Modal
Overlay dialog, initial/return focus, Escape and outside dismissal; children, onClose, labelledBy.

### `src/components/Modal.tsx`

```tsx
import { useEffect, useRef } from 'react';
import './Modal.css';

interface ModalProps {
  onClose: () => void;
  children: React.ReactNode;
  labelledBy?: string;
}

export function Modal({ onClose, children, labelledBy }: ModalProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previousFocusRef.current = document.activeElement as HTMLElement;

    const focusable = boxRef.current?.querySelector<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    (focusable ?? boxRef.current)?.focus();

    return () => {
      previousFocusRef.current?.focus();
    };
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      // The Escape that closes this dialog is spent closing it. Run Show keeps
      // a keydown listener on window for its own shortcuts, and window is
      // downstream of document — without this, one Escape both dismissed the
      // confirmation and closed the whole Run Show screen behind it.
      e.stopPropagation();
      onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        ref={boxRef}
        className="modal-box"
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

```

### `src/components/Modal.css`

```css
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  -webkit-backdrop-filter: blur(4px);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  /* Top of the layer scale — see --z-modal in App.css for why. */
  z-index: var(--z-modal);
  padding: var(--space-5);
  animation: fadeIn 0.2s ease-out;
}

@keyframes fadeIn {
  from {
    opacity: 0;
  }

  to {
    opacity: 1;
  }
}

.modal-box {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: var(--space-8);
  width: 100%;
  max-width: 560px;
  max-height: 90dvh;
  overflow-y: auto;
  box-shadow: var(--shadow-md);
  animation: slideUp 0.3s ease-out;
}

@keyframes slideUp {
  from {
    transform: translateY(20px);
    opacity: 0;
  }

  to {
    transform: translateY(0);
    opacity: 1;
  }
}

@media (max-width: 640px) {
  .modal-overlay {
    padding: 0;
    align-items: flex-end;
  }

  .modal-box {
    max-width: 100%;
    max-height: 92dvh;
    border-radius: var(--radius-lg) var(--radius-lg) 0 0;
    padding: calc(24px + env(safe-area-inset-top)) 20px calc(24px + env(safe-area-inset-bottom));
  }
}

```

## useConfirm
Promise-based confirm dialog using Modal; action text, title, description and danger state.

### `src/components/useConfirm.tsx`

```tsx
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Modal } from './Modal';
import './useConfirm.css';

/**
 * A confirmation prompt that doesn't stop the page.
 *
 * Everything destructive in this app used to go through `window.confirm`,
 * which is the one browser API that halts the event loop until the user
 * answers. In a plain desktop tab you get away with it. Inside the installed
 * app — an iOS WKWebView under Capacitor, or a standalone PWA — the native
 * panel can fail to present while the page is mid-transition, and because the
 * call blocks, the page it was called from stops responding with it. A delete
 * button that can hang the app is worse than no confirmation at all.
 *
 * So the prompt is the app's own Modal now: rendered, not blocking. The call
 * site keeps the shape it had —
 *
 *   if (await confirm('Delete this?')) { ... }
 *
 * — so it still reads as a question asked before the damage is done, and the
 * answer still arrives before the next line runs.
 */

export interface ConfirmOptions {
  /** The question. Say what will happen, and whether it can be undone. */
  message: string;
  title?: string;
  /** The verb on the confirm button. Name the action — a button that says
   *  "Delete" on a prompt about ending a show is worse than no label. */
  confirmLabel?: string;
  cancelLabel?: string;
  /** Styles the confirm button as destructive. Defaults to true, since most of
   *  these are deletions — pass false for anything that doesn't destroy data. */
  danger?: boolean;
}

export function useConfirm() {
  const [pending, setPending] = useState<ConfirmOptions | null>(null);
  const resolveRef = useRef<((ok: boolean) => void) | null>(null);

  // A pending promise outlives the component if the screen changes under it
  // (navigating away, the show closing). Answer it "no" rather than leaving a
  // caller awaiting something that can never settle.
  useEffect(() => {
    return () => {
      resolveRef.current?.(false);
      resolveRef.current = null;
    };
  }, []);

  const confirm = useCallback((options: ConfirmOptions | string) => {
    const opts = typeof options === 'string' ? { message: options } : options;
    // A second question while one is open would strand the first promise.
    // The last one asked is the one on screen, so settle the earlier one.
    resolveRef.current?.(false);
    setPending(opts);
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve;
    });
  }, []);

  const settle = useCallback((ok: boolean) => {
    setPending(null);
    resolveRef.current?.(ok);
    resolveRef.current = null;
  }, []);

  // Portalled to <body> so the caller can drop {confirmDialog} anywhere in its
  // JSX without thinking about it. The overlay is fixed-position, and a fixed
  // element is positioned against the nearest ancestor with a transform or a
  // filter rather than the viewport — which, rendered in place, would make the
  // dialog's behaviour depend on whatever card or panel happened to contain it.
  const confirmDialog = pending ? createPortal(
    <Modal onClose={() => settle(false)} labelledBy="confirm-dialog-title">
      {/* No stock "Are you sure?" above a message that already asks a
          question — it just pushed the real words down a line. A caller with
          something to add sets a title; otherwise the question is the heading
          as far as assistive tech is concerned. */}
      {pending.title && (
        <h2 className="confirm-dialog__title" id="confirm-dialog-title">
          {pending.title}
        </h2>
      )}
      <p
        className="confirm-dialog__message"
        id={pending.title ? undefined : 'confirm-dialog-title'}
      >
        {pending.message}
      </p>
      <div className="confirm-dialog__actions">
        {/* Cancel comes first in the DOM so it takes the modal's initial
            focus. On a destructive prompt the safe answer is the one that
            should be a keystroke away, not the irreversible one. */}
        <button type="button" className="btn btn--ghost" onClick={() => settle(false)}>
          {pending.cancelLabel ?? 'Cancel'}
        </button>
        <button
          type="button"
          className={`btn ${pending.danger === false ? 'btn--primary' : 'btn--danger'}`}
          onClick={() => settle(true)}
        >
          {pending.confirmLabel ?? 'Delete'}
        </button>
      </div>
    </Modal>,
    document.body,
  ) : null;

  // For callers that run their own global keyboard shortcuts. A rendered
  // dialog doesn't stop a window-level keydown listener the way the old
  // blocking window.confirm did — that one froze the event loop, which is
  // precisely what made it safe and what made it unusable. Anything listening
  // outside the dialog has to know to stand down while a question is on screen.
  return { confirm, confirmDialog, confirmOpen: pending !== null };
}

```

### `src/components/useConfirm.css`

```css
.confirm-dialog__title {
  margin: 0 0 var(--space-2);
  font-size: var(--text-lg);
  font-weight: 700;
  letter-spacing: -0.015em;
  color: var(--text);
}

.confirm-dialog__message {
  margin: 0 0 var(--space-4-5);
  font-size: var(--text-md);
  line-height: 1.45;
  color: var(--text-muted);
  overflow-wrap: break-word;
}

/* Confirm sits on the right, where the primary action sits everywhere else in
   the app. Cancel is still the one that holds focus — see the DOM order. */
.confirm-dialog__actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
  flex-wrap: wrap;
}

```

## MoreMenu
Reusable overflow menu; label and items.

### `src/components/MoreMenu.tsx`

```tsx
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

```

### `src/components/MoreMenu.css`

```css
.more-menu {
  position: relative;
  flex-shrink: 0;
}

.more-menu__trigger {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 44px;
  min-height: 44px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--surface);
  color: var(--text-muted);
  cursor: pointer;
  touch-action: manipulation;
  transition: background-color var(--duration-fast) ease, color var(--duration-fast) ease, border-color var(--duration-fast) ease;
}

.more-menu__trigger:hover,
.more-menu__trigger[aria-expanded='true'] {
  background: var(--surface-strong);
  color: var(--text);
  border-color: var(--border-strong);
}

.more-menu__trigger:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
}

.more-menu__list {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: var(--z-overlay);
  /* The menu hangs left from the trigger, so on a narrow phone a fixed 200px
     could reach past the left edge. Never wider than the screen allows. */
  min-width: min(200px, calc(100vw - 24px));
  max-width: calc(100vw - 24px);
  padding: var(--space-1);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-md);
  animation: more-menu-in 0.14s var(--ease-out);
}

@keyframes more-menu-in {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .more-menu__list {
    animation: none;
  }
}

.more-menu__item {
  display: block;
  width: 100%;
  min-height: 44px;
  padding: var(--space-2-5) var(--space-3);
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text);
  font-family: inherit;
  font-size: var(--text-base);
  font-weight: 600;
  text-align: left;
  cursor: pointer;
  touch-action: manipulation;
  transition: background-color var(--duration-fast) ease;
}

.more-menu__item:hover {
  background: var(--surface-strong);
}

.more-menu__item--danger {
  color: var(--danger-text);
}

```

## TrackPreview
Audio preview button; source and optional trim boundaries.

### `src/components/TrackPreview.tsx`

```tsx
import type { TrackPreview } from '../utils/useTrackPreview';
import { Icon } from './Icon';

/**
 * The round play/stop button on an uploaded track. State and playback live in
 * useTrackPreview — one per list, so two rows can never both claim to be
 * playing.
 */
export function TrackPreviewButton({
  src,
  title,
  preview,
}: {
  src: string;
  title: string;
  preview: TrackPreview;
}) {
  const playing = preview.playingSrc === src;
  return (
    <button
      type="button"
      className={`track-preview ${playing ? 'track-preview--playing' : ''}`}
      onClick={() => preview.toggle(src)}
      aria-pressed={playing}
      aria-label={playing ? `Stop ${title}` : `Play ${title}`}
      title={playing ? `Stop ${title}` : `Play ${title}`}
    >
      <Icon name={playing ? 'pause' : 'play'} size={16} />
    </button>
  );
}

```

### `src/components/TrackPreview.css`

```css
/* The play button on an uploaded track. Round, because that is what reads as
   "press me to hear this" — and because a song that has landed should look
   like something, not like a line of text. */
.track-preview {
  flex-shrink: 0;
  width: 38px;
  height: 38px;
  border-radius: var(--radius-full);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--primary-soft);
  border: 1px solid var(--primary);
  color: var(--primary-text);
  cursor: pointer;
  transition: transform var(--duration-fast) ease, background var(--duration-fast) ease;
}
.track-preview:hover { background: var(--primary); color: var(--on-primary); }
.track-preview:active { transform: scale(0.93); }
.track-preview:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
.track-preview--playing {
  background: var(--success);
  border-color: var(--success);
  color: var(--on-success);
  animation: track-preview-pulse 1.8s ease-in-out infinite;
}
@keyframes track-preview-pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(22, 163, 74, 0.45); }
  50% { box-shadow: 0 0 0 6px rgba(22, 163, 74, 0); }
}
@media (prefers-reduced-motion: reduce) {
  .track-preview--playing { animation: none; }
}

/* Sits in the empty slot a song without audio leaves, so the rows still line
   up and "this one has no file" is visible down the column. */
.track-preview--empty {
  border-style: dashed;
  border-color: var(--border-strong);
  background: none;
  color: var(--text-muted);
  cursor: default;
}
.track-preview--empty:hover { background: none; color: var(--text-muted); }

```

## TrimControls
Audio trim preview and start/end controls; src, startSec, endSec, onChange.

### `src/components/TrimControls.tsx`

```tsx
import { useEffect, useRef, useState } from 'react';
import { audioEngine } from '../utils/audioEngine';
import { formatTimecode, parseTimecode, trimmedLength } from '../utils/trim';
import './TrimControls.css';

interface TrimControlsProps {
  /** The audio this trim applies to, so the preview can play the real thing. */
  src?: string;
  startSec?: number;
  endSec?: number;
  onChange: (trim: { startSec?: number; endSec?: number }) => void;
}

/**
 * Set where a song starts and stops.
 *
 * The preview is the point of this control, not a nicety: a producer can read
 * "1:12" off a music player, but whether the cut lands on the beat is not
 * something you can tell by looking at a number. This plays exactly what the
 * soundboard button will play, so the answer is a press away.
 */
export function TrimControls({ src, startSec, endSec, onChange }: TrimControlsProps) {
  // Held as text while being typed: "1:2" is halfway to "1:23" and must not be
  // snapped to 1 minute 2 seconds under the producer's fingers.
  const [startText, setStartText] = useState(() => formatTimecode(startSec));
  const [endText, setEndText] = useState(() => formatTimecode(endSec));
  const [previewing, setPreviewing] = useState(false);
  const previewTimer = useRef<number | null>(null);

  // Follow the record when it changes underneath — a different song being
  // edited, or a change made elsewhere. Adjusted during render rather than in
  // an effect: an effect would paint the old timecode for a frame first, and
  // React re-runs this render before committing anything.
  const [lastStart, setLastStart] = useState(startSec);
  if (startSec !== lastStart) {
    setLastStart(startSec);
    setStartText(formatTimecode(startSec));
  }
  const [lastEnd, setLastEnd] = useState(endSec);
  if (endSec !== lastEnd) {
    setLastEnd(endSec);
    setEndText(formatTimecode(endSec));
  }

  useEffect(() => () => {
    if (previewTimer.current !== null) window.clearTimeout(previewTimer.current);
  }, []);

  const startInvalid = startText.trim() !== '' && parseTimecode(startText) == null;
  const endInvalid = endText.trim() !== '' && parseTimecode(endText) == null;
  const length = trimmedLength(startSec, endSec);
  // Only worth flagging once both ends are real numbers — mid-typing, "end
  // before start" is just an unfinished edit.
  const backwards =
    startSec != null && endSec != null && !startInvalid && !endInvalid && endSec <= startSec;

  function commit(which: 'start' | 'end', text: string) {
    const trimmed = text.trim();
    const value = trimmed === '' ? undefined : parseTimecode(trimmed) ?? undefined;
    // An unparseable entry leaves the stored value alone rather than wiping it.
    if (trimmed !== '' && value == null) return;
    onChange(which === 'start' ? { startSec: value, endSec } : { startSec, endSec: value });
  }

  function stopPreview() {
    if (previewTimer.current !== null) {
      window.clearTimeout(previewTimer.current);
      previewTimer.current = null;
    }
    audioEngine.stop({ fadeMs: 120 });
    setPreviewing(false);
  }

  function togglePreview() {
    if (previewing) {
      stopPreview();
      return;
    }
    if (!src) return;
    setPreviewing(true);
    audioEngine.play(src, {
      fadeInMs: 0,
      fadeOutMs: 120,
      offsetSec: startSec,
      durationSec: length ?? undefined,
      onEnded: () => setPreviewing(false),
    });
    // A song with no out-point would otherwise run the whole track from this
    // little row. Cap the audition; the real button plays it in full.
    const capMs = ((length ?? 15) + 0.3) * 1000;
    previewTimer.current = window.setTimeout(() => {
      previewTimer.current = null;
      stopPreview();
    }, capMs);
  }

  return (
    <div className="trim">
      <div className="trim__fields">
        <label className="trim__field">
          <span className="trim__label">Starts at</span>
          <input
            className={`trim__input${startInvalid ? ' trim__input--invalid' : ''}`}
            value={startText}
            onChange={(e) => setStartText(e.target.value)}
            onBlur={() => commit('start', startText)}
            onKeyDown={(e) => e.key === 'Enter' && commit('start', startText)}
            placeholder="0:00"
            inputMode="numeric"
            aria-label="Start time"
            aria-invalid={startInvalid || undefined}
          />
        </label>
        <label className="trim__field">
          <span className="trim__label">Ends at</span>
          <input
            className={`trim__input${endInvalid || backwards ? ' trim__input--invalid' : ''}`}
            value={endText}
            onChange={(e) => setEndText(e.target.value)}
            onBlur={() => commit('end', endText)}
            onKeyDown={(e) => e.key === 'Enter' && commit('end', endText)}
            placeholder="end of track"
            inputMode="numeric"
            aria-label="End time"
            aria-invalid={endInvalid || backwards || undefined}
          />
        </label>
        {src && (
          <button
            type="button"
            className="btn btn--secondary btn--sm trim__preview"
            onClick={togglePreview}
          >
            {previewing ? 'Stop' : 'Hear it'}
          </button>
        )}
      </div>
      <p className="trim__hint">
        {startInvalid || endInvalid
          ? 'Use mm:ss — 1:23 — or just the number of seconds.'
          : backwards
            ? 'The end is before the start, so the whole track will play.'
            : length != null
              ? `Plays ${formatTimecode(length)} of the track.`
              : 'Leave blank to play the whole track.'}
      </p>
    </div>
  );
}

```

### `src/components/TrimControls.css`

```css
/* ── Song trim (in/out points) ─────────────────────────────────────────
   Sits under a song row, so it stays visually subordinate to the track it
   belongs to rather than reading as a section of its own. */
.trim {
  margin-top: var(--space-2);
  padding-top: var(--space-2);
  border-top: 1px dashed var(--border);
}

.trim__fields {
  display: flex;
  align-items: flex-end;
  gap: var(--space-2);
  flex-wrap: wrap;
}

.trim__field {
  display: flex;
  flex-direction: column;
  gap: var(--space-0-5);
  /* Wide enough for "end of track" without stretching: these hold a timecode,
     and a full-width box would imply a sentence goes in it. */
  flex: 0 1 118px;
  min-width: 0;
}

.trim__label {
  font-size: var(--text-xs);
  font-weight: 650;
  color: var(--text-muted);
}

.trim__input {
  width: 100%;
  min-width: 0;
  padding: var(--space-1-5) var(--space-2);
  font: inherit;
  font-size: var(--text-md);
  font-variant-numeric: tabular-nums;
  color: var(--text);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
}

.trim__input:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 1px;
}

.trim__input--invalid {
  border-color: var(--danger);
}

/* A finger-sized target under a finger, matching every other small button. */
@media (pointer: coarse) {
  .trim__input,
  .trim__preview {
    min-height: var(--tap-min);
  }
}

.trim__preview {
  flex-shrink: 0;
}

.trim__hint {
  margin: var(--space-1-5) 0 0;
  font-size: var(--text-xs);
  color: var(--text-muted);
}

```

## OnStagePicker
Shared host/performer assignment picker; value, people/host and selection callbacks.

### `src/components/OnStagePicker.tsx`

```tsx
import { useEffect, useRef, useState } from 'react';
import type { Performer, PotentialComic } from '../types';

/**
 * Who's on stage for a cue — one control, everywhere a cue is edited.
 *
 * There used to be a text box called "On stage" with a separate dropdown
 * beside it, and the AI import screen had the text box alone. So the same
 * question was asked two ways in one place and one way in the other, and only
 * the dropdown produced the link Run Show needs to put a face and a walk-on on
 * the soundboard. Typing a name is an option inside this control rather than a
 * rival to it.
 */

/** Sentinel values for people with no performer record to link to. */
const HOST_OPTION = 'host:';
const CUSTOM_OPTION = 'custom:';

export interface OnStageValue {
  performer?: string;
  performerId?: string;
}

interface OnStagePickerProps {
  value: OnStageValue;
  /** This show's bill. */
  performers: Performer[];
  /** Everyone on file who isn't booked on this show yet. */
  unbookedComics?: PotentialComic[];
  /** Who's hosting, from the Host field on the show. */
  host?: string;
  /**
   * Book someone from the Rolodex onto this show and hand back their new
   * record, so the cue can link to it. Without it the Rolodex group is hidden,
   * because picking from it would have nothing to attach.
   */
  onBookPerformer?: (comic: PotentialComic) => Performer;
  onChange: (next: OnStageValue) => void;
  selectClassName?: string;
  inputClassName?: string;
  /** Enter in the name box. */
  onSubmit?: () => void;
  /** Escape in the name box. */
  onCancel?: () => void;
}

export function OnStagePicker({
  value,
  performers,
  unbookedComics = [],
  host,
  onBookPerformer,
  onChange,
  selectClassName,
  inputClassName,
  onSubmit,
  onCancel,
}: OnStagePickerProps) {
  // "Someone else" is chosen but nothing typed yet. Read off the name alone,
  // picking it on an empty cue put nothing on screen — the option needs a box
  // to type into, and the box only existed once a name had been typed in it.
  const [typingName, setTypingName] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const focusNameRef = useRef(false);

  const performerId = value.performerId ?? '';
  const typedName = (value.performer ?? '').trim();
  const hostName = host?.trim() ?? '';
  // A host who is also booked is already in the list — link the cue to that
  // record so Run Show gets their face and their walk-on, and mark which one
  // they are rather than offering the same person twice.
  const hostPerformer = hostName
    ? performers.find((p) => p.name.trim().toLowerCase() === hostName.toLowerCase())
    : undefined;
  const hostOnly = !!hostName && !hostPerformer;
  const isHostPick = hostOnly && typedName.toLowerCase() === hostName.toLowerCase();
  const isCustom = !performerId && !isHostPick && (typedName !== '' || typingName);
  // A pick with no record has no id to hold, so a sentinel stands in for it —
  // otherwise the select would fall back to "nobody" as though nothing had been
  // chosen at all.
  const selectValue = performerId || (isHostPick ? HOST_OPTION : isCustom ? CUSTOM_OPTION : '');

  // Choosing "someone else" should land the cursor in the box it reveals — but
  // only when it was just chosen. Opening a cue that already has a typed name
  // must leave focus wherever editing starts.
  useEffect(() => {
    if (!focusNameRef.current) return;
    focusNameRef.current = false;
    nameInputRef.current?.focus();
  }, [isCustom]);

  function pick(next: string) {
    if (next === CUSTOM_OPTION) {
      // Someone with no record anywhere — a guest, a drop-in, a name off a run
      // sheet. Keep whatever is already typed and put the cursor in the box.
      setTypingName(true);
      focusNameRef.current = true;
      onChange({ performer: typedName || undefined, performerId: undefined });
      return;
    }
    setTypingName(false);
    if (next === '') {
      onChange({ performer: undefined, performerId: undefined });
      return;
    }
    if (next === HOST_OPTION) {
      // The host isn't on the bill, so there's no record to link — the name is
      // the whole attachment, and Run Show reads it to put them on stage.
      onChange({ performer: hostName, performerId: undefined });
      return;
    }
    if (next.startsWith('rolodex:')) {
      const comic = unbookedComics.find((c) => c.id === next.slice('rolodex:'.length));
      const booked = comic && onBookPerformer?.(comic);
      if (booked) onChange({ performer: booked.name, performerId: booked.id });
      return;
    }
    const perf = performers.find((p) => p.id === next);
    onChange({ performer: perf?.name, performerId: next });
  }

  return (
    <>
      <select
        className={selectClassName}
        value={selectValue}
        onChange={(e) => pick(e.target.value)}
        aria-label="Who's on stage"
      >
        <option value="">On stage: nobody</option>
        {/* First, because on most nights the host works more cues than anybody
            on the bill does. */}
        {hostOnly && (
          <optgroup label="Hosting">
            <option value={HOST_OPTION}>{hostName}</option>
          </optgroup>
        )}
        {performers.length > 0 && (
          <optgroup label="On this bill">
            {performers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.id === hostPerformer?.id ? ' (host)' : ''}
                {p.walkOnMusic ? ' (walk-on)' : ''}
              </option>
            ))}
          </optgroup>
        )}
        {onBookPerformer && unbookedComics.length > 0 && (
          <optgroup label="From your Rolodex — adds them to the bill">
            {unbookedComics.map((c) => (
              <option key={c.id} value={`rolodex:${c.id}`}>
                {c.name}{c.walkOnMusic ? ' (walk-on)' : ''}
              </option>
            ))}
          </optgroup>
        )}
        <optgroup label="Not on file">
          {/* Reads the name back when there is one, so the closed select still
              says who is on stage rather than "someone". */}
          {/* Reads the name back only when this is the option in force. Echoing
              it unconditionally listed the host twice — once under Hosting,
              once here. */}
          <option value={CUSTOM_OPTION}>
            {isCustom && typedName ? typedName : 'Someone else — type a name'}
          </option>
        </optgroup>
      </select>
      {isCustom && (
        <input
          ref={nameInputRef}
          className={inputClassName}
          value={value.performer ?? ''}
          onChange={(e) => onChange({ performer: e.target.value, performerId: undefined })}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onSubmit?.();
            if (e.key === 'Escape') onCancel?.();
          }}
          aria-label="Name of who's on stage"
          placeholder="Their name"
        />
      )}
    </>
  );
}

```

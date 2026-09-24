import { useEffect, useRef } from 'react';
import './Modal.css';

interface ModalProps {
  onClose: () => void;
  children: React.ReactNode;
  labelledBy?: string;
  /** An accessible name, for a dialog whose heading has no id to point at. */
  label?: string;
}

const FOCUSABLE =
  'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

// Every open dialog, in the order they opened. A confirmation over a sheet
// is two dialogs; only the one on top should answer to Escape, or one press
// dismissed the confirmation and the sheet it was asking about.
const openDialogs: symbol[] = [];

export function Modal({ onClose, children, labelledBy, label }: ModalProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const idRef = useRef(Symbol('modal'));
  // Where the pointer went down. A click is delivered to the common ancestor
  // of where a press started and ended, so a drag that started in a text box
  // and ended on the overlay used to count as a tap on the overlay and close
  // the dialog, edits and all.
  const pressedOverlayRef = useRef(false);

  useEffect(() => {
    previousFocusRef.current = document.activeElement as HTMLElement;
    const id = idRef.current;
    openDialogs.push(id);

    const focusable = boxRef.current?.querySelector<HTMLElement>(FOCUSABLE);
    (focusable ?? boxRef.current)?.focus();

    return () => {
      const at = openDialogs.indexOf(id);
      if (at !== -1) openDialogs.splice(at, 1);
      // The control that opened this may have gone with what it confirmed —
      // a row's Delete button leaves with the row — and focusing a detached
      // node drops focus to the top of the page.
      const previous = previousFocusRef.current;
      if (previous?.isConnected) previous.focus();
    };
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const box = boxRef.current;
      if (e.key === 'Tab' && box) {
        // Tab stays inside: aria-modal alone does not keep a keyboard out of
        // the page behind the overlay, whose controls still work when reached.
        const controls = [...box.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
          (el) => el.getClientRects().length > 0,
        );
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (!first) {
          e.preventDefault();
          box.focus();
          return;
        }
        const active = document.activeElement;
        if (!box.contains(active) || active === box || (e.shiftKey ? active === first : active === last)) {
          e.preventDefault();
          (e.shiftKey ? last : first).focus();
        }
        return;
      }
      if (e.key !== 'Escape') return;
      if (openDialogs[openDialogs.length - 1] !== idRef.current) return;
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
    <div
      className="modal-overlay"
      onPointerDown={(e) => { pressedOverlayRef.current = e.target === e.currentTarget; }}
      onClick={(e) => {
        const pressedHere = pressedOverlayRef.current && e.target === e.currentTarget;
        pressedOverlayRef.current = false;
        if (pressedHere) onClose();
      }}
    >
      <div
        ref={boxRef}
        className="modal-box"
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-label={labelledBy ? undefined : label}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

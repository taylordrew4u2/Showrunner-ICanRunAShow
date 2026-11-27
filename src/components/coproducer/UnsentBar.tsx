import { useState } from 'react';
import { useConfirm } from '../useConfirm';
import { localConfirm } from './localConfirm';
import { NoTapeSign } from './NoTapeSign';
import './coproducer.css';

/** "8:42 PM" from an ISO time; anything else as it was given. */
function shownAt(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T/.test(value)) return value;
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? value : at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/**
 * What the co-producer has changed and not sent. Nothing goes to the owner by
 * itself: edits wait here, across screens, until they are reviewed and sent
 * as one request, or discarded.
 */
export function UnsentBar({ count, staging, heldBackAt, noTape = [], onReview, onDiscard }: {
  count: number;
  /** A file is still uploading: nothing can be sent or discarded until it lands. */
  staging: boolean;
  /** When truth is held back for unsent changes: the time the account is shown as of. */
  heldBackAt: string | null;
  /** Everyone new in the unsent changes who has no tape: the no-tape sign stays up while there is anyone. */
  noTape?: readonly string[];
  onReview: () => void;
  /** Called once the co-producer has confirmed. */
  onDiscard: () => void;
}) {
  const { confirm, confirmDialog } = useConfirm();
  const [waitNote, setWaitNote] = useState(false);

  async function discard() {
    if (staging) {
      setWaitNote(true);
      return;
    }
    setWaitNote(false);
    const sure = await confirm(localConfirm({
      title: 'Discard your changes?',
      message: "They haven't been sent.",
      confirmLabel: 'Discard',
    }));
    if (sure) onDiscard();
  }

  return (
    <div className="unsent-bar" role="region" aria-label="Changes not sent yet">
      {noTape.length > 0 && <NoTapeSign names={noTape} />}
      <p className="unsent-bar__text">
        <span>{count === 1 ? '1 change' : `${count} changes`} not sent yet</span>
        {staging && <span className="unsent-bar__line" role="status">Uploading… your file has to finish before you can send.</span>}
        {staging && waitNote && <span className="unsent-bar__line" role="status">Wait for the upload to finish.</span>}
        {heldBackAt && (
          <span className="unsent-bar__line">
            Showing the account as of {shownAt(heldBackAt)}. Send or discard your changes to see newer ones.
          </span>
        )}
      </p>
      <div className="unsent-bar__actions">
        <button type="button" className="btn btn--primary btn--sm" onClick={onReview}>
          Review &amp; send
        </button>
        <button type="button" className="btn btn--secondary btn--sm" onClick={() => void discard()}>
          Discard
        </button>
      </div>
      {confirmDialog}
    </div>
  );
}

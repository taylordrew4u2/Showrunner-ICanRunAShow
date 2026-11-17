import { approvedLabel } from '../../coproducer/deliverApproved';
import { useReview, type AskRequest } from '../../coproducer/ReviewContext';
import './coproducer.css';

export type AskButtonProps = AskRequest & {
  className?: string;
  /** What the control usually says: "Download", "Copy post". */
  children: React.ReactNode;
};

/**
 * A share or download control in co-producer view.
 *
 * Tapping it asks the owner rather than doing it. Until the request is in, the
 * control says "Sending…" and a second tap does nothing. While it waits the
 * control says "Pending approval" and does nothing; once approved it says
 * what a tap will do ("Approved — tap to download") and hands the item over
 * from that tap. Once handed over, or turned down, it is the usual control
 * again, and doing it again means asking again.
 */
export function AskButton({ className, children, ...props }: AskButtonProps) {
  const review = useReview();
  const request = { kind: props.kind, action: props.action } as AskRequest;
  const state = review.actionState(request.action);
  const classes = (extra: string) => [className, 'ask-button', extra].filter(Boolean).join(' ');

  if (state.state === 'pending' || state.state === 'stale') {
    return (
      <button type="button" className={classes('ask-button--pending')} disabled>
        <span className="pending-pill">Pending approval</span>
      </button>
    );
  }
  if (state.state === 'sending') {
    return (
      <button type="button" className={classes('ask-button--sending')} disabled aria-busy="true">
        Sending…
      </button>
    );
  }
  if (state.state === 'preparing') {
    return (
      <button type="button" className={classes('ask-button--preparing')} disabled aria-busy="true">
        Getting it ready…
      </button>
    );
  }
  if (state.state === 'approved') {
    const requestId = state.requestId;
    return (
      <button type="button" className={classes('ask-button--approved')} onClick={() => review.deliver(requestId)}>
        {approvedLabel(request.action)}
      </button>
    );
  }
  return (
    <button type="button" className={classes('')} onClick={() => review.ask(request)}>
      {children}
    </button>
  );
}

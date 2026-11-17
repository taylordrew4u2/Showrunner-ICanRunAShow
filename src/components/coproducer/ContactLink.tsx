import { useReview } from '../../coproducer/ReviewContext';
import type { EmailSource } from '../../coproducer/types';
import { AskButton } from './AskButton';

/**
 * An email link: a plain mailto: link in the owner's app; in co-producer view
 * a control that asks the owner first, carrying the link exactly as it would
 * have opened, so the owner sees every recipient, the subject and the body.
 */
export function ContactLink({ href, source, showId, className, children }: {
  href: string;
  source: EmailSource;
  showId?: string;
  className?: string;
  children: React.ReactNode;
}) {
  const review = useReview();
  if (!review.active) return <a className={className} href={href}>{children}</a>;
  return (
    <AskButton kind="share" action={{ type: 'email', source, ...(showId ? { showId } : {}), href }} className={className}>
      {children}
    </AskButton>
  );
}

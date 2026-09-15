import type { Performer } from '../types';
import { bulkMailto, isEmail } from '../utils/social';

/** Keep the same lineup tools available in both the overview and editor. */
export function LineupActions({ performers, showName, onAnnounce }: {
  performers: Performer[];
  showName?: string;
  onAnnounce?: () => void;
}) {
  const emailable = performers.filter(person => isEmail(person.email));
  const href = bulkMailto(emailable.map(person => person.email), {
    subject: showName ? `${showName} — confirmation` : 'Show confirmation',
    body: `Hi everyone,\n\nConfirming your spot${showName ? ` for ${showName}` : ''}. Details below — please reply to confirm you're good to go.\n\nThanks!`,
  });
  if (!href && !(onAnnounce && performers.length)) return null;
  return <div className="section-mass-message">
    {onAnnounce && performers.length > 0 && <button className="btn btn--secondary btn--sm" onClick={onAnnounce}>Post copy</button>}
    {href && <a className="btn btn--secondary btn--sm" href={href}>✉ Email all performers ({emailable.length})</a>}
    <span className="section-mass-message__hint">Copy the comics and their socials, ready to paste.{href ? " Email opens your mail app with everyone BCC'd." : ''}</span>
  </div>;
}

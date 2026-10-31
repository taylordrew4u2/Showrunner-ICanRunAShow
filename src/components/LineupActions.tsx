import { Icon } from './Icon';
import { HeadshotExport } from './HeadshotExport';
import type { Performer } from '../types';
import { bulkMailto, isEmail } from '../utils/social';
import { countHeadshots } from '../utils/headshotExport';
import { billedPerformers, surpriseGuests } from '../utils/surpriseGuests';

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
  const headshots = countHeadshots(performers);
  // Said, so a guest missing from the photos reads as the app keeping the
  // secret rather than as a face the download forgot.
  const guestsLeftOut = countHeadshots(surpriseGuests(performers)) > 0 && countHeadshots(billedPerformers(performers)) > 0;
  if (!href && !(onAnnounce && performers.length) && !headshots) return null;
  return <div className="section-mass-message">
    {onAnnounce && performers.length > 0 && <button className="btn btn--secondary btn--sm" onClick={onAnnounce}>Post copy</button>}
    {href && <a className="btn btn--secondary btn--sm" href={href}><Icon name="mail" size={16} /> Email all performers ({emailable.length})</a>}
    <HeadshotExport performers={performers} showName={showName} />
    <HeadshotExport performers={performers} showName={showName} includesGuests />
    <span className="section-mass-message__hint">Copy the comics and their socials, ready to paste.{href ? " Email opens your mail app with everyone BCC'd." : ''}{headshots ? ' Headshots come named after each performer.' : ''}{guestsLeftOut ? ' Surprise guests are left out of the headshots unless you choose to include them.' : ''}</span>
  </div>;
}

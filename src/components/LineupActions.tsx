import { Icon } from './Icon';
import { HeadshotExport } from './HeadshotExport';
import type { Performer } from '../types';
import { bulkMailto, isEmail } from '../utils/social';
import { countHeadshots } from '../utils/headshotExport';

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
  if (!href && !(onAnnounce && performers.length) && !headshots) return null;
  return <div className="section-mass-message">
    {onAnnounce && performers.length > 0 && <button className="btn btn--secondary btn--sm" onClick={onAnnounce}>Post copy</button>}
    {href && <a className="btn btn--secondary btn--sm" href={href}><Icon name="mail" size={16} /> Email all performers ({emailable.length})</a>}
    <HeadshotExport performers={performers} showName={showName} />
    <span className="section-mass-message__hint">Copy the comics and their socials, ready to paste.{href ? " Email opens your mail app with everyone BCC'd." : ''}{headshots ? ' Headshots come named after each performer.' : ''}</span>
  </div>;
}

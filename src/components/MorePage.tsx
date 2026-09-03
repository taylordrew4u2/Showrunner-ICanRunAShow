import { PageHeader } from './PageHeader';
import { Icon, type IconName } from './Icon';
import './MorePage.css';

export interface MoreDestination {
  key: string;
  label: string;
  description: string;
  icon: IconName;
  /** A count worth showing on the row, e.g. contracts still unsigned. */
  badge?: number;
  onSelect: () => void;
}

interface MorePageProps {
  destinations: MoreDestination[];
  onBack: () => void;
}

/**
 * The things you do between shows rather than during one.
 *
 * The tab bar had grown to seven, which is past what a phone can label — at
 * 375px the widest captions had to be shrunk twice to stop them colliding, and
 * a bar that wide stops being a summary of the app and becomes a list to read.
 * Contracts, the email list and account expenses are all periodic paperwork:
 * real, but not what you open the app to do on a show night. They live here,
 * one tap from the bar, and the four that are left are the ones you actually
 * work in.
 */
export function MorePage({ destinations, onBack }: MorePageProps) {
  return (
    <div className="page more-page">
      <PageHeader title="More" onBack={onBack} backLabel="Shows" />
      <div className="more-list">
        {destinations.map((item) => (
          <button key={item.key} className="more-item" onClick={item.onSelect}>
            <span className="more-item__icon" aria-hidden="true">
              <Icon name={item.icon} size={18} />
            </span>
            <span className="more-item__text">
              <span className="more-item__label">{item.label}</span>
              <span className="more-item__desc">{item.description}</span>
            </span>
            {item.badge ? <span className="more-item__badge">{item.badge}</span> : null}
            <svg className="more-item__chevron" viewBox="0 0 8 13" aria-hidden="true">
              <path
                d="M1.5 1.5 6 6.5 1.5 11.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        ))}
      </div>
    </div>
  );
}

import './PageHeader.css';

interface PageHeaderProps {
  /** The screen's name. Always rendered as the page's single <h1>. */
  title: string;
  /** One line explaining what the screen is for. Optional. */
  subtitle?: string;
  /** Renders the standard back control when the screen is a sub-page. */
  onBack?: () => void;
  /** What the back control returns to, e.g. "Shows". */
  backLabel?: string;
  /** Primary/secondary controls for this screen, right-aligned next to the title. */
  actions?: React.ReactNode;
}

/**
 * The one page header every screen uses. Before this, each screen invented its
 * own arrangement of back button, title, and actions (and the shows list had no
 * title at all on phones), so moving between screens felt like moving between
 * different apps. Keeping the chrome identical is what makes the app feel
 * familiar — you always know where you are and where "back" is.
 */
export function PageHeader({ title, subtitle, onBack, backLabel = 'Back', actions }: PageHeaderProps) {
  return (
    <header className="page-header">
      {onBack && (
        <button type="button" className="page-header__back" onClick={onBack}>
          <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16" aria-hidden="true">
            <path
              fillRule="evenodd"
              d="M12.707 4.293a1 1 0 010 1.414L8.414 10l4.293 4.293a1 1 0 01-1.414 1.414l-5-5a1 1 0 010-1.414l5-5a1 1 0 011.414 0z"
              clipRule="evenodd"
            />
          </svg>
          <span>{backLabel}</span>
        </button>
      )}
      <div className="page-header__row">
        <h1 className="page-header__title">{title}</h1>
        {actions && <div className="page-header__actions">{actions}</div>}
      </div>
      {subtitle && <p className="page-header__subtitle">{subtitle}</p>}
    </header>
  );
}

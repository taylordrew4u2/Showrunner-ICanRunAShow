import './DeadlineIndicator.css';

interface DeadlineIndicatorProps {
  deadline?: string; // ISO date string
  compact?: boolean;
}

export function DeadlineIndicator({ deadline, compact = false }: DeadlineIndicatorProps) {
  if (!deadline) return null;

  const deadlineDate = new Date(deadline);
  const now = new Date();
  const diffTime = deadlineDate.getTime() - now.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  let status: 'passed' | 'urgent' | 'soon' | 'ok' = 'ok';
  let label = '';
  let icon = '📅';

  if (diffDays < 0) {
    status = 'passed';
    label = `${Math.abs(diffDays)} day${Math.abs(diffDays) === 1 ? '' : 's'} overdue`;
    icon = '⚠️';
  } else if (diffDays === 0) {
    status = 'urgent';
    label = 'Due today';
    icon = '🔴';
  } else if (diffDays <= 3) {
    status = 'urgent';
    label = `${diffDays} day${diffDays === 1 ? '' : 's'} left`;
    icon = '🔴';
  } else if (diffDays <= 7) {
    status = 'soon';
    label = `${diffDays} days left`;
    icon = '🟡';
  } else {
    status = 'ok';
    label = deadlineDate.toLocaleDateString();
    icon = '📅';
  }

  if (compact) {
    return (
      <span className={`deadline-indicator deadline-indicator--compact deadline-indicator--${status}`}>
        <span className="deadline-indicator__icon">{icon}</span>
        {!compact && <span className="deadline-indicator__label">{label}</span>}
      </span>
    );
  }

  return (
    <div className={`deadline-indicator deadline-indicator--${status}`}>
      <span className="deadline-indicator__icon">{icon}</span>
      <span className="deadline-indicator__label">{label}</span>
    </div>
  );
}

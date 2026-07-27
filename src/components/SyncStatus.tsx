import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import { lastSavedSentence } from '../utils/relativeTime';
import './SyncStatus.css';

/**
 * Where the user's work currently lives.
 *
 * - `saving`   — a save is in flight
 * - `saved`    — everything is on the server, encrypted
 * - `retrying` — the last save failed; a local copy is held and we're retrying
 * - `offline`  — no connection; a local copy is held and will sync on reconnect
 * - `blocked`  — the save can never succeed as-is and needs the user to act
 */
export type SyncState = 'saving' | 'saved' | 'retrying' | 'offline' | 'blocked';

interface SyncStatusProps {
  state: SyncState;
  /** Epoch ms of the last confirmed save, or null if nothing has synced yet. */
  lastSavedAt: number | null;
  /** True while unsent edits are parked in this device's local backup. */
  hasLocalCopy: boolean;
  /** ISO date of the last downloaded backup file, or null if never. */
  lastBackupAt: string | null;
  onDownloadBackup?: () => void | Promise<void>;
}

const PILL: Record<SyncState, { label: string; headline: string; detail: string }> = {
  saving: {
    label: 'Saving',
    headline: 'Saving your changes',
    detail: 'Encrypting on this device, then storing it in your account.',
  },
  saved: {
    label: 'Saved',
    headline: 'Everything is saved',
    detail: 'Every change is encrypted here and stored in your account automatically.',
  },
  retrying: {
    label: 'Holding',
    headline: 'Held safely on this device',
    detail:
      "We couldn't reach your account, so your latest work is being kept here and re-sent automatically. Nothing is lost — you can close the app.",
  },
  offline: {
    label: 'Offline',
    headline: "You're offline — nothing is lost",
    detail:
      'Your latest work is kept on this device and syncs the moment you have a connection. Keep working.',
  },
  blocked: {
    label: 'Needs you',
    headline: 'One change needs your attention',
    detail: 'Your existing work is still saved. The banner above says what to fix.',
  },
};

/**
 * The always-on answer to "is my work safe?".
 *
 * The app already retried failed saves, kept local backups, and encrypted
 * everything client-side — but none of that was visible, so using it felt like
 * typing into a void. This surfaces the guarantees that were always there: a
 * quiet pill on every screen, and a panel that says exactly where the work is.
 */
export function SyncStatus({
  state,
  lastSavedAt,
  hasLocalCopy,
  lastBackupAt,
  onDownloadBackup,
}: SyncStatusProps) {
  const [open, setOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);
  // Re-render on a slow tick so "just now" ages into "4 min ago" on its own.
  const [, setTick] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  // Close on outside click / Escape, like any other transient surface.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent | TouchEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const copy = PILL[state];
  const savedLabel = lastSavedSentence(lastSavedAt);

  async function handleDownload() {
    if (!onDownloadBackup || downloading) return;
    setDownloading(true);
    try {
      await onDownloadBackup();
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className={`sync-status sync-status--${state}`} ref={rootRef}>
      <button
        type="button"
        className="sync-status__pill"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`${copy.headline}. ${savedLabel} Open data safety details.`}
      >
        <span className="sync-status__dot" aria-hidden="true" />
        <span className="sync-status__label">{copy.label}</span>
      </button>

      {open && (
        <div className="sync-status__panel" role="dialog" aria-label="Where your work is stored">
          <div className="sync-status__panel-head">
            <span className="sync-status__dot sync-status__dot--lg" aria-hidden="true" />
            <div>
              <p className="sync-status__headline">{copy.headline}</p>
              <p className="sync-status__detail">{copy.detail}</p>
            </div>
          </div>

          <ul className="sync-status__facts">
            <li className="sync-status__fact">
              <Icon name="lock" size={15} aria-hidden />
              <div>
                <strong>Encrypted before it leaves this device</strong>
                <span>
                  Your password is the key, and it never leaves your phone or computer. Nobody
                  else can read your shows.
                </span>
              </div>
            </li>
            <li className="sync-status__fact">
              <Icon name="cloud" size={15} aria-hidden />
              <div>
                <strong>Stored in your account</strong>
                <span>
                  {savedLabel} Saves happen on their own as you work — there is no save button to
                  forget.
                </span>
              </div>
            </li>
            <li className="sync-status__fact">
              <Icon name="shield" size={15} aria-hidden />
              <div>
                <strong>{hasLocalCopy ? 'Spare copy held on this device' : 'Safety net on this device'}</strong>
                <span>
                  {hasLocalCopy
                    ? 'Unsent edits are stored here too. Close the app, lose signal, crash the browser — they come back and re-send on your next visit.'
                    : 'If a save ever fails, your edits are parked on this device and re-sent automatically. Closing the app cannot lose them.'}
                </span>
              </div>
            </li>
            <li className="sync-status__fact">
              <Icon name="download" size={15} aria-hidden />
              <div>
                <strong>Your own copy</strong>
                <span>
                  {lastBackupAt
                    ? `Last backup downloaded ${new Date(lastBackupAt).toLocaleDateString(undefined, {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })}.`
                    : "You haven't downloaded a backup file yet."}{' '}
                  A backup is a plain file you keep — readable without this app.
                </span>
              </div>
            </li>
          </ul>

          {onDownloadBackup && (
            <button
              type="button"
              className="btn btn--secondary btn--sm sync-status__backup-btn"
              onClick={handleDownload}
              disabled={downloading}
            >
              {downloading ? 'Preparing…' : 'Download a backup'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

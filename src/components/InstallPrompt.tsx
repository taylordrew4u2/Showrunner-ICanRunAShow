import { useEffect, useState } from 'react';
import { isIOS, isMobile, isStandalone } from '../utils/installPrompt';
import './InstallPrompt.css';

const DISMISSED_KEY = 'showrunner:installPromptDismissed';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/**
 * Nudges mobile-browser visitors to install the PWA, where it runs full-screen
 * with no address bar — the actual "native app" experience. Android gets the
 * real one-tap install prompt; iOS Safari has no such API, so it gets the
 * manual Share -> Add to Home Screen instructions instead.
 */
export function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIOSHint, setShowIOSHint] = useState(false);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISSED_KEY) === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (isStandalone() || !isMobile() || dismissed) return;

    if (isIOS()) {
      setShowIOSHint(true);
      return;
    }

    function onBeforeInstallPrompt(e: Event) {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
  }, [dismissed]);

  function dismiss() {
    setDismissed(true);
    setDeferredPrompt(null);
    setShowIOSHint(false);
    try {
      localStorage.setItem(DISMISSED_KEY, '1');
    } catch {
      /* ignore */
    }
  }

  async function install() {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    setDeferredPrompt(null);
  }

  if (dismissed || (!deferredPrompt && !showIOSHint)) return null;

  return (
    <div className="install-prompt" role="status">
      {deferredPrompt ? (
        <>
          <span className="install-prompt__text">Install I Can Run A Show for the full app experience — no browser bar, works offline.</span>
          <div className="install-prompt__actions">
            <button className="btn btn--primary btn--sm" onClick={install}>Install</button>
            <button className="install-prompt__close" onClick={dismiss} aria-label="Dismiss">×</button>
          </div>
        </>
      ) : (
        <>
          <span className="install-prompt__text">
            Add this to your home screen for the full app experience: tap <strong>Share</strong>, then <strong>Add to Home Screen</strong>.
          </span>
          <button className="install-prompt__close" onClick={dismiss} aria-label="Dismiss">×</button>
        </>
      )}
    </div>
  );
}

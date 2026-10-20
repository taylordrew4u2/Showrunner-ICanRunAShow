import { useEffect, useState } from 'react';
import {
  dismissInstallPrompt,
  heldInstallPrompt,
  installPromptDismissed,
  isIOS,
  isMobile,
  isStandalone,
  onInstallPrompt,
  releaseInstallPrompt,
  type BeforeInstallPromptEvent,
} from '../utils/installPrompt';
import './InstallPrompt.css';

/**
 * Nudges mobile-browser visitors to install the PWA, where it runs full-screen
 * with no address bar — the actual "native app" experience. Android gets the
 * real one-tap install prompt; iOS Safari has no such API, so it gets the
 * manual Share -> Add to Home Screen instructions instead.
 */
interface InstallPromptProps {
  /**
   * Called whenever the prompt appears or goes away. The page above it has a
   * banner of its own, and two "not now" rows stacked over your shows is one
   * more than a phone can spare — so the page uses this to hold its own back
   * until this one is gone.
   */
  onShownChange?: (shown: boolean) => void;
}

export function InstallPrompt({ onShownChange }: InstallPromptProps = {}) {
  // Chrome's offer is held from boot (see holdInstallPrompt), because it is
  // usually made before this banner exists; one made later is passed on.
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(heldInstallPrompt);
  const [dismissed, setDismissed] = useState(installPromptDismissed);
  // Computed once at mount (not in an effect) — iOS has no install event to
  // listen for, so there's no external state to synchronize here.
  const [showIOSHint] = useState(() => !isStandalone() && isMobile() && isIOS());

  useEffect(() => {
    if (dismissed) return;
    return onInstallPrompt(setDeferredPrompt);
  }, [dismissed]);

  function dismiss() {
    setDismissed(true);
    setDeferredPrompt(null);
    dismissInstallPrompt();
  }

  async function install() {
    if (!deferredPrompt) return;
    releaseInstallPrompt();
    await deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    setDeferredPrompt(null);
  }

  const shown = !dismissed && (!!deferredPrompt || showIOSHint);

  useEffect(() => {
    onShownChange?.(shown);
  }, [shown, onShownChange]);

  if (!shown) return null;

  return (
    <div className="install-prompt" role="status">
      {deferredPrompt ? (
        <>
          {/* Short enough to hold one line on a phone. The long version wrapped
              to three, which is a lot of screen to spend asking. */}
          <span className="install-prompt__text">Install the app — no browser bar, works offline.</span>
          <div className="install-prompt__actions">
            <button className="btn btn--primary btn--sm" onClick={install}>Install</button>
            <button className="install-prompt__close" onClick={dismiss} aria-label="Dismiss">×</button>
          </div>
        </>
      ) : (
        <>
          <span className="install-prompt__text">
            Tap <strong>Share</strong>, then <strong>Add to Home Screen</strong>.
          </span>
          <button className="install-prompt__close" onClick={dismiss} aria-label="Dismiss">×</button>
        </>
      )}
    </div>
  );
}

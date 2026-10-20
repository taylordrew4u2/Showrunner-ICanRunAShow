/**
 * Calls back each time the producer comes back to this page after being away
 * from it: the iOS app brought to the front again, the tab shown again, the
 * window given focus back. Returns the unsubscribe.
 *
 * Coming back usually says so twice, once as the page showing and once as the
 * window focusing, so it's counted from leaving instead: one call per return,
 * however many events announce it.
 */
export function onPageReturn(callback: () => void): () => void {
  let away = document.visibilityState !== 'visible';
  function leave() {
    away = true;
  }
  function back() {
    if (!away || document.visibilityState !== 'visible') return;
    away = false;
    callback();
  }
  function onVisibility() {
    if (document.visibilityState === 'visible') back();
    else leave();
  }
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('blur', leave);
  window.addEventListener('focus', back);
  return () => {
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('blur', leave);
    window.removeEventListener('focus', back);
  };
}

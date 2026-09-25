/**
 * Making room under the status rail.
 *
 * The rail is fixed to the top of the window and the page keeps a band of
 * padding clear for it — but the band was a constant sized for the sync pill
 * alone. A notice in the rail ("Couldn't load your shows…", a save conflict)
 * is a couple of hundred pixels on a phone, and every one of them sat on top
 * of the page: the show's Back control, its name, Run Show and the workspace
 * tabs were all under the notice and untappable until the producer found the
 * × in its corner. So the rail's real height is measured and handed to the
 * stylesheet, which adds whatever the notices take to the band.
 */

/** The CSS custom property the stylesheet adds to the band. */
export const NOTICES_PROPERTY = '--status-notices';

/**
 * How much of the rail is notices: everything above the pill row, less the
 * safe-area padding the page already allows for on its own. Never negative —
 * a rail hidden behind a dialog measures zero and must not pull the page up.
 */
export function noticesHeight(railHeight: number, pillRowHeight: number, safeAreaTop: number): number {
  return Math.max(0, Math.round(railHeight - pillRowHeight - safeAreaTop));
}

/**
 * Watch the rail and keep the stylesheet told. Returns the way to stop
 * watching, which also clears the property so the defaults return.
 */
export function watchStatusRail(rail: HTMLElement, root: HTMLElement = document.documentElement): () => void {
  const measure = () => {
    const pill = rail.querySelector<HTMLElement>('.status-rail__pill-row');
    const inset = parseFloat(getComputedStyle(rail).paddingTop) || 0;
    const notices = noticesHeight(
      rail.getBoundingClientRect().height,
      pill?.getBoundingClientRect().height ?? 0,
      inset,
    );
    root.style.setProperty(NOTICES_PROPERTY, `${notices}px`);
  };
  measure();
  // Older browsers without ResizeObserver keep the constant band; the page
  // still works, the notice just covers it as before.
  const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
  observer?.observe(rail);
  return () => {
    observer?.disconnect();
    root.style.removeProperty(NOTICES_PROPERTY);
  };
}

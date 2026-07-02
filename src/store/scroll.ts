// ============================================================================
// Scroll positions
//
// Most views keep their scroll position natively: they stay mounted (with
// `display` toggled) when the user switches tabs, so the DOM preserves each
// view's scrollTop. The browser view is the exception — a single mounted
// instance is reused across folder navigation, so we save/restore its scroll
// position per folder path.
//
// These are written eagerly as the user scrolls but only read imperatively on
// folder change, so they live in a plain module-level store rather than the
// reactive app state. Keeping them out of the Zustand store makes "update
// without re-rendering" explicit and avoids the tearing risk of mutating the
// store snapshot without notifying listeners.
// ============================================================================

/** Browser view scroll positions, keyed by path */
const browserPositions = new Map<string, number>();

/**
 * Set scroll position for the browser view at a specific path
 */
export function setBrowserScrollPosition(path: string, position: number): void {
  browserPositions.set(path, position);
}

/**
 * Get scroll position for the browser view at a specific path
 */
export function getBrowserScrollPosition(path: string): number {
  return browserPositions.get(path) ?? 0;
}

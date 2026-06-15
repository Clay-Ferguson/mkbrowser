// ============================================================================
// Scroll positions
//
// These are written eagerly as the user scrolls but only read imperatively on
// mount, so they live in a plain module-level store rather than the reactive
// app state. Keeping them out of `useSyncExternalStore` makes "update without
// re-rendering" explicit and avoids the tearing risk of mutating the store
// snapshot without notifying listeners.
// ============================================================================

/** Browser view scroll positions, keyed by path */
const browserPositions = new Map<string, number>();

/** Single-instance view scroll positions */
const viewPositions = {
  'search-results': 0,
  settings: 0,
  'folder-analysis': 0,
  'ai-settings': 0,
  thread: 0,
};

type ViewScrollKey = keyof typeof viewPositions;

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

/**
 * Set scroll position for the search-results view
 */
export function setSearchResultsScrollPosition(position: number): void {
  setViewScrollPosition('search-results', position);
}

/**
 * Get scroll position for the search-results view
 */
export function getSearchResultsScrollPosition(): number {
  return viewPositions['search-results'];
}

/**
 * Set scroll position for the settings view
 */
export function setSettingsScrollPosition(position: number): void {
  setViewScrollPosition('settings', position);
}

/**
 * Get scroll position for the settings view
 */
export function getSettingsScrollPosition(): number {
  return viewPositions.settings;
}

/**
 * Set scroll position for the folder analysis view
 */
export function setFolderAnalysisScrollPosition(position: number): void {
  setViewScrollPosition('folder-analysis', position);
}

/**
 * Get scroll position for the folder analysis view
 */
export function getFolderAnalysisScrollPosition(): number {
  return viewPositions['folder-analysis'];
}

/**
 * Set scroll position for the AI settings view
 */
export function setAiSettingsScrollPosition(position: number): void {
  setViewScrollPosition('ai-settings', position);
}

/**
 * Get scroll position for the AI settings view
 */
export function getAiSettingsScrollPosition(): number {
  return viewPositions['ai-settings'];
}

/**
 * Set scroll position for the thread view
 */
export function setThreadScrollPosition(position: number): void {
  setViewScrollPosition('thread', position);
}

/**
 * Get scroll position for the thread view
 */
export function getThreadScrollPosition(): number {
  return viewPositions.thread;
}

function setViewScrollPosition(key: ViewScrollKey, position: number): void {
  viewPositions[key] = position;
}

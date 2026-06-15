import type { ScrollPositions } from '../types/types';
import { getState, setStateSilent, useStoreValue } from './core';

// ============================================================================
// Scroll positions
//
// These are written eagerly as the user scrolls but only read on mount, so the
// setters use `setStateSilent` to update the snapshot without forcing a
// re-render of every subscriber.
// ============================================================================

/**
 * Set scroll position for the browser view at a specific path
 */
export function setBrowserScrollPosition(path: string, position: number): void {
  const scrollPositions = getState().scrollPositions;
  const newBrowserPositions = new Map(scrollPositions.browser);
  newBrowserPositions.set(path, position);
  setStateSilent({ scrollPositions: { ...scrollPositions, browser: newBrowserPositions } });
}

/**
 * Get scroll position for the browser view at a specific path
 */
export function getBrowserScrollPosition(path: string): number {
  return getState().scrollPositions.browser.get(path) ?? 0;
}

/**
 * Set scroll position for the search-results view
 */
export function setSearchResultsScrollPosition(position: number): void {
  setStateSilent({ scrollPositions: { ...getState().scrollPositions, 'search-results': position } });
}

/**
 * Get scroll position for the search-results view
 */
export function getSearchResultsScrollPosition(): number {
  return getState().scrollPositions['search-results'];
}

/**
 * Set scroll position for the settings view
 */
export function setSettingsScrollPosition(position: number): void {
  setStateSilent({ scrollPositions: { ...getState().scrollPositions, settings: position } });
}

/**
 * Get scroll position for the settings view
 */
export function getSettingsScrollPosition(): number {
  return getState().scrollPositions.settings;
}

/**
 * Set scroll position for the folder analysis view
 */
export function setFolderAnalysisScrollPosition(position: number): void {
  setStateSilent({ scrollPositions: { ...getState().scrollPositions, 'folder-analysis': position } });
}

/**
 * Get scroll position for the folder analysis view
 */
export function getFolderAnalysisScrollPosition(): number {
  return getState().scrollPositions['folder-analysis'];
}

/**
 * Set scroll position for the AI settings view
 */
export function setAiSettingsScrollPosition(position: number): void {
  setStateSilent({ scrollPositions: { ...getState().scrollPositions, 'ai-settings': position } });
}

/**
 * Get scroll position for the AI settings view
 */
export function getAiSettingsScrollPosition(): number {
  return getState().scrollPositions['ai-settings'];
}

/**
 * Set scroll position for the thread view
 */
export function setThreadScrollPosition(position: number): void {
  setStateSilent({ scrollPositions: { ...getState().scrollPositions, thread: position } });
}

/**
 * Get scroll position for the thread view
 */
export function getThreadScrollPosition(): number {
  return getState().scrollPositions.thread;
}

/**
 * Hook to subscribe to scroll positions
 */
export function useScrollPositions(): ScrollPositions {
  return useStoreValue(s => s.scrollPositions);
}

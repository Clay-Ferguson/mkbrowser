import type { AppState, AppView, FolderAnalysisState, FolderGraphState } from '../types/types';
import { getState, setState, useStoreValue } from './core';

// ============================================================================
// View / navigation - current view & path, pending scroll/edit signals,
// tabs, root path, folder analysis/graph, and other top-level UI flags.
// ============================================================================

/**
 * Set the current view
 */
export function setCurrentView(view: AppView): void {
  if (getState().currentView === view) return;
  setState({ currentView: view });
}

/**
 * Set the current path being browsed
 */
export function setCurrentPath(path: string): void {
  if (getState().currentPath === path) return;
  setState({ currentPath: path });
}

/**
 * Navigate to a path and switch to browser view in a single state update.
 * Optionally set a file to scroll to after render completes.
 *
 * Optionally accepts a 'view' parameter to specify which view to navigate to (default is 'browser').
 */
export function navigateToBrowserPath(path: string, scrollToFile?: string, view: AppView = 'browser'): void {
  const newState: Partial<AppState> = {
    currentPath: path,
    currentView: view,
  };
  if (scrollToFile !== undefined) {
    newState.pendingScrollToFile = scrollToFile;
  }
  setState(newState);
}

/**
 * Clear the pending scroll to file (call after scrolling completes)
 */
export function clearPendingScrollToFile(): void {
  if (getState().pendingScrollToFile === null) return;
  setState({ pendingScrollToFile: null });
}

/**
 * Set a file to scroll into view after render completes
 */
export function setPendingScrollToFile(fileName: string): void {
  setState({ pendingScrollToFile: fileName });
}

export function setPendingScrollToHeadingSlug(slug: string): void {
  setState({ pendingScrollToHeadingSlug: slug });
}

export function clearPendingScrollToHeadingSlug(): void {
  if (getState().pendingScrollToHeadingSlug === null) return;
  setState({ pendingScrollToHeadingSlug: null });
}

/**
 * Set a file to start editing after navigation completes
 * @param filePath - The full path of the file to edit
 * @param lineNumber - Optional 1-based line number to scroll to
 */
export function setPendingEditFile(filePath: string, lineNumber?: number, view?: AppView): void {
  setState({ pendingEditFile: filePath, pendingEditLineNumber: lineNumber ?? null, pendingEditView: view ?? 'browser' });
}

/**
 * Clear the pending edit file and line number (call after editing starts)
 */
export function clearPendingEditFile(): void {
  const state = getState();
  if (state.pendingEditFile === null && state.pendingEditLineNumber === null && state.pendingEditView === null) return;
  setState({ pendingEditFile: null, pendingEditLineNumber: null, pendingEditView: null });
}

export function useDirectoryRefreshNonce(): number {
  return useStoreValue(s => s.directoryRefreshNonce);
}

/**
 * Ask BrowseView to reload the current directory even if currentPath hasn't changed.
 */
export function requestDirectoryRefresh(): void {
  setState({ directoryRefreshNonce: getState().directoryRefreshNonce + 1 });
}

/**
 * Request ThreadView to scroll to bottom after its next render.
 */
export function setPendingThreadScrollToBottom(): void {
  setState({ pendingThreadScrollToBottom: true });
}

/**
 * Clear the pending thread scroll-to-bottom flag (call after the scroll timer is created).
 */
export function clearPendingThreadScrollToBottom(): void {
  if (!getState().pendingThreadScrollToBottom) return;
  setState({ pendingThreadScrollToBottom: false });
}

/**
 * Set folder analysis results
 */
export function setFolderAnalysis(data: FolderAnalysisState | null): void {
  setState({ folderAnalysis: data });
}

/**
 * Set the folder graph data. Pass null to clear it.
 * Used both for the initial scan result and to overwrite when the user
 * re-launches the graph from the menu.
 */
export function setFolderGraph(data: FolderGraphState | null): void {
  setState({ folderGraph: data });
}

/**
 * Set the root folder path.
 */
export function setRootPath(path: string): void {
  if (getState().rootPath === path) return;
  setState({ rootPath: path });
}

/**
 * Check whether a tab is currently visible in the tab bar.
 */
export function isTabVisible(tab: AppView): boolean {
  return getState().visibleTabs.has(tab);
}

/**
 * Show a tab in the tab bar (adds it to visibleTabs).
 * Does not persist — resets on restart.
 */
export function showTab(tab: AppView): void {
  const visibleTabs = getState().visibleTabs;
  if (visibleTabs.has(tab)) return;
  const next = new Set(visibleTabs);
  next.add(tab);
  setState({ visibleTabs: next });
}

export function hideTab(tab: AppView): void {
  const visibleTabs = getState().visibleTabs;
  if (!visibleTabs.has(tab)) return;
  const next = new Set(visibleTabs);
  next.delete(tab);
  setState({ visibleTabs: next });
}

/**
 * Toggle the editor between its normal and expanded (full-width) layout.
 */
export function setExpandedEditor(expandedEditor: boolean): void {
  setState({ expandedEditor });
}

/**
 * Store the full paths captured by "Copy Link" for later "Paste Link".
 */
export function setSelectedLinkItems(paths: string[]): void {
  setState({ selectedLinkItems: paths });
}

// ============================================================================
// Hooks
// ============================================================================

/**
 * Hook to subscribe to the current view
 */
export function useCurrentView(): AppView {
  return useStoreValue(s => s.currentView);
}

/**
 * Hook to subscribe to the current path
 */
export function useCurrentPath(): string {
  return useStoreValue(s => s.currentPath);
}

/**
 * Hook to subscribe to pending scroll to file
 */
export function usePendingScrollToFile(): string | null {
  return useStoreValue(s => s.pendingScrollToFile);
}

export function usePendingScrollToHeadingSlug(): string | null {
  return useStoreValue(s => s.pendingScrollToHeadingSlug);
}

/**
 * Hook to subscribe to pending edit file path
 */
export function usePendingEditFile(): string | null {
  return useStoreValue(s => s.pendingEditFile);
}

/**
 * Hook to subscribe to pending edit line number
 */
export function usePendingEditLineNumber(): number | null {
  return useStoreValue(s => s.pendingEditLineNumber);
}

/**
 * Hook to subscribe to pending edit view
 */
export function usePendingEditView(): AppView | null {
  return useStoreValue(s => s.pendingEditView);
}

/**
 * Hook to subscribe to pendingThreadScrollToBottom
 */
export function usePendingThreadScrollToBottom(): boolean {
  return useStoreValue(s => s.pendingThreadScrollToBottom);
}

/**
 * Hook to subscribe to whether the editor is in its expanded layout.
 */
export function useExpandedEditor(): boolean {
  return useStoreValue(s => s.expandedEditor);
}

/**
 * Hook to subscribe to the paths captured by "Copy Link"
 */
export function useSelectedLinkItems(): string[] {
  return useStoreValue(s => s.selectedLinkItems);
}

/**
 * Hook to subscribe to folder analysis state
 */
export function useFolderAnalysis(): FolderAnalysisState | null {
  return useStoreValue(s => s.folderAnalysis);
}

/**
 * Hook to subscribe to folder graph state
 */
export function useFolderGraph(): FolderGraphState | null {
  return useStoreValue(s => s.folderGraph);
}

/**
 * Hook to subscribe to rootPath
 */
export function useRootPath(): string {
  return useStoreValue(s => s.rootPath);
}

/**
 * Hook to subscribe to visible tabs
 */
export function useVisibleTabs(): Set<AppView> {
  return useStoreValue(s => s.visibleTabs);
}

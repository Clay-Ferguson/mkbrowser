import type { AppState, AppView, FolderAnalysisState, FolderGraphState } from '../shared/types';
import { getState, useStoreValue } from './core';
import type { StoreSet, StoreGet } from './core';

// ============================================================================
// View / navigation - current view & path, pending scroll/edit signals,
// tabs, root path, folder analysis/graph, and other top-level UI flags.
// ============================================================================

/**
 * Actions owned by this slice. Composed into the single store's state type in
 * `core.ts` (Zustand slices pattern — see ZUSTAND_CONVERSION.md §2b).
 */
export interface ViewSlice {
  setCurrentView: (view: AppView) => void;
  setCurrentPath: (path: string) => void;
  navigateToBrowserPath: (path: string, scrollToFile?: string, view?: AppView) => void;
  clearPendingScrollToFile: () => void;
  setPendingScrollToFile: (fileName: string) => void;
  setPendingScrollToHeadingSlug: (slug: string) => void;
  clearPendingScrollToHeadingSlug: () => void;
  setPendingEditFile: (filePath: string, view?: AppView) => void;
  clearPendingEditFile: () => void;
  requestDirectoryRefresh: () => void;
  setPendingThreadScrollToBottom: () => void;
  clearPendingThreadScrollToBottom: () => void;
  setFolderAnalysis: (data: FolderAnalysisState | null) => void;
  setFolderGraph: (data: FolderGraphState | null) => void;
  setRootPath: (path: string) => void;
  showTab: (tab: AppView) => void;
  hideTab: (tab: AppView) => void;
  setExpandedEditor: (expandedEditor: boolean) => void;
  setSelectedLinkItems: (paths: string[]) => void;
}

/**
 * Slice creator called by `core.ts` inside `create()`. A function declaration
 * (not a `const`) so it is hoisted and safe under the core ↔ slice import
 * cycle regardless of module load order.
 */
export function createViewSlice(set: StoreSet, get: StoreGet): ViewSlice {
  return {
    /** Set the current view. */
    setCurrentView: (view) => {
      if (get().currentView === view) return;
      set({ currentView: view });
    },

    /** Set the current path being browsed. */
    setCurrentPath: (path) => {
      if (get().currentPath === path) return;
      set({ currentPath: path });
    },

    /**
     * Navigate to a path and switch to browser view in a single state update.
     * Optionally set a file to scroll to after render completes.
     *
     * Optionally accepts a 'view' parameter to specify which view to navigate
     * to (default is 'browser').
     */
    navigateToBrowserPath: (path, scrollToFile, view = 'browser') => {
      const newState: Partial<AppState> = {
        currentPath: path,
        currentView: view,
      };
      if (scrollToFile !== undefined) {
        newState.pendingScrollToFile = scrollToFile;
      }
      set(newState);
    },

    /** Clear the pending scroll to file (call after scrolling completes). */
    clearPendingScrollToFile: () => {
      if (get().pendingScrollToFile === null) return;
      set({ pendingScrollToFile: null });
    },

    /** Set a file to scroll into view after render completes. */
    setPendingScrollToFile: (fileName) => set({ pendingScrollToFile: fileName }),

    setPendingScrollToHeadingSlug: (slug) => set({ pendingScrollToHeadingSlug: slug }),

    clearPendingScrollToHeadingSlug: () => {
      if (get().pendingScrollToHeadingSlug === null) return;
      set({ pendingScrollToHeadingSlug: null });
    },

    /**
     * Set a file to start editing after navigation completes.
     * @param filePath - The full path of the file to edit
     * @param view - Which view should consume the pending edit (defaults to 'browser')
     */
    setPendingEditFile: (filePath, view) =>
      set({ pendingEditFile: filePath, pendingEditView: view ?? 'browser' }),

    /** Clear the pending edit file (call after editing starts). */
    clearPendingEditFile: () => {
      const state = get();
      if (state.pendingEditFile === null && state.pendingEditView === null) return;
      set({ pendingEditFile: null, pendingEditView: null });
    },

    /** Ask BrowseView to reload the current directory even if currentPath hasn't changed. */
    requestDirectoryRefresh: () =>
      set({ directoryRefreshNonce: get().directoryRefreshNonce + 1 }),

    /** Request ThreadView to scroll to bottom after its next render. */
    setPendingThreadScrollToBottom: () => set({ pendingThreadScrollToBottom: true }),

    /** Clear the pending thread scroll-to-bottom flag (call after the scroll timer is created). */
    clearPendingThreadScrollToBottom: () => {
      if (!get().pendingThreadScrollToBottom) return;
      set({ pendingThreadScrollToBottom: false });
    },

    /** Set folder analysis results. */
    setFolderAnalysis: (data) => set({ folderAnalysis: data }),

    /**
     * Set the folder graph data. Pass null to clear it.
     * Used both for the initial scan result and to overwrite when the user
     * re-launches the graph from the menu.
     */
    setFolderGraph: (data) => set({ folderGraph: data }),

    /** Set the root folder path. */
    setRootPath: (path) => {
      if (get().rootPath === path) return;
      set({ rootPath: path });
    },

    /**
     * Show a tab in the tab bar (adds it to visibleTabs).
     * Does not persist — resets on restart.
     */
    showTab: (tab) => {
      const visibleTabs = get().visibleTabs;
      if (visibleTabs.has(tab)) return;
      const next = new Set(visibleTabs);
      next.add(tab);
      set({ visibleTabs: next });
    },

    hideTab: (tab) => {
      const visibleTabs = get().visibleTabs;
      if (!visibleTabs.has(tab)) return;
      const next = new Set(visibleTabs);
      next.delete(tab);
      set({ visibleTabs: next });
    },

    /** Toggle the editor between its normal and expanded (full-width) layout. */
    setExpandedEditor: (expandedEditor) => set({ expandedEditor }),

    /** Store the full paths captured by "Copy Link" for later "Paste Link". */
    setSelectedLinkItems: (paths) => set({ selectedLinkItems: paths }),
  };
}

// Thin non-hook wrappers so the barrel API (and every caller) is unchanged;
// they delegate to the actions living inside the store.

export function setCurrentView(view: AppView): void {
  getState().setCurrentView(view);
}

export function setCurrentPath(path: string): void {
  getState().setCurrentPath(path);
}

export function navigateToBrowserPath(path: string, scrollToFile?: string, view: AppView = 'browser'): void {
  getState().navigateToBrowserPath(path, scrollToFile, view);
}

export function clearPendingScrollToFile(): void {
  getState().clearPendingScrollToFile();
}

export function setPendingScrollToFile(fileName: string): void {
  getState().setPendingScrollToFile(fileName);
}

export function setPendingScrollToHeadingSlug(slug: string): void {
  getState().setPendingScrollToHeadingSlug(slug);
}

export function clearPendingScrollToHeadingSlug(): void {
  getState().clearPendingScrollToHeadingSlug();
}

export function setPendingEditFile(filePath: string, view?: AppView): void {
  getState().setPendingEditFile(filePath, view);
}

export function clearPendingEditFile(): void {
  getState().clearPendingEditFile();
}

export function requestDirectoryRefresh(): void {
  getState().requestDirectoryRefresh();
}

export function setPendingThreadScrollToBottom(): void {
  getState().setPendingThreadScrollToBottom();
}

export function clearPendingThreadScrollToBottom(): void {
  getState().clearPendingThreadScrollToBottom();
}

export function setFolderAnalysis(data: FolderAnalysisState | null): void {
  getState().setFolderAnalysis(data);
}

export function setFolderGraph(data: FolderGraphState | null): void {
  getState().setFolderGraph(data);
}

export function setRootPath(path: string): void {
  getState().setRootPath(path);
}

/**
 * Check whether a tab is currently visible in the tab bar.
 */
export function isTabVisible(tab: AppView): boolean {
  return getState().visibleTabs.has(tab);
}

export function showTab(tab: AppView): void {
  getState().showTab(tab);
}

export function hideTab(tab: AppView): void {
  getState().hideTab(tab);
}

export function setExpandedEditor(expandedEditor: boolean): void {
  getState().setExpandedEditor(expandedEditor);
}

export function setSelectedLinkItems(paths: string[]): void {
  getState().setSelectedLinkItems(paths);
}

// ============================================================================
// Hooks
// ============================================================================

export function useDirectoryRefreshNonce(): number {
  return useStoreValue(s => s.directoryRefreshNonce);
}

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

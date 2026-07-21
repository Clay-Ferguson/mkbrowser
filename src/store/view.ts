import type { AppState, AppView, FolderAnalysisState, FolderGraphState } from '../shared/types';
import { getState } from './core';
import type { StoreSet, StoreGet } from './core';
import { withSelectionsCleared } from './items';

// ============================================================================
// View / navigation - current view & path, pending scroll/edit signals,
// tabs, root path, folder analysis/graph, and other top-level UI flags.
// ============================================================================

/**
 * Actions owned by this slice. Composed into the single store's state type in
 * `core.ts`.
 */
export interface ViewSlice {
  setCurrentView: (view: AppView) => void;
  setCurrentPath: (path: string) => void;
  navigateToBrowserPath: (path: string, scrollToFile?: string, view?: AppView) => void;
  setBrowseFile: (folderPath: string, fileName: string) => void;
  clearBrowseFile: () => void;
  clearPendingScrollToFile: () => void;
  setPendingScrollToFile: (fileName: string) => void;
  setPendingScrollToHeadingSlug: (slug: string) => void;
  clearPendingScrollToHeadingSlug: () => void;
  setPendingEditFile: (filePath: string, view?: AppView) => void;
  clearPendingEditFile: () => void;
  setPendingExpandFile: (filePath: string) => void;
  clearPendingExpandFile: () => void;
  requestDirectoryRefresh: () => void;
  setPendingThreadScrollToBottom: () => void;
  clearPendingThreadScrollToBottom: () => void;
  setFolderAnalysis: (data: FolderAnalysisState | null) => void;
  setFolderGraph: (data: FolderGraphState | null) => void;
  setRootPath: (path: string) => void;
  showTab: (tab: AppView) => void;
  hideTab: (tab: AppView) => void;
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

    /** Set the current path being browsed. Navigating to a different folder
     * also clears item selections and exits single-file browsing, atomically
     * with the path change. */
    setCurrentPath: (path) => {
      if (get().currentPath === path) {
        // Same folder, so nothing to navigate — but while browsing a single
        // file this still means "show me this folder's listing", and it is the
        // common case: the breadcrumb's last segment IS the folder holding the
        // browsed file, so without this a breadcrumb click would do nothing.
        get().clearBrowseFile();
        return;
      }
      // browseFileName names a file inside currentPath, so it cannot survive a
      // path change — clearing it here is also what makes breadcrumb clicks
      // drop back to the folder listing without any extra wiring.
      const newState: Partial<AppState> = { currentPath: path, browseFileName: null };
      const clearedItems = withSelectionsCleared(get().items);
      if (clearedItems) {
        newState.items = clearedItems;
      }
      set(newState);
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
        // Every caller of this means "show me the folder listing" (optionally
        // scrolled to a file), so it always exits single-file browsing —
        // unconditionally, since re-navigating to the folder you are already
        // in is exactly what the tree's "Browse" item does to get back.
        browseFileName: null,
      };
      if (scrollToFile !== undefined) {
        newState.pendingScrollToFile = scrollToFile;
      }
      // Navigating to a different folder also clears item selections,
      // atomically with the path change.
      if (path !== get().currentPath) {
        const clearedItems = withSelectionsCleared(get().items);
        if (clearedItems) {
          newState.items = clearedItems;
        }
      }
      set(newState);
    },

    /**
     * Display a single file on its own, in place of the folder listing, in one
     * state update: the file's folder becomes `currentPath` (so PathBreadcrumb
     * keeps working unchanged) and `browseFileName` records which file.
     *
     * Note this sets `currentPath` directly rather than delegating to
     * `setCurrentPath`, which would clear `browseFileName` right back out.
     */
    setBrowseFile: (folderPath, fileName) => {
      const newState: Partial<AppState> = {
        currentPath: folderPath,
        currentView: 'browser',
        browseFileName: fileName,
      };
      if (folderPath !== get().currentPath) {
        const clearedItems = withSelectionsCleared(get().items);
        if (clearedItems) {
          newState.items = clearedItems;
        }
      }
      set(newState);
    },

    /** Exit single-file browsing and return to the folder listing. */
    clearBrowseFile: () => {
      if (get().browseFileName === null) return;
      set({ browseFileName: null });
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

    /**
     * Set a file to expand once the directory refresh that creates it has rendered it.
     * @param filePath - The full path of the file to expand
     */
    setPendingExpandFile: (filePath) => set({ pendingExpandFile: filePath }),

    /** Clear the pending expand file (call after the item has been expanded). */
    clearPendingExpandFile: () => {
      if (get().pendingExpandFile === null) return;
      set({ pendingExpandFile: null });
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

export function setBrowseFile(folderPath: string, fileName: string): void {
  getState().setBrowseFile(folderPath, fileName);
}

export function clearBrowseFile(): void {
  getState().clearBrowseFile();
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

export function setPendingExpandFile(filePath: string): void {
  getState().setPendingExpandFile(filePath);
}

export function clearPendingExpandFile(): void {
  getState().clearPendingExpandFile();
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

export function setSelectedLinkItems(paths: string[]): void {
  getState().setSelectedLinkItems(paths);
}

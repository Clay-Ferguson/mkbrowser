import { useSyncExternalStore } from 'react';
import type { AppState, AppView, AppSettings, FontSize, SortOrder, ContentWidth, ItemData, SearchResultItem, SearchSortBy, SearchSortDirection, ScrollPositions, FolderAnalysisState } from './types';
import { createItemData } from './types';

/**
 * Default settings
 */
const defaultSettings: AppSettings = {
  fontSize: 'medium',
  sortOrder: 'alphabetical',
  foldersOnTop: true,
  ignoredPaths: '',
  searchDefinitions: [],
  contentWidth: 'medium',
  bookmarks: [],
};

/**
 * Initial state
 */
const initialState: AppState = {
  items: new Map(),
  currentPath: '',
  currentView: 'browser', // browser | search-results | settings
  pendingScrollToFile: null,
  searchQuery: '',
  searchFolder: '',
  searchResults: [],
  searchSortBy: 'modified-time',
  searchSortDirection: 'desc',
  settings: defaultSettings,
  highlightItem: null,
  pendingEditFile: null,
  pendingEditLineNumber: null,
  scrollPositions: {
    browser: new Map(),
    'search-results': 0,
    settings: 0,
    'folder-analysis': 0,
  },
  highlightedSearchResult: null,
  folderAnalysis: null,
};

/**
 * Current state (mutable reference)
 */
let state: AppState = initialState;

/**
 * Set of listener functions to notify on state changes
 */
const listeners = new Set<() => void>();

/**
 * Notify all listeners that state has changed
 */
function emitChange(): void {
  for (const listener of listeners) {
    listener();
  }
}

/**
 * Subscribe to state changes
 */
function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Get current snapshot of the entire state
 */
function getSnapshot(): AppState {
  return state;
}

/**
 * Get snapshot of just the items Map
 */
function getItemsSnapshot(): Map<string, ItemData> {
  return state.items;
}

/**
 * Get snapshot of the current view
 */
function getCurrentViewSnapshot(): AppView {
  return state.currentView;
}

/**
 * Get snapshot of the current path
 */
function getCurrentPathSnapshot(): string {
  return state.currentPath;
}

/**
 * Get snapshot of the pending scroll to file
 */
function getPendingScrollToFileSnapshot(): string | null {
  return state.pendingScrollToFile;
}

/**
 * Get snapshot of search results
 */
function getSearchResultsSnapshot(): SearchResultItem[] {
  return state.searchResults;
}

/**
 * Get snapshot of search query
 */
function getSearchQuerySnapshot(): string {
  return state.searchQuery;
}

/**
 * Get snapshot of search folder
 */
function getSearchFolderSnapshot(): string {
  return state.searchFolder;
}

/**
 * Get snapshot of search sort by
 */
function getSearchSortBySnapshot(): SearchSortBy {
  return state.searchSortBy;
}

/**
 * Get snapshot of search sort direction
 */
function getSearchSortDirectionSnapshot(): SearchSortDirection {
  return state.searchSortDirection;
}

/**
 * Get snapshot of settings
 */
function getSettingsSnapshot(): AppSettings {
  return state.settings;
}

/**
 * Get snapshot of highlighted item name
 */
function getHighlightItemSnapshot(): string | null {
  return state.highlightItem;
}

/**
 * Get snapshot of pending edit file path
 */
function getPendingEditFileSnapshot(): string | null {
  return state.pendingEditFile;
}

/**
 * Get snapshot of pending edit line number
 */
function getPendingEditLineNumberSnapshot(): number | null {
  return state.pendingEditLineNumber;
}

/**
 * Get snapshot of scroll positions
 */
function getScrollPositionsSnapshot(): ScrollPositions {
  return state.scrollPositions;
}

/**
 * Get snapshot of highlighted search result
 */
function getHighlightedSearchResultSnapshot(): { path: string; lineNumber?: number } | null {
  return state.highlightedSearchResult;
}

/**
 * Get snapshot of folder analysis state
 */
function getFolderAnalysisSnapshot(): FolderAnalysisState | null {
  return state.folderAnalysis;
}

// ============================================================================
// Actions - functions that modify the store
// ============================================================================

/**
 * Add or update an item in the store.
 * If the item already exists and its modifiedTime hasn't changed,
 * preserves the existing cached content.
 */
export function upsertItem(
  path: string,
  name: string,
  isDirectory: boolean,
  modifiedTime: number,
  createdTime: number = modifiedTime
): void {
  const existing = state.items.get(path);

  // Create new Map to ensure React detects the change
  const newItems = new Map(state.items);

  if (existing) {
    // Item exists - update it, preserving content if modifiedTime unchanged
    const updatedItem: ItemData = {
      ...existing,
      name,
      isDirectory,
      modifiedTime,
      createdTime,
    };

    // If the file has been modified since we cached content, invalidate cache
    if (existing.contentCachedAt && modifiedTime > existing.contentCachedAt) {
      updatedItem.content = undefined;
      updatedItem.contentCachedAt = undefined;
    }

    newItems.set(path, updatedItem);
  } else {
    // New item
    newItems.set(path, createItemData(path, name, isDirectory, modifiedTime, createdTime));
  }

  state = { ...state, items: newItems };
  emitChange();
}

/**
 * Batch upsert multiple items at once (more efficient for directory loads)
 */
export function upsertItems(
  items: Array<{ path: string; name: string; isDirectory: boolean; modifiedTime: number; createdTime?: number }>
): void {
  const newItems = new Map(state.items);

  for (const item of items) {
    const existing = newItems.get(item.path);
    const createdTime = item.createdTime ?? item.modifiedTime;

    if (existing) {
      const updatedItem: ItemData = {
        ...existing,
        name: item.name,
        isDirectory: item.isDirectory,
        modifiedTime: item.modifiedTime,
        createdTime,
      };

      if (existing.contentCachedAt && item.modifiedTime > existing.contentCachedAt) {
        updatedItem.content = undefined;
        updatedItem.contentCachedAt = undefined;
      }

      newItems.set(item.path, updatedItem);
    } else {
      newItems.set(item.path, createItemData(item.path, item.name, item.isDirectory, item.modifiedTime, createdTime));
    }
  }

  state = { ...state, items: newItems };
  emitChange();
}

/**
 * Set the cached content for a markdown file
 */
export function setItemContent(path: string, content: string): void {
  const existing = state.items.get(path);
  if (!existing) return;

  const newItems = new Map(state.items);
  newItems.set(path, {
    ...existing,
    content,
    contentCachedAt: existing.modifiedTime,
  });

  state = { ...state, items: newItems };
  emitChange();
}

/**
 * Toggle the selected state of an item
 */
export function toggleItemSelected(path: string): void {
  const existing = state.items.get(path);
  if (!existing) return;

  const newItems = new Map(state.items);
  newItems.set(path, {
    ...existing,
    isSelected: !existing.isSelected,
  });

  state = { ...state, items: newItems };
  emitChange();
}

/**
 * Toggle the expanded state of an item
 */
export function toggleItemExpanded(path: string): void {
  const existing = state.items.get(path);
  if (!existing) return;

  const newItems = new Map(state.items);
  newItems.set(path, {
    ...existing,
    isExpanded: !existing.isExpanded,
  });

  state = { ...state, items: newItems };
  emitChange();
}

/**
 * Set the expanded state of an item explicitly
 */
export function setItemExpanded(path: string, isExpanded: boolean): void {
  const existing = state.items.get(path);
  if (!existing) return;

  const newItems = new Map(state.items);
  newItems.set(path, {
    ...existing,
    isExpanded,
  });

  state = { ...state, items: newItems };
  emitChange();
}

/**
 * Set the selected state of an item explicitly
 */
export function setItemSelected(path: string, isSelected: boolean): void {
  const existing = state.items.get(path);
  if (!existing) return;

  const newItems = new Map(state.items);
  newItems.set(path, {
    ...existing,
    isSelected,
  });

  state = { ...state, items: newItems };
  emitChange();
}

/**
 * Clear selection state for all items
 */
export function clearAllSelections(): void {
  if (state.items.size === 0) return;

  const newItems = new Map(state.items);
  let hasChanges = false;

  for (const [path, item] of newItems) {
    if (item.isSelected) {
      newItems.set(path, { ...item, isSelected: false });
      hasChanges = true;
    }
  }

  if (!hasChanges) return;

  state = { ...state, items: newItems };
  emitChange();
}

/**
 * Select all items whose paths are in the provided array
 * (used for Select All in the current folder view)
 */
export function selectItemsByPaths(paths: string[]): void {
  if (state.items.size === 0 || paths.length === 0) return;

  const pathSet = new Set(paths);
  const newItems = new Map(state.items);
  let hasChanges = false;

  for (const [path, item] of newItems) {
    if (pathSet.has(path) && !item.isSelected) {
      newItems.set(path, { ...item, isSelected: true });
      hasChanges = true;
    }
  }

  if (!hasChanges) return;

  state = { ...state, items: newItems };
  emitChange();
}

/**
 * Expand all items (set isExpanded to true for all)
 */
export function expandAllItems(): void {
  if (state.items.size === 0) return;

  const newItems = new Map(state.items);
  let hasChanges = false;

  for (const [path, item] of newItems) {
    if (!item.isExpanded) {
      newItems.set(path, { ...item, isExpanded: true });
      hasChanges = true;
    }
  }

  if (!hasChanges) return;

  state = { ...state, items: newItems };
  emitChange();
}

/**
 * Collapse all items (set isExpanded to false for all)
 */
export function collapseAllItems(): void {
  if (state.items.size === 0) return;

  const newItems = new Map(state.items);
  let hasChanges = false;

  for (const [path, item] of newItems) {
    if (item.isExpanded) {
      newItems.set(path, { ...item, isExpanded: false });
      hasChanges = true;
    }
  }

  if (!hasChanges) return;

  state = { ...state, items: newItems };
  emitChange();
}

/**
 * Expansion counts for items in a given directory
 */
export interface ExpansionCounts {
  expandedCount: number;
  collapsedCount: number;
  totalCount: number;
}

/**
 * Get expansion counts for items in a specific directory path.
 * Only counts items that are direct children of the given path, are not cut,
 * and are not directories (since folders aren't expandable).
 */
export function getExpansionCounts(directoryPath: string): ExpansionCounts {
  let expandedCount = 0;
  let collapsedCount = 0;

  for (const [itemPath, item] of state.items) {
    // Skip cut items (they're not visible)
    if (item.isCut) continue;

    // Skip directories (they aren't expandable)
    if (item.isDirectory) continue;

    // Check if this item is a direct child of the directory
    const parentPath = itemPath.substring(0, itemPath.lastIndexOf('/'));
    if (parentPath !== directoryPath) continue;

    if (item.isExpanded) {
      expandedCount++;
    } else {
      collapsedCount++;
    }
  }

  return {
    expandedCount,
    collapsedCount,
    totalCount: expandedCount + collapsedCount,
  };
}

/**
 * Cached expansion counts to avoid creating new objects on every snapshot call
 */
let cachedExpansionCounts: ExpansionCounts = { expandedCount: 0, collapsedCount: 0, totalCount: 0 };
let cachedExpansionCountsPath = '';

/**
 * Get snapshot of expansion counts for the current path.
 * Returns a cached object to maintain referential equality when values haven't changed.
 */
function getExpansionCountsSnapshot(): ExpansionCounts {
  const counts = getExpansionCounts(state.currentPath);
  
  // Only return a new object if values actually changed
  if (
    cachedExpansionCountsPath !== state.currentPath ||
    cachedExpansionCounts.expandedCount !== counts.expandedCount ||
    cachedExpansionCounts.collapsedCount !== counts.collapsedCount ||
    cachedExpansionCounts.totalCount !== counts.totalCount
  ) {
    cachedExpansionCounts = counts;
    cachedExpansionCountsPath = state.currentPath;
  }
  
  return cachedExpansionCounts;
}

/**
 * Hook to subscribe to expansion counts for the current path
 */
export function useExpansionCounts(): ExpansionCounts {
  return useSyncExternalStore(subscribe, getExpansionCountsSnapshot);
}

/**
 * Mark all selected items as cut and clear their selection
 */
export function cutSelectedItems(): void {
  if (state.items.size === 0) return;

  const newItems = new Map(state.items);
  let hasChanges = false;

  for (const [path, item] of newItems) {
    if (item.isSelected) {
      newItems.set(path, { ...item, isSelected: false, isCut: true });
      hasChanges = true;
    }
  }

  if (!hasChanges) return;

  state = { ...state, items: newItems };
  emitChange();
}

/**
 * Clear cut state for all items
 */
export function clearAllCutItems(): void {
  if (state.items.size === 0) return;

  const newItems = new Map(state.items);
  let hasChanges = false;

  for (const [path, item] of newItems) {
    if (item.isCut) {
      newItems.set(path, { ...item, isCut: false });
      hasChanges = true;
    }
  }

  if (!hasChanges) return;

  state = { ...state, items: newItems };
  emitChange();
}

/**
 * Delete multiple items from the store by their paths
 */
export function deleteItems(paths: string[]): void {
  if (paths.length === 0) return;

  const newItems = new Map(state.items);
  let hasChanges = false;

  for (const path of paths) {
    if (newItems.has(path)) {
      newItems.delete(path);
      hasChanges = true;
    }
  }

  if (!hasChanges) return;

  state = { ...state, items: newItems };
  emitChange();
}

/**
 * Clear all cached items from the store.
 * Called after operations that modify the filesystem (delete, paste)
 * to ensure stale items don't remain in memory.
 */
export function clearCache(): void {
  state = { ...state, items: new Map<string, ItemData>() };
  emitChange();
}

/**
 * Get an item by path (direct access, not a hook)
 */
export function getItem(path: string): ItemData | undefined {
  return state.items.get(path);
}

/**
 * Check if cached content is valid for an item
 */
export function isCacheValid(path: string): boolean {
  const item = state.items.get(path);
  if (!item || !item.content || !item.contentCachedAt) {
    return false;
  }
  // Cache is valid if the file hasn't been modified since we cached it
  return item.contentCachedAt >= item.modifiedTime;
}

/**
 * Set the editing state of an item
 * @param path - The full path of the item
 * @param editing - Whether the item is being edited
 * @param goToLine - Optional 1-based line number to scroll to when editing starts
 */
export function setItemEditing(path: string, editing: boolean, goToLine?: number): void {
  const existing = state.items.get(path);
  if (!existing) return;

  const newItems = new Map(state.items);
  newItems.set(path, {
    ...existing,
    editing,
    goToLine: editing ? goToLine : undefined,
    // Clear editContent when exiting edit mode
    ...(editing ? {} : { editContent: undefined }),
  });

  state = {
    ...state,
    items: newItems,
    ...(editing ? { highlightItem: existing.name } : {}),
  };
  emitChange();
}



/**
 * Set the current edit content for a file (used during editing).
 */
export function setItemEditContent(path: string, editContent: string): void {
  const existing = state.items.get(path);
  if (!existing) return;

  const newItems = new Map(state.items);
  newItems.set(path, { ...existing, editContent });
  state = { ...state, items: newItems };
  emitChange();
}

/**
 * Get the current edit content for a file synchronously (not a hook).
 * Useful for reading the latest value in event handlers without render lag.
 */
export function getItemEditContent(path: string): string {
  return state.items.get(path)?.editContent ?? '';
}

/**
 * Clear the goToLine property for an item (call after scrolling to the line)
 */
export function clearItemGoToLine(path: string): void {
  const existing = state.items.get(path);
  if (!existing || existing.goToLine === undefined) return;

  const newItems = new Map(state.items);
  newItems.set(path, {
    ...existing,
    goToLine: undefined,
  });

  state = { ...state, items: newItems };
  emitChange();
}

/**
 * Set the renaming state of an item
 */
export function setItemRenaming(path: string, renaming: boolean): void {
  const existing = state.items.get(path);
  if (!existing) return;

  const newItems = new Map(state.items);
  newItems.set(path, {
    ...existing,
    renaming,
  });

  state = {
    ...state,
    items: newItems,
    ...(renaming ? { highlightItem: existing.name } : {}),
  };
  emitChange();
}

/**
 * Set the currently highlighted item name
 */
export function setHighlightItem(name: string | null): void {
  if (state.highlightItem === name) return;
  state = { ...state, highlightItem: name };
  emitChange();
}

/**
 * Set the highlighted search result (for persistent highlighting)
 */
export function setHighlightedSearchResult(result: { path: string; lineNumber?: number } | null): void {
  state = { ...state, highlightedSearchResult: result };
  emitChange();
}

/**
 * Set the current view
 */
export function setCurrentView(view: AppView): void {
  if (state.currentView === view) return;
  state = { ...state, currentView: view };
  emitChange();
}

/**
 * Set the current path being browsed
 */
export function setCurrentPath(path: string): void {
  if (state.currentPath === path) return;
  state = { ...state, currentPath: path };
  emitChange();
}

/**
 * Set scroll position for the browser view at a specific path
 */
export function setBrowserScrollPosition(path: string, position: number): void {
  const newBrowserPositions = new Map(state.scrollPositions.browser);
  newBrowserPositions.set(path, position);
  state = {
    ...state,
    scrollPositions: {
      ...state.scrollPositions,
      browser: newBrowserPositions,
    },
  };
  // Don't emit change for scroll position updates to avoid re-renders
  // The position is saved silently and only read on mount
}

/**
 * Get scroll position for the browser view at a specific path
 */
export function getBrowserScrollPosition(path: string): number {
  return state.scrollPositions.browser.get(path) ?? 0;
}

/**
 * Set scroll position for the search-results view
 */
export function setSearchResultsScrollPosition(position: number): void {
  state = {
    ...state,
    scrollPositions: {
      ...state.scrollPositions,
      'search-results': position,
    },
  };
  // Don't emit change for scroll position updates
}

/**
 * Get scroll position for the search-results view
 */
export function getSearchResultsScrollPosition(): number {
  return state.scrollPositions['search-results'];
}

/**
 * Set scroll position for the settings view
 */
export function setSettingsScrollPosition(position: number): void {
  state = {
    ...state,
    scrollPositions: {
      ...state.scrollPositions,
      settings: position,
    },
  };
  // Don't emit change for scroll position updates
}

/**
 * Get scroll position for the settings view
 */
export function getSettingsScrollPosition(): number {
  return state.scrollPositions.settings;
}

/**
 * Set scroll position for the folder analysis view
 */
export function setFolderAnalysisScrollPosition(position: number): void {
  state = {
    ...state,
    scrollPositions: {
      ...state.scrollPositions,
      'folder-analysis': position,
    },
  };
  // Don't emit change for scroll position updates
}

/**
 * Get scroll position for the folder analysis view
 */
export function getFolderAnalysisScrollPosition(): number {
  return state.scrollPositions['folder-analysis'];
}

/**
 * Set folder analysis results
 */
export function setFolderAnalysis(data: FolderAnalysisState): void {
  state = { ...state, folderAnalysis: data };
  emitChange();
}

/**
 * Navigate to a path and switch to browser view in a single state update.
 * Optionally set a file to scroll to after render completes.
 */
export function navigateToBrowserPath(path: string, scrollToFile?: string): void {
  const newState: Partial<AppState> = {
    currentPath: path,
    currentView: 'browser',
  };
  if (scrollToFile !== undefined) {
    newState.pendingScrollToFile = scrollToFile;
  }
  state = { ...state, ...newState };
  emitChange();
}

/**
 * Clear the pending scroll to file (call after scrolling completes)
 */
export function clearPendingScrollToFile(): void {
  if (state.pendingScrollToFile === null) return;
  state = { ...state, pendingScrollToFile: null };
  emitChange();
}

/**
 * Set a file to scroll into view after render completes
 */
export function setPendingScrollToFile(fileName: string): void {
  state = { ...state, pendingScrollToFile: fileName };
  emitChange();
}

/**
 * Set a file to start editing after navigation completes
 * @param filePath - The full path of the file to edit
 * @param lineNumber - Optional 1-based line number to scroll to
 */
export function setPendingEditFile(filePath: string, lineNumber?: number): void {
  state = { ...state, pendingEditFile: filePath, pendingEditLineNumber: lineNumber ?? null };
  emitChange();
}

/**
 * Clear the pending edit file and line number (call after editing starts)
 */
export function clearPendingEditFile(): void {
  if (state.pendingEditFile === null && state.pendingEditLineNumber === null) return;
  state = { ...state, pendingEditFile: null, pendingEditLineNumber: null };
  emitChange();
}

/**
 * Set search results along with the query and folder they came from
 */
export function setSearchResults(
  results: SearchResultItem[],
  query: string,
  folder: string,
  sortBy?: SearchSortBy,
  sortDirection?: SearchSortDirection
): void {
  state = {
    ...state,
    searchResults: results,
    searchQuery: query,
    searchFolder: folder,
    ...(sortBy !== undefined && { searchSortBy: sortBy }),
    ...(sortDirection !== undefined && { searchSortDirection: sortDirection }),
  };
  emitChange();
}

/**
 * Clear search results
 */
export function clearSearchResults(): void {
  state = {
    ...state,
    searchResults: [],
    searchQuery: '',
    searchFolder: '',
    searchSortBy: 'modified-time',
    searchSortDirection: 'desc',
  };
  emitChange();
}

/**
 * Update application settings
 */
export function setSettings(settings: AppSettings): void {
  state = { ...state, settings };
  emitChange();
}

/**
 * Update the font size setting
 */
export function setFontSize(fontSize: FontSize): void {
  state = {
    ...state,
    settings: { ...state.settings, fontSize },
  };
  emitChange();
}

/**
 * Update the sort order setting
 */
export function setSortOrder(sortOrder: SortOrder): void {
  state = {
    ...state,
    settings: { ...state.settings, sortOrder },
  };
  emitChange();
}

/**
 * Update the folders on top setting
 */
export function setFoldersOnTop(foldersOnTop: boolean): void {
  state = {
    ...state,
    settings: { ...state.settings, foldersOnTop },
  };
  emitChange();
}

/**
 * Update the ignored paths setting
 */
export function setIgnoredPaths(ignoredPaths: string): void {
  state = {
    ...state,
    settings: { ...state.settings, ignoredPaths },
  };
  emitChange();
}

/**
 * Update the content width setting
 */
export function setContentWidth(contentWidth: ContentWidth): void {
  state = {
    ...state,
    settings: { ...state.settings, contentWidth },
  };
  emitChange();
}

/**
 * Toggle bookmark for a file path.
 * If the path is bookmarked, removes it. If not, adds it.
 * Returns the new bookmarked state.
 */
export function toggleBookmark(filePath: string): boolean {
  const currentBookmarks = state.settings.bookmarks || [];
  const isCurrentlyBookmarked = currentBookmarks.includes(filePath);
  
  const newBookmarks = isCurrentlyBookmarked
    ? currentBookmarks.filter(p => p !== filePath)
    : [...currentBookmarks, filePath];
  
  state = {
    ...state,
    settings: { ...state.settings, bookmarks: newBookmarks },
  };
  emitChange();
  
  return !isCurrentlyBookmarked;
}

/**
 * Check if a file path is bookmarked
 */
export function isBookmarked(filePath: string): boolean {
  return (state.settings.bookmarks || []).includes(filePath);
}

/**
 * Update a bookmark path when a file/folder is renamed.
 * If the oldPath is bookmarked, updates it to the newPath.
 * Returns true if a bookmark was updated.
 */
export function updateBookmarkPath(oldPath: string, newPath: string): boolean {
  const currentBookmarks = state.settings.bookmarks || [];
  const index = currentBookmarks.indexOf(oldPath);
  
  if (index === -1) {
    return false; // Not bookmarked, nothing to update
  }
  
  const newBookmarks = [...currentBookmarks];
  newBookmarks[index] = newPath;
  
  state = {
    ...state,
    settings: { ...state.settings, bookmarks: newBookmarks },
  };
  emitChange();
  
  return true;
}

/**
 * Get current settings (non-reactive, for use outside React)
 */
export function getSettings(): AppSettings {
  return state.settings;
}

// ============================================================================
// Hooks - React hooks for subscribing to state
// ============================================================================

/**
 * Hook to subscribe to the entire app state
 */
export function useAppState(): AppState {
  return useSyncExternalStore(subscribe, getSnapshot);
}

/**
 * Hook to subscribe to the items Map
 */
export function useItems(): Map<string, ItemData> {
  return useSyncExternalStore(subscribe, getItemsSnapshot);
}

/**
 * Hook to get a specific item by path.
 * Returns undefined if the item doesn't exist.
 */
export function useItem(path: string): ItemData | undefined {
  const items = useSyncExternalStore(subscribe, getItemsSnapshot);
  return items.get(path);
}

/**
 * Hook to subscribe to the current view
 */
export function useCurrentView(): AppView {
  return useSyncExternalStore(subscribe, getCurrentViewSnapshot);
}

/**
 * Hook to subscribe to the current path
 */
export function useCurrentPath(): string {
  return useSyncExternalStore(subscribe, getCurrentPathSnapshot);
}

/**
 * Hook to subscribe to pending scroll to file
 */
export function usePendingScrollToFile(): string | null {
  return useSyncExternalStore(subscribe, getPendingScrollToFileSnapshot);
}

/**
 * Hook to subscribe to search results
 */
export function useSearchResults(): SearchResultItem[] {
  return useSyncExternalStore(subscribe, getSearchResultsSnapshot);
}

/**
 * Hook to subscribe to search query
 */
export function useSearchQuery(): string {
  return useSyncExternalStore(subscribe, getSearchQuerySnapshot);
}

/**
 * Hook to subscribe to search folder
 */
export function useSearchFolder(): string {
  return useSyncExternalStore(subscribe, getSearchFolderSnapshot);
}

/**
 * Hook to subscribe to search sort by
 */
export function useSearchSortBy(): SearchSortBy {
  return useSyncExternalStore(subscribe, getSearchSortBySnapshot);
}

/**
 * Hook to subscribe to search sort direction
 */
export function useSearchSortDirection(): SearchSortDirection {
  return useSyncExternalStore(subscribe, getSearchSortDirectionSnapshot);
}

/**
 * Hook to subscribe to settings
 */
export function useSettings(): AppSettings {
  return useSyncExternalStore(subscribe, getSettingsSnapshot);
}

/**
 * Hook to subscribe to highlighted item name
 */
export function useHighlightItem(): string | null {
  return useSyncExternalStore(subscribe, getHighlightItemSnapshot);
}

/**
 * Hook to subscribe to pending edit file path
 */
export function usePendingEditFile(): string | null {
  return useSyncExternalStore(subscribe, getPendingEditFileSnapshot);
}

/**
 * Hook to subscribe to pending edit line number
 */
export function usePendingEditLineNumber(): number | null {
  return useSyncExternalStore(subscribe, getPendingEditLineNumberSnapshot);
}
/**
 * Hook to subscribe to scroll positions
 */
export function useScrollPositions(): ScrollPositions {
  return useSyncExternalStore(subscribe, getScrollPositionsSnapshot);
}

/**
 * Hook to subscribe to highlighted search result
 */
export function useHighlightedSearchResult(): { path: string; lineNumber?: number } | null {
  return useSyncExternalStore(subscribe, getHighlightedSearchResultSnapshot);
}

/**
 * Hook to subscribe to folder analysis state
 */
export function useFolderAnalysis(): FolderAnalysisState | null {
  return useSyncExternalStore(subscribe, getFolderAnalysisSnapshot);
}
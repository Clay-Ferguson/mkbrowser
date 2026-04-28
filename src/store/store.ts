import { useSyncExternalStore } from 'react';
import type { AppState, AppView, AppSettings, FontSize, SortOrder, ContentWidth, IndexTreeWidth, ItemData, SearchResultItem, SearchSortBy, SearchSortDirection, ScrollPositions, FolderAnalysisState, TreeNode, FileNode, MarkdownHeadingNode } from './types';
import { createItemData } from './types';

/**
 * Default settings
 */
const defaultSettings: AppSettings = {
  fontSize: 'medium',
  sortOrder: 'alphabetical',
  foldersOnTop: true,
  showToc: true,
  ignoredPaths: '',
  searchDefinitions: [],
  contentWidth: 'medium',
  bookmarks: [],
  ocrToolsFolder: '',
  indexTreeWidth: 'narrow',
};

/**
 * Initial state
 */
const initialState: AppState = {
  items: new Map(),
  currentPath: '',
  currentView: 'browser', // browser | search-results | settings
  pendingScrollToFile: null,
  pendingScrollToHeadingSlug: null,
  searchQuery: '',
  searchFolder: '',
  searchResults: [],
  searchSortBy: 'modified-time',
  searchSortDirection: 'desc',
  settings: defaultSettings,
  highlightItem: null,
  pendingEditFile: null,
  pendingEditLineNumber: null,
  pendingEditView: null,
  scrollPositions: {
    browser: new Map(),
    'search-results': 0,
    settings: 0,
    'folder-analysis': 0,
    'ai-settings': 0,
    thread: 0,
  },
  highlightedSearchResult: null,
  folderAnalysis: null,
  pendingThreadScrollToBottom: false,
  rootPath: '',
  visibleTabs: new Set<AppView>(['browser']),
  indexTreeRoot: null,
  pendingIndexTreeReveal: null,
  hasIndexFile: false,
  indexYaml: null,
  expandedEditor: false,
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

function getPendingScrollToHeadingSlugSnapshot(): string | null {
  return state.pendingScrollToHeadingSlug;
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
 * Get snapshot of pending edit view
 */
function getPendingEditViewSnapshot(): AppView | null {
  return state.pendingEditView;
}

/**
 * Get snapshot of pendingThreadScrollToBottom
 */
function getPendingThreadScrollToBottomSnapshot(): boolean {
  return state.pendingThreadScrollToBottom;
}

function getHasIndexFileSnapshot(): boolean {
  return state.hasIndexFile;
}

function getIndexYamlSnapshot(): AppState['indexYaml'] {
  return state.indexYaml;
}

function getExpandedEditorSnapshot(): boolean {
  return state.expandedEditor;
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

/**
 * Get snapshot of rootPath
 */
function getRootPathSnapshot(): string {
  return state.rootPath;
}

/**
 * Get snapshot of visible tabs
 */
function getVisibleTabsSnapshot(): Set<AppView> {
  return state.visibleTabs;
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
  items: Array<{ path: string; name: string; isDirectory: boolean; modifiedTime: number; createdTime?: number; aiHint?: string }>
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
        aiHint: item.aiHint,
      };

      if (existing.contentCachedAt && item.modifiedTime > existing.contentCachedAt) {
        updatedItem.content = undefined;
        updatedItem.contentCachedAt = undefined;
      }

      newItems.set(item.path, updatedItem);
    } else {
      newItems.set(item.path, createItemData(item.path, item.name, item.isDirectory, item.modifiedTime, createdTime, item.aiHint));
    }
  }

  state = { ...state, items: newItems };
  emitChange();
}

/**
 * Set the cached content for a markdown file
 */
export function setItemContent(path: string, content: string, modifiedTime?: number): void {
  const existing = state.items.get(path);
  if (!existing) return;

  const now = modifiedTime ?? existing.modifiedTime;
  const newItems = new Map(state.items);
  newItems.set(path, {
    ...existing,
    content,
    modifiedTime: now,
    contentCachedAt: now,
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
 * Rename an item in the store: move its entry from oldPath to newPath,
 * preserving all state (isSelected, isCut, isExpanded, content, etc.).
 * This prevents phantom entries when a selected item is renamed.
 */
export function renameItem(oldPath: string, newPath: string, newName: string): void {
  const existing = state.items.get(oldPath);
  if (!existing) return;

  const newItems = new Map(state.items);
  newItems.delete(oldPath);
  newItems.set(newPath, {
    ...existing,
    path: newPath,
    name: newName,
    renaming: false,
  });

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
 * Get all currently cut items (direct access, not a hook)
 */
export function getCutItems(): ItemData[] {
  return Array.from(state.items.values()).filter(item => item.isCut);
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
    // Clear editContent and reviewing state when exiting edit mode
    ...(editing ? {} : { editContent: undefined, reviewing: undefined, rewrittenContent: undefined }),
  });

  state = {
    ...state,
    items: newItems,
    ...(editing ? { highlightItem: path } : {}),
  };
  emitChange();
}

/**
 * Set the reviewing (diff review) state for a file.
 */
export function setItemReviewing(path: string, reviewing: boolean, rewrittenContent?: string): void {
  const existing = state.items.get(path);
  if (!existing) return;

  const newItems = new Map(state.items);
  newItems.set(path, {
    ...existing,
    reviewing,
    rewrittenContent: reviewing ? rewrittenContent : undefined,
  });

  state = { ...state, items: newItems };
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
    ...(renaming ? { highlightItem: path } : {}),
  };
  emitChange();
}

/**
 * Set the currently highlighted item (by full path)
 */
export function setHighlightItem(path: string | null): void {
  if (state.highlightItem === path) return;
  state = { ...state, highlightItem: path };
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
 * Set scroll position for the AI settings view
 */
export function setAiSettingsScrollPosition(position: number): void {
  state = {
    ...state,
    scrollPositions: {
      ...state.scrollPositions,
      'ai-settings': position,
    },
  };
  // Don't emit change for scroll position updates
}

/**
 * Get scroll position for the AI settings view
 */
export function getAiSettingsScrollPosition(): number {
  return state.scrollPositions['ai-settings'];
}

/**
 * Set scroll position for the thread view
 */
export function setThreadScrollPosition(position: number): void {
  state = {
    ...state,
    scrollPositions: {
      ...state.scrollPositions,
      thread: position,
    },
  };
  // Don't emit change for scroll position updates
}

/**
 * Get scroll position for the thread view
 */
export function getThreadScrollPosition(): number {
  return state.scrollPositions.thread;
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

export function setPendingScrollToHeadingSlug(slug: string): void {
  state = { ...state, pendingScrollToHeadingSlug: slug };
  emitChange();
}

export function clearPendingScrollToHeadingSlug(): void {
  if (state.pendingScrollToHeadingSlug === null) return;
  state = { ...state, pendingScrollToHeadingSlug: null };
  emitChange();
}

/**
 * Set a file to start editing after navigation completes
 * @param filePath - The full path of the file to edit
 * @param lineNumber - Optional 1-based line number to scroll to
 */
export function setPendingEditFile(filePath: string, lineNumber?: number, view?: AppView): void {
  state = { ...state, pendingEditFile: filePath, pendingEditLineNumber: lineNumber ?? null, pendingEditView: view ?? 'browser' };
  emitChange();
}

/**
 * Clear the pending edit file and line number (call after editing starts)
 */
export function clearPendingEditFile(): void {
  if (state.pendingEditFile === null && state.pendingEditLineNumber === null && state.pendingEditView === null) return;
  state = { ...state, pendingEditFile: null, pendingEditLineNumber: null, pendingEditView: null };
  emitChange();
}

/**
 * Request ThreadView to scroll to bottom after its next render.
 */
export function setPendingThreadScrollToBottom(): void {
  state = { ...state, pendingThreadScrollToBottom: true };
  emitChange();
}

/**
 * Clear the pending thread scroll-to-bottom flag (call after the scroll timer is created).
 */
export function clearPendingThreadScrollToBottom(): void {
  if (!state.pendingThreadScrollToBottom) return;
  state = { ...state, pendingThreadScrollToBottom: false };
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
 * Set whether the current directory contains a .INDEX.yaml file.
 */
export function setHasIndexFile(hasIndexFile: boolean): void {
  state = { ...state, hasIndexFile };
  emitChange();
}

export function setExpandedEditor(expandedEditor: boolean): void {
  state = { ...state, expandedEditor };
  emitChange();
}

/**
 * Set the parsed .INDEX.yaml for the current directory.
 */
export function setIndexYaml(indexYaml: AppState['indexYaml']): void {
  state = { ...state, indexYaml };
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

export function setShowToc(showToc: boolean): void {
  state = {
    ...state,
    settings: { ...state.settings, showToc },
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
 * Update the OCR tools folder setting
 */
export function setOcrToolsFolder(ocrToolsFolder: string): void {
  state = {
    ...state,
    settings: { ...state.settings, ocrToolsFolder },
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

export function usePendingScrollToHeadingSlug(): string | null {
  return useSyncExternalStore(subscribe, getPendingScrollToHeadingSlugSnapshot);
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
 * Hook to subscribe to pending edit view
 */
export function usePendingEditView(): AppView | null {
  return useSyncExternalStore(subscribe, getPendingEditViewSnapshot);
}

/**
 * Hook to subscribe to pendingThreadScrollToBottom
 */
export function usePendingThreadScrollToBottom(): boolean {
  return useSyncExternalStore(subscribe, getPendingThreadScrollToBottomSnapshot);
}

/**
 * Hook to subscribe to hasIndexFile
 */
export function useHasIndexFile(): boolean {
  return useSyncExternalStore(subscribe, getHasIndexFileSnapshot);
}

export function useExpandedEditor(): boolean {
  return useSyncExternalStore(subscribe, getExpandedEditorSnapshot);
}

/**
 * Hook to subscribe to the current directory's parsed .INDEX.yaml
 */
export function useIndexYaml(): AppState['indexYaml'] {
  return useSyncExternalStore(subscribe, getIndexYamlSnapshot);
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
 * Hook to check whether any items are currently cut
 */
export function useHasCutItems(): boolean {
  const items = useSyncExternalStore(subscribe, getItemsSnapshot);
  for (const item of items.values()) {
    if (item.isCut) return true;
  }
  return false;
}

/**
 * Hook to subscribe to folder analysis state
 */
export function useFolderAnalysis(): FolderAnalysisState | null {
  return useSyncExternalStore(subscribe, getFolderAnalysisSnapshot);
}

/**
 * Set the root folder path.
 */
export function setRootPath(path: string): void {
  if (state.rootPath === path) return;
  state = { ...state, rootPath: path };
  emitChange();
}

/**
 * Check whether a tab is currently visible in the tab bar.
 */
export function isTabVisible(tab: AppView): boolean {
  return state.visibleTabs.has(tab);
}

/**
 * Show a tab in the tab bar (adds it to visibleTabs).
 * Does not persist — resets on restart.
 */
export function showTab(tab: AppView): void {
  if (state.visibleTabs.has(tab)) return;
  const next = new Set(state.visibleTabs);
  next.add(tab);
  state = { ...state, visibleTabs: next };
  emitChange();
}

/**
 * Hook to subscribe to rootPath
 */
export function useRootPath(): string {
  return useSyncExternalStore(subscribe, getRootPathSnapshot);
}

/**
 * Hook to subscribe to visible tabs
 */
export function useVisibleTabs(): Set<AppView> {
  return useSyncExternalStore(subscribe, getVisibleTabsSnapshot);
}

/**
 * Update the index tree width setting
 */
export function setIndexTreeWidth(indexTreeWidth: IndexTreeWidth): void {
  state = {
    ...state,
    settings: { ...state.settings, indexTreeWidth },
  };
  emitChange();
}

// ============================================================================
// IndexTree
// ============================================================================

// Internal union covering every node type that carries a path for store lookup.
type PathNode = FileNode | MarkdownHeadingNode;

/**
 * Recursively find and update a single node by path/key, returning a new tree root.
 * Works across mixed trees (FileNode children may include MarkdownHeadingNode).
 */
function updateNodeByPath(
  node: PathNode,
  targetPath: string,
  updater: (n: PathNode) => PathNode
): PathNode {
  if (node.path === targetPath) return updater(node);
  if (!node.children) return node;
  let changed = false;
  const newChildren = node.children.map(child => {
    if (!('path' in child)) return child;
    const updated = updateNodeByPath(child as PathNode, targetPath, updater);
    if (updated !== child) changed = true;
    return updated;
  }) as TreeNode[];
  return changed ? { ...node, children: newChildren } as PathNode : node;
}

function getIndexTreeRootSnapshot(): FileNode | null {
  return state.indexTreeRoot;
}

/**
 * Replace the entire index tree root (used on initialization or rootPath change).
 */
export function setIndexTreeRoot(root: FileNode | null): void {
  state = { ...state, indexTreeRoot: root };
  emitChange();
}

/**
 * Mark a directory node as loading (spinner while re-reading its children).
 */
export function setIndexTreeNodeLoading(path: string, loading: boolean): void {
  if (!state.indexTreeRoot) return;
  const newRoot = updateNodeByPath(state.indexTreeRoot, path, n => ({ ...n, isLoading: loading })) as FileNode;
  if (newRoot === state.indexTreeRoot) return;
  state = { ...state, indexTreeRoot: newRoot };
  emitChange();
}

/**
 * Set a node's children and mark it as expanded.
 * Used for both directory nodes (children: FileNode[]) and markdown file nodes (children: MarkdownHeadingNode[]).
 */
export function expandIndexTreeNode(path: string, children: TreeNode[]): void {
  if (!state.indexTreeRoot) return;

  const newRoot = updateNodeByPath(state.indexTreeRoot, path, n => ({
    ...n,
    isExpanded: true,
    isLoading: false,
    children,
  } as PathNode)) as FileNode;
  if (newRoot === state.indexTreeRoot) return;
  state = { ...state, indexTreeRoot: newRoot };
  emitChange();
}

function collapseAllNodes(node: TreeNode): TreeNode {
  if (!('isDirectory' in node) || !(node as FileNode).isDirectory) return node;
  const collapsedChildren = node.children
    ? node.children.map(collapseAllNodes)
    : node.children;
  return { ...node, isExpanded: false, children: collapsedChildren };
}

/**
 * Collapse all expanded directory nodes in the tree (preserves root expansion).
 */
export function collapseAllIndexTreeNodes(): void {
  if (!state.indexTreeRoot) return;
  const newChildren = state.indexTreeRoot.children
    ? state.indexTreeRoot.children.map(collapseAllNodes)
    : state.indexTreeRoot.children;
  const newRoot = { ...state.indexTreeRoot, children: newChildren };
  state = { ...state, indexTreeRoot: newRoot };
  emitChange();
}

/**
 * Collapse a node (directory or heading) without clearing its cached children.
 */
export function collapseIndexTreeNode(path: string): void {
  if (!state.indexTreeRoot) return;
  const newRoot = updateNodeByPath(state.indexTreeRoot, path, n => ({
    ...n,
    isExpanded: false,
  })) as FileNode;
  if (newRoot === state.indexTreeRoot) return;
  state = { ...state, indexTreeRoot: newRoot };
  emitChange();
}

/**
 * Hook to subscribe to the IndexTree root node.
 */
export function useIndexTreeRoot(): FileNode | null {
  return useSyncExternalStore(subscribe, getIndexTreeRootSnapshot);
}

/**
 * Get the current IndexTree root node without subscribing (for use in async callbacks).
 */
export function getIndexTreeRoot(): FileNode | null {
  return state.indexTreeRoot;
}

function getPendingIndexTreeRevealSnapshot(): string | null {
  return state.pendingIndexTreeReveal;
}

/**
 * Signal IndexTree to expand to the given path and scroll it into view.
 */
export function setPendingIndexTreeReveal(path: string): void {
  state = { ...state, pendingIndexTreeReveal: path };
  emitChange();
}

/**
 * Clear the pending reveal signal (called by IndexTree when it picks it up).
 */
export function clearPendingIndexTreeReveal(): void {
  if (state.pendingIndexTreeReveal === null) return;
  state = { ...state, pendingIndexTreeReveal: null };
  emitChange();
}

/**
 * Hook to subscribe to the pending IndexTree reveal path.
 */
export function usePendingIndexTreeReveal(): string | null {
  return useSyncExternalStore(subscribe, getPendingIndexTreeRevealSnapshot);
}
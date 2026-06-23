import { useSyncExternalStore } from 'react';
import type { AppState, AppSettings, AiConfigState } from '../types/types';

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
  calendarItemsFolder: '',
  indexTreeWidth: 'narrow',
  showPropsInEditor: true,
};

/**
 * Default AI config mirror. Kept here (next to `defaultSettings`) so the store
 * core owns its own defaults without importing a slice. `llamacppBaseUrl`
 * defaults to the local llama.cpp server URL the settings form has always shown.
 */
export const defaultAiConfig: AiConfigState = {
  aiEnabled: false,
  aiRewriteMode: false,
  aiRewritePrompt: '',
  aiRewritePrompts: [],
  tagsPanelVisible: false,
  fullDocContext: false,
  aiModels: [],
  aiModel: '',
  llamacppBaseUrl: 'http://localhost:8080/v1',
  llamacppFolder: '',
  agenticMode: false,
  agenticAllowedFolders: '',
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
  searchName: '',
  searchResults: [],
  searchSortBy: 'modified-time',
  searchSortDirection: 'desc',
  settings: defaultSettings,
  highlightItem: null,
  pendingEditFile: null,
  pendingEditView: null,
  directoryRefreshNonce: 0,
  highlightedSearchResult: null,
  folderAnalysis: null,
  folderGraph: null,
  pendingThreadScrollToBottom: false,
  rootPath: '',
  visibleTabs: new Set<AppState['currentView']>(['browser']),
  indexTreeRoot: null,
  pendingIndexTreeReveal: null,
  hasIndexFile: false,
  indexYaml: null,
  expandedEditor: false,
  selectedLinkItems: [],
  calendarFolder: null,
  activeCalendarFolder: null,
  calendarEvents: null,
  calendarLoading: false,
  calendarViewType: 'month',
  calendarViewTime: new Date(),
  imageSize: 'small',
  imageSizeTransitioning: false,
  aiConfig: defaultAiConfig,
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
 *
 * NOTE: if you ever need to print out the value of a state variable to detect it
 * every time it changes value, you can do what's being done in the commented line
 * below where we were doing that for a previous troubleshooting scenario
 */
export function emitChange(): void {
  // console.log('[store] expandedEditor =', state.expandedEditor, new Error().stack?.split('\n')[2]?.trim());
  for (const listener of listeners) {
    listener();
  }
}

/**
 * Subscribe to state changes
 */
export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Read the current state snapshot (non-reactive).
 */
export function getState(): AppState {
  return state;
}

/**
 * Merge a partial state and notify subscribers.
 */
export function setState(patch: Partial<AppState>): void {
  state = { ...state, ...patch };
  emitChange();
}

/**
 * Generic selector hook for subscribing to a slice of the store.
 *
 * The selector must return either a primitive or a value already stored in
 * state (e.g. `s => s.items`). Because every action replaces the slices it
 * mutates with fresh objects, such references stay stable while unchanged, so
 * `useSyncExternalStore` won't trigger spurious re-renders. Do not return a
 * freshly-allocated object/array from the selector — that would change identity
 * on every call and loop. For derived values, compute a cached snapshot
 * instead (see `getExpansionCountsSnapshot`).
 */
export function useStoreValue<T>(selector: (s: AppState) => T): T {
  return useSyncExternalStore(subscribe, () => selector(state));
}

import { create } from 'zustand';
import type { AppState, AppSettings, AiConfigState } from '../shared/types';

/**
 * Default settings
 */
export const defaultSettings: AppSettings = {
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
 * The single Zustand store. State only — actions live in the slice files and
 * mutate through `setState` below (Phase 2 of ZUSTAND_CONVERSION.md moves them
 * inside the store).
 */
const useAppStore = create<AppState>()(() => initialState);

/**
 * Subscribe to state changes
 */
export function subscribe(listener: () => void): () => void {
  return useAppStore.subscribe(listener);
}

/**
 * Read the current state snapshot (non-reactive).
 */
export function getState(): AppState {
  return useAppStore.getState();
}

/**
 * Merge a partial state and notify subscribers.
 */
export function setState(patch: Partial<AppState>): void {
  useAppStore.setState(patch);
}

/**
 * Generic selector hook for subscribing to a slice of the store.
 *
 * The selector must return either a primitive or a value already stored in
 * state (e.g. `s => s.items`). Because every action replaces the slices it
 * mutates with fresh objects, such references stay stable while unchanged, so
 * the store won't trigger spurious re-renders. Do not return a
 * freshly-allocated object/array from the selector — that would change identity
 * on every call and loop. For derived values, compute a cached snapshot
 * instead (see `getExpansionCountsSnapshot`).
 */
export function useStoreValue<T>(selector: (s: AppState) => T): T {
  return useAppStore(selector);
}

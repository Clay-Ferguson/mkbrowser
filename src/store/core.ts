import { create } from 'zustand';
import type { AppState, AppSettings, AiConfigState } from '../shared/types';
import { createImageSlice } from './image';
import type { ImageSlice } from './image';
import { createAiConfigSlice } from './aiConfig';
import type { AiConfigSlice } from './aiConfig';
import { createSearchSlice } from './search';
import type { SearchSlice } from './search';
import { createCalendarSlice } from './calendar';
import type { CalendarSlice } from './calendar';
import { createIndexTreeSlice } from './indexTree';
import type { IndexTreeSlice } from './indexTree';
import { createSettingsSlice } from './settings';
import type { SettingsSlice } from './settings';
import { createViewSlice } from './view';
import type { ViewSlice } from './view';
import { createItemsSlice } from './items';
import type { ItemsSlice } from './items';

/**
 * Full store state: the plain `AppState` fields plus the actions contributed
 * by each slice (Zustand slices pattern — ZUSTAND_CONVERSION.md §2b).
 */
export type StoreState = AppState & ImageSlice & AiConfigSlice & SearchSlice & CalendarSlice &
  IndexTreeSlice & SettingsSlice & ViewSlice & ItemsSlice;

/**
 * The `set` signature handed to slice creators: a shallow-merging partial
 * patch (Zustand's default). Slices only patch state fields, never actions.
 */
export type StoreSet = (patch: Partial<StoreState>) => void;

/**
 * The `get` signature handed to slice creators that read current state.
 */
export type StoreGet = () => StoreState;

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
 * The single Zustand store, composed from `initialState` plus every slice's
 * actions (Zustand slices pattern — ZUSTAND_CONVERSION.md §2b). All mutations
 * go through these actions; there is no free-form `setState` anymore.
 */
const useAppStore = create<StoreState>()((set, get) => ({
  ...initialState,
  ...createImageSlice(set),
  ...createAiConfigSlice(set, get),
  ...createSearchSlice(set),
  ...createCalendarSlice(set, get),
  ...createIndexTreeSlice(set, get),
  ...createSettingsSlice(set, get),
  ...createViewSlice(set, get),
  ...createItemsSlice(set, get),
}));

/**
 * Read the current state snapshot (non-reactive). Includes the slices'
 * actions, so slice wrappers can call `getState().someAction(...)`.
 */
export function getState(): StoreState {
  return useAppStore.getState();
}

/**
 * Generic selector hook for subscribing to a slice of the store.
 *
 * Selector results are compared with `Object.is`, so a selector that returns a
 * primitive or a value already stored in state (e.g. `s => s.items`) only
 * re-renders when that value actually changes. A selector that *derives* a
 * fresh object/array/tuple must be wrapped in `useShallow` from
 * `zustand/react/shallow` so results are compared shallowly instead of by
 * identity (see `useExpansionCounts` in `items.ts`).
 */
export function useStoreValue<T>(selector: (s: StoreState) => T): T {
  return useAppStore(selector);
}

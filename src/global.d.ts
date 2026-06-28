export type {
  HashtagDefinition,
  TagCategory,
  FontSize,
  SortOrder,
  ContentWidth,
  SearchMode,
  SearchType,
  SearchSortBy,
  SearchSortDirection,
  SearchDefinition,
  Bookmark,
  AppSettings,
  AIModelConfig,
  AIRewritePromptDef,
  AppConfig,
  FileEntry,
  SearchResult,
  ReplaceResult,
  ExportResult,
  FolderAnalysisResult,
  CalendarEventResult,
  FolderGraphScanResult,
  ProviderUsage,
  AIUsageWithCosts,
  ElectronAPI,
} from './shared/shared';

import type { ElectronAPI } from './shared/shared';

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

// Allow importing image files as modules
declare module '*.png' {
  const src: string;
  export default src;
}

// Allow Vite public folder imports (e.g., '/icon-256.png')
declare module '/icon-256.png' {
  const src: string;
  export default src;
}

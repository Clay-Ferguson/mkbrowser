export type {
  HashtagDefinition,
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
  FolderGraphScanResult,
  ProviderUsage,
  AIUsageWithCosts,
  ElectronAPI,
} from './types/shared';

import type { ElectronAPI } from './types/shared';

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

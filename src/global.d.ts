export type FontSize = 'small' | 'medium' | 'large' | 'xlarge';

export type SortOrder = 'alphabetical' | 'created-chron' | 'created-reverse' | 'modified-chron' | 'modified-reverse';

export type ContentWidth = 'narrow' | 'medium' | 'wide' | 'full';

export type SearchMode = 'content' | 'filenames';
export type SearchType = 'literal' | 'wildcard' | 'advanced';
export type SearchBlock = 'entire-file' | 'file-lines';
export type SearchSortBy = 'modified-time' | 'created-time' | 'line-time';
export type SearchSortDirection = 'asc' | 'desc';

export interface SearchDefinition {
  name: string;
  searchText: string;
  searchTarget: SearchMode;
  searchMode: SearchType;
  searchBlock: SearchBlock;
  sortBy?: SearchSortBy;
  sortDirection?: SearchSortDirection;
}

export interface AppSettings {
  fontSize: FontSize;
  sortOrder: SortOrder;
  foldersOnTop: boolean;
  ignoredPaths: string;
  searchDefinitions: SearchDefinition[];
  contentWidth: ContentWidth;
  bookmarks: string[];
}

export interface AppConfig {
  browseFolder: string;
  settings?: AppSettings;
}

export interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  isMarkdown: boolean;
  /** Last modified timestamp in milliseconds since epoch */
  modifiedTime: number;
  /** Created timestamp in milliseconds since epoch */
  createdTime: number;
  content?: string;
}

export interface SearchResult {
  path: string;
  relativePath: string;
  matchCount: number;
  lineNumber?: number; // 1-based line number (0 or undefined for entire file matches)
  lineText?: string; // The matching line text (only for line-by-line search)
  foundTime?: number; // Timestamp found by ts() function in advanced search (milliseconds since epoch)
  modifiedTime?: number; // File modification timestamp (milliseconds since epoch)
  createdTime?: number; // File creation timestamp (milliseconds since epoch)
}

export interface RenameOperation {
  oldPath: string;
  newPath: string;
  oldName: string;
  newName: string;
}

export interface RenumberResult {
  success: boolean;
  error?: string;
  operations?: RenameOperation[];
}

export interface ReplaceResult {
  path: string;
  relativePath: string;
  replacementCount: number;
  success: boolean;
  error?: string;
}

export interface ExportResult {
  success: boolean;
  outputPath?: string;
  error?: string;
}

export interface FolderAnalysisResult {
  hashtags: Array<{ tag: string; count: number }>;
  totalFiles: number;
}

export interface ElectronAPI {
  loadDictionary: () => Promise<{ affData: string; dicData: string }>;
  getConfig: () => Promise<AppConfig>;
  saveConfig: (config: AppConfig) => Promise<void>;
  selectFolder: () => Promise<string | null>;
  onFolderSelected: (callback: (folderPath: string) => void) => () => void;
  onCutRequested: (callback: () => void) => () => void;
  onUndoCutRequested: (callback: () => void) => () => void;
  onPasteRequested: (callback: () => void) => () => void;
  onDeleteRequested: (callback: () => void) => () => void;
  onSelectAllRequested: (callback: () => void) => () => void;
  onUnselectAllRequested: (callback: () => void) => () => void;
  onMoveToFolderRequested: (callback: () => void) => () => void;
  onSplitFileRequested: (callback: () => void) => () => void;
  onJoinFilesRequested: (callback: () => void) => () => void;
  onRenumberRequested: (callback: () => void) => () => void;
  onReplaceInFilesRequested: (callback: () => void) => () => void;
  onFolderAnalysisRequested: (callback: () => void) => () => void;
  onViewChanged: (callback: (view: 'browser' | 'search-results' | 'settings') => void) => () => void;
  onExportRequested: (callback: () => void) => () => void;
  onEditSearchDefinition: (callback: (definition: SearchDefinition) => void) => () => void;
  onOpenSearchDefinition: (callback: (definition: SearchDefinition) => void) => () => void;
  onOpenBookmark: (callback: (fullPath: string) => void) => () => void;
  readDirectory: (dirPath: string) => Promise<FileEntry[]>;
  readFile: (filePath: string) => Promise<string>;
  pathExists: (checkPath: string) => Promise<boolean>;
  writeFile: (filePath: string, content: string) => Promise<boolean>;
  getFileSize: (filePath: string) => Promise<number>;
  writeFileBinary: (filePath: string, base64Data: string) => Promise<boolean>;
  createFile: (filePath: string, content: string) => Promise<{ success: boolean; error?: string }>;
  renameFile: (oldPath: string, newPath: string) => Promise<boolean>;
  deleteFile: (filePath: string) => Promise<boolean>;
  openExternal: (filePath: string) => Promise<boolean>;
  openExternalUrl: (url: string) => Promise<boolean>;
  createFolder: (folderPath: string) => Promise<{ success: boolean; error?: string }>;
  searchFolder: (folderPath: string, query: string, searchType?: 'literal' | 'wildcard' | 'advanced', searchMode?: 'content' | 'filenames', searchBlock?: 'entire-file' | 'file-lines') => Promise<SearchResult[]>;
  searchAndReplace: (folderPath: string, searchText: string, replaceText: string) => Promise<ReplaceResult[]>;
  analyzeFolderHashtags: (folderPath: string) => Promise<FolderAnalysisResult>;
  collectAncestorTags: (filePath: string) => Promise<string[]>;
  renumberFiles: (dirPath: string) => Promise<RenumberResult>;
  setWindowTitle: (title: string) => Promise<void>;
  selectExportFolder: () => Promise<string | null>;
  exportFolderContents: (sourceFolder: string, outputFolder: string, outputFileName: string, includeSubfolders: boolean, includeFilenames: boolean, includeDividers: boolean) => Promise<ExportResult>;
  exportToPdf: (markdownPath: string, pdfPath: string) => Promise<{ success: boolean; error?: string }>;
}

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
